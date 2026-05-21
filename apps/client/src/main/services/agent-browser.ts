/**
 * AgentBrowserService - agent-browser 封装服务
 *
 * 功能：
 * 1. 直接调用 agent-browser CLI 命令
 * 2. 通过 JSON 输出解析结果
 * 3. 维护快照 refs 映射
 * 4. 集成安全策略
 */

import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { spawn } from 'child_process'
import { BrowserSecurityGuard, defaultSecurityGuard, SecurityError } from '../tools/browser-use/security/browser-security.js'
import { SSO_CONFIG, readSSOToken } from '../sso-config.js'

interface AgentBrowserConfig {
  headless?: boolean
  securityGuard?: BrowserSecurityGuard
  viewport?: { width: number; height: number }
}

interface PageElement {
  ref: string
  role: string
  name?: string
  tag?: string
  type?: string
}

interface PageContext {
  url: string
  title: string
  elements: PageElement[]
}

interface CommandResult {
  success: boolean
  output: string
  error?: string
}

/**
 * AgentBrowserService - agent-browser CLI 封装
 */
export class AgentBrowserService {
  private config: Required<AgentBrowserConfig>
  private securityGuard: BrowserSecurityGuard

  // 会话级别的状态
  private sessionContexts = new Map<string, {
    lastSnapshot: string
    refs: Map<string, PageElement>
    currentUrl: string
  }>()

  constructor(config: AgentBrowserConfig = {}) {
    this.config = {
      headless: config.headless ?? false,
      securityGuard: config.securityGuard ?? defaultSecurityGuard,
      viewport: config.viewport ?? { width: 1280, height: 720 }
    }
    this.securityGuard = this.config.securityGuard
  }

  /**
   * 获取或创建会话上下文
   */
  private getSessionContext(sessionId: string) {
    let context = this.sessionContexts.get(sessionId)
    if (!context) {
      context = {
        lastSnapshot: '',
        refs: new Map(),
        currentUrl: ''
      }
      this.sessionContexts.set(sessionId, context)
    }
    return context
  }

  /**
   * 获取 agent-browser 可执行文件路径
   */
  private getAgentBrowserPath(): string {
    // 可能的安装路径
    const possiblePaths = [
      // 使用 npx
      'agent-browser',
      // 打包后路径
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', '.bin', 'agent-browser'),
      // 本地开发路径
      path.join(__dirname, '..', '..', '..', 'node_modules', '.bin', 'agent-browser'),
      // 直接引用二进制
      path.join(__dirname, '..', '..', '..', 'node_modules', 'agent-browser', 'bin', `agent-browser-${process.platform}-${process.arch}`),
    ]

    for (const p of possiblePaths) {
      if (p === 'agent-browser') {
        // 检查命令是否可用
        try {
          const { execSync } = require('child_process')
          execSync('which agent-browser', { stdio: 'ignore' })
          return p
        } catch {
          continue
        }
      }
      if (fs.existsSync(p)) {
        return p
      }
    }

    // 默认返回命令名
    return 'agent-browser'
  }

  /**
   * 执行 agent-browser 命令
   */
  private async executeCommand(
    sessionId: string,
    args: string[],
    timeout = 60000
  ): Promise<CommandResult> {
    const agentBrowserPath = this.getAgentBrowserPath()

    // 构建环境变量
    // 注意：确保使用 agent-browser 内置的 Chromium，而不是系统 Chrome
    const env = {
      ...process.env,
      AGENT_BROWSER_HEADED: this.config.headless ? 'false' : 'true',
      AGENT_BROWSER_SESSION: sessionId,
      AGENT_BROWSER_DEFAULT_TIMEOUT: '30000',
      AGENT_BROWSER_VIEWPORT: `${this.config.viewport.width},${this.config.viewport.height}`,
      // 强制 Playwright 使用其自带的浏览器，而不是系统 Chrome
      PLAYWRIGHT_BROWSERS_PATH: '0',
      // 清除可能指向系统 Chrome 的环境变量
      CHROME_PATH: undefined,
      GOOGLE_CHROME_BIN: undefined,
      PUPPETEER_EXECUTABLE_PATH: undefined
    }

    return new Promise((resolve, reject) => {
      console.log(`[AgentBrowserService] Executing: ${agentBrowserPath} ${args.join(' ')}`)

      // 启动进程
      const isJsFile = agentBrowserPath.endsWith('.js')
      const command = isJsFile ? 'node' : agentBrowserPath
      const finalArgs = isJsFile ? [agentBrowserPath, ...args] : args

      const child = spawn(command, finalArgs, {
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let stdout = ''
      let stderr = ''
      let timeoutId: NodeJS.Timeout

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      child.on('error', (error) => {
        clearTimeout(timeoutId)
        reject(error)
      })

      child.on('close', (code) => {
        clearTimeout(timeoutId)
        const success = code === 0
        resolve({
          success,
          output: stdout.trim(),
          error: stderr.trim() || undefined
        })
      })

      // 设置超时
      timeoutId = setTimeout(() => {
        child.kill('SIGTERM')
        resolve({
          success: false,
          output: stdout.trim(),
          error: `Command timeout after ${timeout}ms`
        })
      }, timeout)
    })
  }

  /**
   * 导航到 URL
   * 使用 --headers 在初始请求中携带 SSO cookie，避免刷新
   */
  async navigate(sessionId: string, url: string): Promise<{ success: boolean; result: string }> {
    try {
      // 安全检查
      this.securityGuard.assertNavigationAllowed({ url, timestamp: Date.now() })

      // 获取 SSO token 用于设置 cookie
      const token = await readSSOToken()
      const args = ['open', url, '--json']

      // 如果有 access_token，通过 --headers 设置 Cookie
      if (token?.access_token) {
        const cookieName = SSO_CONFIG.COOKIE_NAME
        const cookieValue = token.access_token
        const cookieHeader = `${cookieName}=${cookieValue}`
        args.push('--headers', JSON.stringify({ Cookie: cookieHeader }))
        console.log(`[AgentBrowserService] Navigating with SSO cookie in header: ${cookieName}`)
      } else {
        console.log('[AgentBrowserService] No SSO token found, navigating without cookie')
      }

      // 执行导航（携带 cookie header）
      const navResult = await this.executeCommand(sessionId, args, 60000)

      if (navResult.success) {
        const context = this.getSessionContext(sessionId)
        context.currentUrl = url
      }

      return {
        success: navResult.success,
        result: navResult.success ? `Navigated to ${url}` : (navResult.error || 'Navigation failed')
      }
    } catch (error) {
      if (error instanceof SecurityError) {
        return {
          success: false,
          result: `Security error: ${error.message} (code: ${error.code})`
        }
      }
      throw error
    }
  }

  /**
   * 注入 SSO Cookie
   * Cookie 格式: ${clientId}_ssoid = access_token
   * 使用 --domain 参数设置跨子域的 cookie
   */
  private async injectSSOCookie(sessionId: string, url: string): Promise<void> {
    try {
      const token = await readSSOToken()
      if (!token?.access_token) {
        console.log('[AgentBrowserService] No SSO token found, skipping cookie injection')
        return
      }

      const cookieName = SSO_CONFIG.COOKIE_NAME
      const cookieValue = token.access_token

      // 解析域名用于 cookie domain
      const urlObj = new URL(url)
      const hostname = urlObj.hostname
      // 使用根域名以支持跨子域（如 .sankuai.com）
      const domainParts = hostname.split('.')
      const rootDomain = domainParts.length > 2
        ? `.${domainParts.slice(-2).join('.')}`
        : hostname

      console.log(`[AgentBrowserService] Injecting SSO cookie: ${cookieName} for domain: ${rootDomain}`)

      // 使用 agent-browser cookies set --domain 命令设置跨子域 cookie
      const cookieResult = await this.executeCommand(
        sessionId,
        [
          'cookies', 'set',
          cookieName,
          cookieValue,
          '--domain', rootDomain,
          '--path', '/',
          '--secure'
        ],
        10000
      )

      if (cookieResult.success) {
        console.log(`[AgentBrowserService] SSO cookie pre-set successfully: ${cookieName} for domain ${rootDomain}`)

        // 验证 cookie 是否设置成功
        const verifyResult = await this.executeCommand(sessionId, ['cookies'], 5000)
        if (verifyResult.success) {
          console.log(`[AgentBrowserService] Current cookies:`, verifyResult.output)
        }
      } else {
        console.warn(`[AgentBrowserService] Failed to inject SSO cookie:`, cookieResult.error)
      }
    } catch (error) {
      console.error('[AgentBrowserService] Error injecting SSO cookie:', error)
      // Cookie 注入失败不应影响导航结果
    }
  }

  /**
   * 获取页面上下文（snapshot + refs）
   */
  async getPageContext(sessionId: string): Promise<PageContext> {
    // 获取快照
    const result = await this.executeCommand(sessionId, ['snapshot', '-i', '--json'], 30000)

    if (!result.success) {
      throw new Error(`Failed to get snapshot: ${result.error}`)
    }

    // 获取标题
    const titleResult = await this.executeCommand(sessionId, ['get', 'title'], 10000)
    const title = titleResult.success ? titleResult.output : ''

    // 获取 URL
    const urlResult = await this.executeCommand(sessionId, ['get', 'url'], 10000)
    const url = urlResult.success ? urlResult.output : ''

    // 解析 snapshot 输出
    const { elements, snapshot } = this.parseSnapshot(result.output)

    const context = this.getSessionContext(sessionId)
    context.lastSnapshot = snapshot
    context.currentUrl = url
    context.refs.clear()
    elements.forEach(el => context.refs.set(el.ref, el))

    return {
      url,
      title,
      elements
    }
  }

  /**
   * 解析 snapshot 输出
   * 格式示例：
   * - button "Submit" [ref=e1]
   * - textbox "Email" [ref=e2]
   */
  private parseSnapshot(output: string): { elements: PageElement[]; snapshot: string } {
    const elements: PageElement[] = []
    const lines = output.split('\n')

    for (const line of lines) {
      // 匹配格式: - role "name" [ref=e1]
      const match = line.match(/-\s+(\w+)\s+(?:"([^"]*)"\s+)?\[ref=(e\d+)\]/)
      if (match) {
        const [, role, name, ref] = match
        elements.push({
          ref,
          role,
          name: name || undefined,
          tag: this.inferTagFromRole(role),
          type: role
        })
      }
    }

    return { elements, snapshot: output }
  }

  /**
   * 从 role 推断 tag
   */
  private inferTagFromRole(role: string): string {
    const roleToTag: Record<string, string> = {
      'button': 'button',
      'link': 'a',
      'textbox': 'input',
      'checkbox': 'input',
      'radio': 'input',
      'combobox': 'select',
      'listbox': 'select',
      'searchbox': 'input',
      'heading': 'h1',
      'paragraph': 'p',
      'generic': 'div'
    }
    return roleToTag[role] || 'div'
  }

  /**
   * 执行浏览器动作
   */
  async executeBrowserAction(
    sessionId: string,
    action: {
      type: string
      ref?: number
      description?: any
      text?: string
      field?: any
      url?: string
      direction?: string
      amount?: number
      option?: string
      timeout?: number
      fullPage?: boolean
    }
  ): Promise<{ success: boolean; result: string }> {
    const args: string[] = []

    switch (action.type) {
      case 'navigate':
        return this.navigate(sessionId, action.url!)

      case 'click': {
        const ref = action.ref !== undefined ? `@e${action.ref}` : this.findRefByDescription(sessionId, action.description)
        args.push('click', ref)
        break
      }

      case 'type': {
        const ref = action.ref !== undefined ? `@e${action.ref}` : this.findRefByDescription(sessionId, action.field)
        args.push('fill', ref, action.text || '')
        break
      }

      case 'select': {
        const ref = action.ref !== undefined ? `@e${action.ref}` : this.findRefByDescription(sessionId, action.description)
        args.push('select', ref, action.option || '')
        break
      }

      case 'scroll': {
        if (action.ref !== undefined) {
          const ref = `@e${action.ref}`
          args.push('scrollintoview', ref)
        } else {
          args.push('scroll', action.direction || 'down', String(action.amount || 500))
        }
        break
      }

      case 'wait': {
        const waitMs = action.timeout || 1000
        args.push('wait', String(waitMs))
        break
      }

      case 'screenshot': {
        args.push('screenshot')
        if (action.fullPage) {
          args.push('--full')
        }
        break
      }

      case 'analyze': {
        // 获取页面上下文
        const context = await this.getPageContext(sessionId)
        const summary = this.formatPageSummary(context)
        return { success: true, result: summary }
      }

      case 'back':
        args.push('back')
        break

      case 'forward':
        args.push('forward')
        break

      case 'close':
        args.push('close')
        break

      default:
        return { success: false, result: `Unknown action type: ${action.type}` }
    }

    const result = await this.executeCommand(sessionId, args, 60000)

    // 执行后刷新上下文（如果页面可能变化）
    if (['click', 'navigate', 'back', 'forward'].includes(action.type)) {
      await this.refreshPageContext(sessionId)
    }

    return {
      success: result.success,
      result: result.success
        ? `Executed ${action.type} successfully`
        : (result.error || `${action.type} failed`)
    }
  }

  /**
   * 通过描述查找 ref
   */
  private findRefByDescription(sessionId: string, description?: any): string {
    if (!description) return '@e1'

    const context = this.getSessionContext(sessionId)

    // 尝试匹配 name, role, text 等
    for (const [ref, element] of context.refs) {
      if (description.name && element.name?.includes(description.name)) {
        return `@${ref}`
      }
      if (description.role && element.role === description.role) {
        return `@${ref}`
      }
      if (description.text && element.name?.includes(description.text)) {
        return `@${ref}`
      }
    }

    // 默认返回第一个 ref
    const firstRef = context.refs.keys().next().value
    return firstRef ? `@${firstRef}` : '@e1'
  }

  /**
   * 刷新页面上下文
   */
  async refreshPageContext(sessionId: string): Promise<PageContext> {
    return this.getPageContext(sessionId)
  }

  /**
   * 格式化页面摘要
   */
  private formatPageSummary(context: PageContext): string {
    const lines: string[] = []
    lines.push(`Page: ${context.title}`)
    lines.push(`URL: ${context.url}`)
    lines.push('')
    lines.push('Available Elements:')
    lines.push('')

    context.elements.forEach((el) => {
      const name = el.name || '(unnamed)'
      lines.push(`[${el.ref}] <${el.tag}> role="${el.role}" name="${name.substring(0, 50)}"`)
    })

    lines.push('')
    lines.push(`Total: ${context.elements.length} interactive elements`)

    return lines.join('\n')
  }

  /**
   * 通过索引点击
   */
  async clickByIndex(sessionId: string, index: number): Promise<{ success: boolean; result: string }> {
    return this.executeBrowserAction(sessionId, {
      type: 'click',
      ref: index
    })
  }

  /**
   * 通过索引输入
   */
  async typeByIndex(sessionId: string, index: number, text: string): Promise<{ success: boolean; result: string }> {
    return this.executeBrowserAction(sessionId, {
      type: 'type',
      ref: index,
      text
    })
  }

  /**
   * 获取当前 URL
   */
  async getCurrentUrl(sessionId: string): Promise<string | null> {
    try {
      const result = await this.executeCommand(sessionId, ['get', 'url'], 10000)
      return result.success ? result.output : null
    } catch {
      return null
    }
  }

  /**
   * 获取 DOM 哈希（简化为 URL + 元素数量）
   */
  async getDOMHash(sessionId: string): Promise<string> {
    try {
      const context = await this.getPageContext(sessionId)
      const hashInput = `${context.url}-${context.elements.length}`
      let hash = 0
      for (let i = 0; i < hashInput.length; i++) {
        const char = hashInput.charCodeAt(i)
        hash = ((hash << 5) - hash) + char
        hash = hash & hash
      }
      return hash.toString(16)
    } catch {
      return Date.now().toString(16)
    }
  }

  /**
   * 返回上一页
   */
  async back(sessionId: string): Promise<void> {
    await this.executeCommand(sessionId, ['back'], 10000)
  }

  /**
   * 前进到下一页
   */
  async forward(sessionId: string): Promise<void> {
    await this.executeCommand(sessionId, ['forward'], 10000)
  }

  /**
   * 关闭会话
   */
  async close(sessionId: string): Promise<void> {
    try {
      // 关闭浏览器
      await this.executeCommand(sessionId, ['close'], 10000)

      // 清理会话状态
      this.sessionContexts.delete(sessionId)

      console.log(`[AgentBrowserService] Session ${sessionId} closed`)
    } catch (error) {
      console.warn(`[AgentBrowserService] Error closing session:`, error)
    }
  }

  /**
   * 关闭所有会话并停止 daemon
   */
  async closeAll(): Promise<void> {
    // 关闭所有会话的浏览器
    for (const sessionId of this.sessionContexts.keys()) {
      try {
        await this.executeCommand(sessionId, ['close', '--all'], 10000)
      } catch {
        // ignore
      }
    }

    // 清理所有会话状态
    this.sessionContexts.clear()

    console.log('[AgentBrowserService] All sessions closed')
  }
}

// 导出单例
export const agentBrowserService = new AgentBrowserService()
