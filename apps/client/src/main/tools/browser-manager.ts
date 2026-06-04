/**
 * BrowserManager - 会话级别的浏览器管理器
 *
 * 设计方案：独立 Chrome 实例 + CDP
 * - 启动一个全新的 Chrome 实例，使用临时用户数据目录
 * - 复制原 Chrome 的关键登录文件（Cookies, Login Data, Local State）到临时目录
 * - 新实例开启远程调试端口（9222），通过 CDP 连接控制
 * - 完全独立，不影响用户已有的 Chrome 窗口
 */

import { Browser, BrowserContext, Page, chromium } from 'playwright'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { spawn } from 'child_process'
import { log } from '@auto-agent/shared-utils'

export interface SessionBrowserPage {
  page: Page
  createdAt: number
  lastUsedAt: number
}

export class BrowserManager {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private pages = new Map<string, SessionBrowserPage>()
  private config: {
    headless: boolean
    viewport: { width: number; height: number }
  }
  private cdpEndpoint: string = 'http://localhost:9222'
  private tempUserDataDir: string | null = null
  private chromeProcess: any = null

  constructor() {
    this.config = {
      headless: false,
      viewport: { width: 1280, height: 720 }
    }
  }

  /**
   * 检查 CDP 端口是否可用
   */
  private async checkChromeDebugPort(): Promise<boolean> {
    try {
      const response = await fetch(`${this.cdpEndpoint}/json/version`)
      return response.ok
    } catch (e) {
      return false
    }
  }

  /**
   * 获取 Chrome 可执行文件路径
   */
  private getChromePath(): string {
    const platform = process.platform
    if (platform === 'darwin') {
      return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    } else if (platform === 'win32') {
      return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    } else {
      return '/usr/bin/google-chrome'
    }
  }

  /**
   * 获取系统 Chrome 用户数据目录
   */
  private getChromeUserDataDir(): string {
    const homedir = os.homedir()
    return `${homedir}/Library/Application Support/Google/Chrome`
  }

  /**
   * 复制关键登录文件到临时目录（异步，避免阻塞）
   * 这些文件包含登录态信息，Chrome 可以用系统密钥解密
   */
  private async copyLoginFiles(sourceDir: string, tempDir: string): Promise<void> {
    // 创建目录结构
    fs.mkdirSync(path.join(tempDir, 'Default'), { recursive: true })
    fs.mkdirSync(path.join(tempDir, 'Default', 'Network'), { recursive: true })

    // 关键文件列表（只复制必要的，减少IO）
    const filesToCopy = [
      'Default/Cookies',
      'Default/Login Data',
      'Default/Preferences',
      'Default/Network/Cookies',
      'Local State'
    ]

    log.info('BrowserManager', 'Copying login files...')

    // 异步并行复制，减少阻塞
    const copyPromises = filesToCopy.map(async (file) => {
      const sourcePath = path.join(sourceDir, file)
      const destPath = path.join(tempDir, file)

      if (fs.existsSync(sourcePath)) {
        try {
          // 使用流复制大文件，避免阻塞
          await new Promise<void>((resolve, reject) => {
            const readStream = fs.createReadStream(sourcePath)
            const writeStream = fs.createWriteStream(destPath)
            readStream.on('error', reject)
            writeStream.on('error', reject)
            writeStream.on('finish', resolve)
            readStream.pipe(writeStream)
          })
          log.info('BrowserManager', `Copied ${file}`)
        } catch (err) {
          log.warn('BrowserManager', `Failed to copy ${file}:`, err)
        }
      }
    })

    await Promise.all(copyPromises)

    // 创建空的 Lock 文件避免冲突检测（使用符号链接格式）
    fs.writeFileSync(path.join(tempDir, 'Default', 'lockfile'), '')
    // SingletonLock 需要指向自身路径的符号链接格式
    const hostname = os.hostname()
    const lockContent = `${hostname}-${process.pid}`
    fs.writeFileSync(path.join(tempDir, 'SingletonLock'), lockContent)
  }

  /**
   * 创建临时用户数据目录并复制登录态
   */
  private async createUserDataDirWithLogin(): Promise<string> {
    const sourceDir = this.getChromeUserDataDir()
    this.tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-cdp-'))

    log.info('BrowserManager', `Created temp profile at ${this.tempUserDataDir}`)

    // 复制登录文件
    await this.copyLoginFiles(sourceDir, this.tempUserDataDir)

    return this.tempUserDataDir
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * 启动带 CDP 的独立 Chrome 实例
   */
  private async launchChromeWithCDP(): Promise<void> {
    const chromePath = this.getChromePath()

    // 检查端口是否被占用
    const isPortInUse = await this.checkChromeDebugPort()
    if (isPortInUse) {
      log.info('BrowserManager', 'Port 9222 already in use, using existing Chrome')
      return
    }

    log.info('BrowserManager', 'Launching independent Chrome with CDP...')

    // 创建临时用户数据目录（复制登录态）
    const userDataDir = await this.createUserDataDirWithLogin()

    // 启动 Chrome 参数
    const chromeArgs = [
      `--remote-debugging-port=9222`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-popup-blocking',
      '--disable-infobars',
      '--disable-blink-features=AutomationControlled',
      // 窗口大小
      `--window-size=${this.config.viewport.width},${this.config.viewport.height}`,
      // 新窗口位置（避免覆盖已有窗口）
      '--window-position=100,100',
      // 减少资源占用
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      // 禁用不必要的服务
      '--disable-sync',
      '--disable-extensions',
      '--disable-translate',
      // 内存优化
      '--js-flags=--max-old-space-size=1024'
    ]

    log.info('BrowserManager', `Chrome args: ${chromeArgs.join(' ')}`)

    // 启动 Chrome
    this.chromeProcess = spawn(chromePath, chromeArgs, {
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })

    // 错误处理
    let stderrOutput = ''
    this.chromeProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim()
      stderrOutput += msg + '\n'
      // 只打印关键错误
      if (msg.includes('ERROR') || msg.includes('FATAL')) {
        log.info('Chrome', `${msg.substring(0, 200)}`)
      }
    })

    this.chromeProcess.on('exit', (code: number) => {
      log.info('BrowserManager', `Chrome process exited with code ${code}`)
      this.chromeProcess = null
    })

    this.chromeProcess.unref()

    // 等待 Chrome 启动并监听端口
    let attempts = 0
    const maxAttempts = 60

    while (attempts < maxAttempts) {
      await this.sleep(1000)
      const isReady = await this.checkChromeDebugPort()
      if (isReady) {
        log.info('BrowserManager', 'Chrome is ready with CDP port 9222')
        return
      }
      if (attempts % 10 === 0) {
        log.info('BrowserManager', `Waiting for Chrome... (${attempts}/${maxAttempts})`)
      }
      attempts++
    }

    log.error('BrowserManager', ' Chrome failed to start. Last errors:', stderrOutput.substring(0, 500))
    throw new Error('Chrome failed to start with debug port')
  }

  /**
   * 初始化浏览器连接
   */
  private async initialize(): Promise<{ browser: Browser; context: BrowserContext }> {
    if (!this.browser) {
      // 确保 Chrome 已启动并监听 CDP 端口
      const isCDPReady = await this.checkChromeDebugPort()
      if (!isCDPReady) {
        await this.launchChromeWithCDP()
      }

      log.info('BrowserManager', `Connecting to Chrome via CDP...`)

      try {
        // 使用 CDP 连接
        this.browser = await chromium.connectOverCDP(this.cdpEndpoint)

        log.info('BrowserManager', `Connected to Chrome`)
        log.info('BrowserManager', `Browser version: ${await this.browser.version()}`)

        // 获取 context
        const contexts = this.browser.contexts()
        if (contexts.length > 0) {
          this.context = contexts[0]
          const pages = await this.context.pages()
          log.info('BrowserManager', `Using existing context with ${pages.length} pages`)
        } else {
          this.context = await this.browser.newContext({
            viewport: this.config.viewport
          })
          log.info('BrowserManager', `Created new context`)
        }

        // 监听断开
        this.browser.on('disconnected', () => {
          log.info('BrowserManager', 'Browser disconnected')
          this.browser = null
          this.context = null
          this.pages.clear()
        })
      } catch (error) {
        log.error('BrowserManager', ' Failed to connect via CDP:', error)
        throw error
      }
    }

    return { browser: this.browser!, context: this.context! }
  }

  /**
   * 获取或创建会话的 Page（Tab）
   * - 每个会话一个 Tab
   * - 多个会话在同一窗口中
   */
  async getPage(sessionId: string): Promise<Page> {
    log.info('BrowserManager', `getPage for session: ${sessionId}`)

    if (!sessionId) {
      throw new Error('sessionId is required')
    }

    const { context } = await this.initialize()

    let sessionPage = this.pages.get(sessionId)

    if (!sessionPage || sessionPage.page.isClosed()) {
      log.info('BrowserManager', `Creating new tab for session: ${sessionId}`)

      const page = await context.newPage()
      await page.setViewportSize(this.config.viewport)

      page.setDefaultTimeout(10000)
      page.setDefaultNavigationTimeout(30000)

      sessionPage = {
        page,
        createdAt: Date.now(),
        lastUsedAt: Date.now()
      }

      this.pages.set(sessionId, sessionPage)
      log.info('BrowserManager', `Total tabs: ${this.pages.size}, sessions: ${Array.from(this.pages.keys()).join(', ')}`)

      page.on('close', () => {
        log.info('BrowserManager', `Tab closed for session: ${sessionId}`)
        this.pages.delete(sessionId)
      })
    } else {
      sessionPage.lastUsedAt = Date.now()
      log.info('BrowserManager', `Reusing tab for session: ${sessionId}`)
    }

    return sessionPage.page
  }

  /**
   * 检查会话是否有活跃的页面
   */
  hasPage(sessionId: string): boolean {
    const sessionPage = this.pages.get(sessionId)
    return sessionPage !== undefined && !sessionPage.page.isClosed()
  }

  /**
   * 关闭指定会话的 tab
   */
  async closeSession(sessionId: string): Promise<void> {
    log.info('BrowserManager', `closeSession: ${sessionId}`)

    if (!sessionId) return

    const sessionPage = this.pages.get(sessionId)
    if (sessionPage) {
      try {
        if (!sessionPage.page.isClosed()) {
          await sessionPage.page.close()
          log.info('BrowserManager', `Closed tab for: ${sessionId}`)
        }
      } catch (e) {
        log.warn('BrowserManager', `Error closing tab:`, e)
      }
      this.pages.delete(sessionId)

      // 如果所有会话都关闭了，关闭浏览器
      if (this.pages.size === 0) {
        await this.closeBrowser()
      }
    }
  }

  /**
   * 关闭所有会话的 tabs
   */
  async closeAllSessions(): Promise<void> {
    log.info('BrowserManager', `Closing all ${this.pages.size} tabs`)
    for (const [sessionId, sessionPage] of this.pages) {
      try {
        if (!sessionPage.page.isClosed()) {
          await sessionPage.page.close()
        }
      } catch (e) {
        // ignore
      }
    }
    this.pages.clear()
  }

  /**
   * 关闭浏览器并清理
   */
  async closeBrowser(): Promise<void> {
    await this.closeAllSessions()

    if (this.browser) {
      await this.browser.close()
      this.browser = null
      this.context = null
      log.info('BrowserManager', 'Disconnected from Chrome')
    }

    // 终止 Chrome 进程
    if (this.chromeProcess) {
      try {
        process.kill(-this.chromeProcess.pid)
        log.info('BrowserManager', 'Chrome process terminated')
      } catch (e) {
        // ignore
      }
      this.chromeProcess = null
    }

    // 清理临时目录
    if (this.tempUserDataDir) {
      try {
        fs.rmSync(this.tempUserDataDir, { recursive: true, force: true })
        log.info('BrowserManager', `Cleaned up: ${this.tempUserDataDir}`)
        this.tempUserDataDir = null
      } catch (err) {
        log.warn('BrowserManager', ' Cleanup failed:', err)
      }
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const activeSessionIds = Array.from(this.pages.entries())
      .filter(([_, sp]) => !sp.page.isClosed())
      .map(([id, _]) => id)

    return {
      browserConnected: !!this.browser,
      activeTabs: activeSessionIds.length,
      sessionIds: activeSessionIds
    }
  }

  /**
   * 预启动 Chrome（后台静默初始化）
   * 在用户实际使用前就准备好浏览器，减少首次等待时间
   */
  async prelaunchChrome(): Promise<void> {
    log.info('BrowserManager', 'Prelaunching Chrome in background...')

    // 检查是否已就绪
    const isReady = await this.checkChromeDebugPort()
    if (isReady) {
      log.info('BrowserManager', 'Chrome already running, prelaunch skipped')
      return
    }

    try {
      await this.launchChromeWithCDP()
      log.info('BrowserManager', '✓ Chrome prelaunched successfully')
    } catch (error) {
      log.error('BrowserManager', ' Prelaunch failed:', error)
      throw error
    }
  }

  /**
   * 检查 Chrome 是否已预启动
   */
  async isChromeReady(): Promise<boolean> {
    return this.checkChromeDebugPort()
  }
}

// 导出全局单例
export const browserManager = new BrowserManager()
