/**
 * BrowserManager - 会话级别的浏览器管理器
 *
 * 实现方案：所有会话共享同一个 BrowserContext，每个会话一个 Tab (Page)
 * - 共享同一个 Browser 实例
 * - 共享同一个 BrowserContext（所有 tabs 在同一窗口）
 * - 每个会话对应一个 Page（tab）
 * - 关闭会话时关闭对应的 tab
 */

import { Browser, BrowserContext, Page, chromium } from 'playwright'

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

  constructor() {
    this.config = {
      headless: false,
      viewport: { width: 1280, height: 720 }
    }
  }

  /**
   * 初始化浏览器和上下文（全局单例）
   */
  private async initialize(): Promise<{ browser: Browser; context: BrowserContext }> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: this.config.headless,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-site-isolation-trials',
          '--disable-dev-shm-usage',
          `--window-size=${this.config.viewport.width},${this.config.viewport.height}`,
          '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.0'
        ]
      })
      console.log('[BrowserManager] Browser instance created')

      // 监听浏览器关闭
      this.browser.on('disconnected', () => {
        console.log('[BrowserManager] Browser disconnected')
        this.browser = null
        this.context = null
        this.pages.clear()
      })
    }

    if (!this.context) {
      // 创建共享的 context（所有 tabs 在同一窗口）
      this.context = await this.browser.newContext({
        viewport: this.config.viewport,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.0',
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai'
      })
      console.log('[BrowserManager] Shared context created')

      // 监听 context 关闭
      this.context.on('close', () => {
        console.log('[BrowserManager] Context closed')
        this.context = null
        this.pages.clear()
      })
    }

    return { browser: this.browser, context: this.context }
  }

  /**
   * 获取或创建会话的 Page（tab）
   */
  async getPage(sessionId: string): Promise<Page> {
    console.log(`[BrowserManager] getPage called for session: ${sessionId}`)

    if (!sessionId) {
      throw new Error('sessionId is required')
    }

    const { context } = await this.initialize()

    let sessionPage = this.pages.get(sessionId)

    if (!sessionPage || sessionPage.page.isClosed()) {
      console.log(`[BrowserManager] Creating new tab for session: ${sessionId}`)

      // 创建新的 page（新 tab）
      const page = await context.newPage()


      // 注入 stealth 脚本
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
        // @ts-ignore
        if (!window.chrome) window.chrome = {}
        Object.defineProperty(navigator, 'plugins', {
          get: () => [{ name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' }]
        })
      })

      page.setDefaultTimeout(10000)
      page.setDefaultNavigationTimeout(30000)

      sessionPage = {
        page,
        createdAt: Date.now(),
        lastUsedAt: Date.now()
      }

      this.pages.set(sessionId, sessionPage)
      console.log(`[BrowserManager] Created new tab for session: ${sessionId}, total tabs: ${this.pages.size}`)

      // 打印所有活跃的 session
      console.log(`[BrowserManager] Active sessions: ${Array.from(this.pages.keys()).join(', ')}`)

      // 监听页面关闭事件
      page.on('close', () => {
        console.log(`[BrowserManager] Tab closed for session: ${sessionId}`)
        this.pages.delete(sessionId)
      })
    } else {
      // 更新最后使用时间
      sessionPage.lastUsedAt = Date.now()
      console.log(`[BrowserManager] Reusing existing tab for session: ${sessionId}`)
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
    console.log(`[BrowserManager] closeSession called for session: ${sessionId}`)

    if (!sessionId) {
      console.warn('[BrowserManager] closeSession called without sessionId')
      return
    }

    const sessionPage = this.pages.get(sessionId)
    if (sessionPage) {
      console.log(`[BrowserManager] Closing tab for session: ${sessionId}`)
      try {
        if (!sessionPage.page.isClosed()) {
          await sessionPage.page.close()
          console.log(`[BrowserManager] Tab closed successfully for session: ${sessionId}`)
        } else {
          console.log(`[BrowserManager] Tab already closed for session: ${sessionId}`)
        }
      } catch (e) {
        // 页面可能已经被关闭，忽略错误
        console.warn(`[BrowserManager] Error closing tab for session ${sessionId}:`, e)
      }
      this.pages.delete(sessionId)
      console.log(`[BrowserManager] Session removed from map. Remaining tabs: ${this.pages.size}`)
      console.log(`[BrowserManager] Remaining sessions: ${Array.from(this.pages.keys()).join(', ') || 'none'}`)

      // 如果所有会话都已关闭，关闭浏览器
      if (this.pages.size === 0) {
        console.log('[BrowserManager] All sessions closed, closing browser')
        await this.closeBrowser()
      }
    } else {
      console.log(`[BrowserManager] No tab found for session: ${sessionId}`)
    }
  }

  /**
   * 关闭所有会话的 tabs（保留浏览器实例）
   */
  async closeAllSessions(): Promise<void> {
    console.log(`[BrowserManager] Closing all ${this.pages.size} tabs`)
    const promises: Promise<void>[] = []
    for (const [sessionId, sessionPage] of this.pages) {
      promises.push(
        (async () => {
          try {
            if (!sessionPage.page.isClosed()) {
              await sessionPage.page.close()
            }
          } catch (e) {
            // 忽略错误
          }
          console.log(`[BrowserManager] Closed tab for session: ${sessionId}`)
        })()
      )
    }
    await Promise.all(promises)
    this.pages.clear()
    console.log('[BrowserManager] All tabs closed')
  }

  /**
   * 关闭浏览器（所有 tabs 和 context）
   */
  async closeBrowser(): Promise<void> {
    // 先关闭所有 pages
    await this.closeAllSessions()

    // 关闭 context
    if (this.context) {
      await this.context.close()
      this.context = null
      console.log('[BrowserManager] Context closed')
    }

    // 关闭 browser
    if (this.browser) {
      await this.browser.close()
      this.browser = null
      console.log('[BrowserManager] Browser instance closed')
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    browserConnected: boolean
    activeTabs: number
    sessionIds: string[]
  } {
    // 过滤掉已关闭的 pages
    const activeSessionIds = Array.from(this.pages.entries())
      .filter(([_, sessionPage]) => !sessionPage.page.isClosed())
      .map(([sessionId, _]) => sessionId)

    return {
      browserConnected: !!this.browser && !!this.context,
      activeTabs: activeSessionIds.length,
      sessionIds: activeSessionIds
    }
  }

  /**
   * 清理空闲超过指定时间的 tabs（可选的垃圾回收）
   */
  async cleanupIdlePages(maxIdleTimeMs: number = 30 * 60 * 1000): Promise<void> {
    const now = Date.now()
    const toClose: string[] = []

    for (const [sessionId, sessionPage] of this.pages) {
      if (now - sessionPage.lastUsedAt > maxIdleTimeMs) {
        toClose.push(sessionId)
      }
    }

    for (const sessionId of toClose) {
      await this.closeSession(sessionId)
    }

    if (toClose.length > 0) {
      console.log(`[BrowserManager] Cleaned up ${toClose.length} idle tabs`)
    }
  }
}

// 导出全局单例
export const browserManager = new BrowserManager()
