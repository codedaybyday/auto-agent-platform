/**
 * AI 友好的 Browser 工具增强版
 * 基于 Playwright，提供语义化操作和智能页面分析
 *
 * 增强功能：
 * - CDP 获取页面元素（browser-use 风格）
 * - 元素稳定引用（hash + stableHash）
 * - 安全层（SSRF 防护、URL 校验）
 * - 操作历史追踪和重试
 * - 会话级别隔离（每个会话独立的 BrowserContext）
 */

import { Page, Locator } from 'playwright'
import { BrowserSecurityGuard, defaultSecurityGuard, SecurityError } from './browser-security'
import { DOMSerializer, SerializedDOM, domSerializer } from './dom-serializer'
import { RobustLocator, robustLocator } from './robust-locator'
import type { ElementSignature } from './element-hash'
import type { BrowserUseElement } from './browser-use-dom'
import { browserUseDOM } from './browser-use-dom'
import { browserManager, SessionBrowserContext } from '../browser-manager.js'

export interface PageElement {
  tag: string
  role?: string
  name?: string
  text?: string
  placeholder?: string
  type?: string
  href?: string
  selector: string
  boundingBox?: {
    x: number
    y: number
    width: number
    height: number
  }
}

export interface PageAnalysis {
  url: string
  title: string
  description?: string
  interactiveElements: PageElement[]
  forms: {
    selector: string
    fields: PageElement[]
    submitButton?: PageElement
  }[]
  links: PageElement[]
  headings: { level: number; text: string }[]
  textContent: string
}

export interface BrowserAction {
  action: 'navigate' | 'click' | 'type' | 'select' | 'hover' | 'scroll' | 'wait' | 'screenshot' | 'analyze' | 'back' | 'forward' | 'close' | 'context'
  params: Record<string, any>
  timestamp?: number
  success?: boolean
  error?: string
}

export interface BrowserAIConfig {
  headless?: boolean
  securityGuard?: BrowserSecurityGuard
  maxRetries?: number
  // DOM 序列化配置
  domSerializer?: {
    maxElements?: number
    minElementSize?: number
  }
}

// 每个会话的操作历史存储
interface SessionState {
  actionHistory: BrowserAction[]
  currentElementMap: Map<number, BrowserUseElement>
  lastPageContext: {
    url: string
    title: string
    elements: BrowserUseElement[]
    timestamp: number
  } | null
}

export class BrowserAI {
  private sessionStates = new Map<string, SessionState>()
  private config: Required<BrowserAIConfig>
  private securityGuard: BrowserSecurityGuard
  private domSerializer: DOMSerializer

  constructor(config: BrowserAIConfig = {}) {
    this.config = {
      headless: config.headless ?? false,
      securityGuard: config.securityGuard ?? defaultSecurityGuard,
      maxRetries: config.maxRetries ?? 1,
      domSerializer: config.domSerializer ?? { maxElements: 200, minElementSize: 5 }
    }
    this.securityGuard = this.config.securityGuard
    this.domSerializer = new DOMSerializer({
      maxElements: this.config.domSerializer.maxElements,
      minElementSize: this.config.domSerializer.minElementSize
    })
  }

  /**
   * 获取或创建会话状态
   */
  private getSessionState(sessionId: string): SessionState {
    let state = this.sessionStates.get(sessionId)
    if (!state) {
      state = {
        actionHistory: [],
        currentElementMap: new Map(),
        lastPageContext: null
      }
      this.sessionStates.set(sessionId, state)
    }
    return state
  }

  /**
   * 获取会话的 page（从 BrowserManager）
   */
  private async getPage(sessionId: string): Promise<Page> {
    return browserManager.getPage(sessionId)
  }

  /**
   * 执行浏览器动作
   * 由后端 LLM 解析指令后调用，接收结构化的动作参数
   *
   * @param sessionId 会话ID
   * @param action 结构化动作对象
   * @returns 执行结果
   */
  async executeBrowserAction(
    sessionId: string,
    action: {
      type: string
      ref?: number
      description?: {
        tag?: string
        role?: string
        name?: string
        text?: string
        placeholder?: string
        type?: string
        id?: string
        ariaLabel?: string
        hash?: string
        stableHash?: string
        bbox?: { x: number; y: number; width: number; height: number }
      }
      text?: string
      field?: {
        tag?: string
        role?: string
        name?: string
        text?: string
        placeholder?: string
        type?: string
        id?: string
        ariaLabel?: string
        hash?: string
        stableHash?: string
        bbox?: { x: number; y: number; width: number; height: number }
      }
      url?: string
      direction?: string
      amount?: number
      option?: string
      timeout?: number
      fullPage?: boolean
      schema?: Record<string, any>
    }
  ): Promise<{ success: boolean; result: string }> {
    console.log(`[BrowserAI] Executing action: ${action.type} for session: ${sessionId}`)

    const page = await this.getPage(sessionId)
    return this.executeAction(sessionId, action, page)
  }

  /**
   * 智能元素定位 - Browser-use style
   * 优先使用缓存的 element map，保持一致性
   */
  private async locateElement(
    sessionId: string,
    signature: Partial<ElementSignature> & { index?: number }
  ): Promise<{ locator: Locator; strategy: string } | null> {
    const page = await this.getPage(sessionId)
    const sessionState = this.getSessionState(sessionId)

    // 优先使用缓存的 element map（与 getPageContext 一致）
    if (signature.index !== undefined && sessionState.currentElementMap.has(signature.index)) {
      const element = sessionState.currentElementMap.get(signature.index)!
      console.log(`[BrowserAI] Located element [${signature.index}] from cached map: ${element.tag}`)

      // 使用元素的 bounds 和属性来定位
      const locator = await this.findElementFromSignature(page, element)
      if (locator) {
        return { locator, strategy: 'cached-map' }
      }
    }

    // 缓存未命中，使用 RobustLocator（可能 DOM 已变化）
    console.log(`[BrowserAI] Element [${signature.index}] not in cache, using fallback...`)
    const result = await robustLocator.locate(page, signature)

    if (result) {
      console.log(`[BrowserAI] Located element using ${result.strategy} (confidence: ${result.confidence})`)
      return { locator: result.locator, strategy: result.strategy }
    }

    return null
  }

  /**
   * 从 BrowserUseElement 创建 Playwright Locator
   */
  private async findElementFromSignature(page: Page, element: BrowserUseElement): Promise<Locator | null> {
    // 1. 优先使用 backendNodeId 通过 CDP 定位
    if (element.backendNodeId) {
      try {
        const cdpSession = await page.context().newCDPSession(page)
        try {
          // 尝试使用 DOM.querySelector 通过 backendNodeId 定位
          const result = await cdpSession.send('DOM.resolveNode', {
            backendNodeId: element.backendNodeId
          })
          if (result && result.object && result.object.objectId) {
            // 转换为 Playwright locator
            // 由于无法直接从 CDP objectId 创建 locator，我们使用属性匹配
          }
        } finally {
          await cdpSession.detach()
        }
      } catch {
        // CDP 失败，继续用其他方法
      }
    }

    // 2. 使用属性匹配（browser-use style）
    const strategies: Array<() => Promise<Locator | null>> = [
      // ID
      async () => {
        if (element.id) {
          const locator = page.locator(`#${CSS.escape(element.id)}`)
          if (await locator.count() > 0) return locator
        }
        return null
      },
      // Role + name
      async () => {
        if (element.name) {
          const role = element.role || element.tag
          const locator = page.getByRole(role as any, { name: element.name, exact: false })
          if (await locator.count() > 0) return locator.first()
        }
        return null
      },
      // Placeholder
      async () => {
        if (element.placeholder) {
          const locator = page.getByPlaceholder(element.placeholder, { exact: false })
          if (await locator.count() > 0) return locator.first()
        }
        return null
      },
      // Tag + type
      async () => {
        let selector = element.tag
        if (element.type) selector += `[type="${CSS.escape(element.type)}"]`
        const locator = page.locator(selector)
        if (await locator.count() > 0) return locator.first()
        return null
      },
      // Coordinate (last resort)
      async () => {
        const { x, y, width, height } = element.bounds
        const centerX = x + width / 2
        const centerY = y + height / 2
        await page.mouse.click(centerX, centerY)
        // Return body as placeholder since we already clicked
        return page.locator('body')
      }
    ]

    for (const strategy of strategies) {
      try {
        const locator = await strategy()
        if (locator) return locator
      } catch {
        continue
      }
    }

    return null
  }

  /**
   * 执行解析后的动作（基于 ref ID）
   */
  private async executeAction(
    sessionId: string,
    action: any,
    page: Page
  ): Promise<{ success: boolean; result: string }> {
    const sessionState = this.getSessionState(sessionId)

    try {
      switch (action.type) {
        case 'navigate':
          // 安全检查
          try {
            this.securityGuard.assertNavigationAllowed({
              url: action.url,
              timestamp: Date.now()
            })
          } catch (error) {
            if (error instanceof SecurityError) {
              return {
                success: false,
                result: `Security error: ${error.message} (code: ${error.code})`
              }
            }
            throw error
          }

          await page.goto(action.url, { waitUntil: 'networkidle' })
          this.recordAction(sessionId, { action: 'navigate', params: { url: action.url }, success: true })

          // 导航后更新 CDP 上下文
          await this.refreshPageContext(sessionId)

          return { success: true, result: `Navigated to ${page.url()}` }

        case 'click': {
          // 使用 RobustLocator 4层回退定位
          const clickSignature: Partial<ElementSignature> & { index?: number } = {
            index: action.ref,
            hash: action.description?.hash,
            stableHash: action.description?.stableHash,
            tag: action.description?.tag,
            role: action.description?.role,
            name: action.description?.name || action.description?.text,
            ariaLabel: action.description?.ariaLabel,
            placeholder: action.description?.placeholder,
            type: action.description?.type,
            id: action.description?.id,
            bounds: action.description?.bbox
          }

          const clickResult = await this.locateElement(sessionId, clickSignature)
          if (!clickResult) {
            return { success: false, result: `Element not found: ref=${action.ref}, desc=${JSON.stringify(action.description)}` }
          }

          await clickResult.locator.click()
          await page.waitForLoadState('networkidle')
          this.recordAction(sessionId, { action: 'click', params: { ref: action.ref, description: action.description, strategy: clickResult.strategy } })

          return { success: true, result: `Clicked on element [${action.ref}] using ${clickResult.strategy}` }
        }

        case 'type': {
          // 使用 RobustLocator 4层回退定位
          const typeSignature: Partial<ElementSignature> & { index?: number } = {
            index: action.ref,
            hash: action.field?.hash,
            stableHash: action.field?.stableHash,
            tag: action.field?.tag || 'input',
            role: action.field?.role || 'textbox',
            name: action.field?.name,
            ariaLabel: action.field?.ariaLabel,
            placeholder: action.field?.placeholder,
            type: action.field?.type,
            id: action.field?.id,
            bounds: action.field?.bbox
          }

          const typeResult = await this.locateElement(sessionId, typeSignature)
          if (!typeResult) {
            return { success: false, result: `Input field not found: ref=${action.ref}, field=${JSON.stringify(action.field)}` }
          }

          await typeResult.locator.fill(action.text)
          this.recordAction(sessionId, { action: 'type', params: { ref: action.ref, text: action.text, strategy: typeResult.strategy } })

          return { success: true, result: `Typed "${action.text}" into element [${action.ref}] using ${typeResult.strategy}` }
        }

        case 'select': {
          const selectSignature: Partial<ElementSignature> & { index?: number } = {
            index: action.ref,
            tag: 'select',
            role: 'combobox',
            name: action.description?.name
          }
          const selectResult = await this.locateElement(sessionId, selectSignature)
          if (!selectResult) {
            return { success: false, result: `Select field not found: ref=${action.ref}` }
          }
          await selectResult.locator.selectOption(action.option)
          this.recordAction(sessionId, { action: 'select', params: { ref: action.ref, option: action.option, strategy: selectResult.strategy } })
          return { success: true, result: `Selected "${action.option}" in element [${action.ref}] using ${selectResult.strategy}` }
        }

        case 'scroll': {
          if (action.ref !== undefined) {
            const scrollSignature: Partial<ElementSignature> & { index?: number } = {
              index: action.ref,
              tag: action.description?.tag,
              role: action.description?.role,
              name: action.description?.name
            }
            const scrollResult = await this.locateElement(sessionId, scrollSignature)
            if (scrollResult) {
              await scrollResult.locator.scrollIntoViewIfNeeded()
              this.recordAction(sessionId, { action: 'scroll', params: { ref: action.ref, strategy: scrollResult.strategy } })
              return { success: true, result: `Scrolled to element [${action.ref}] using ${scrollResult.strategy}` }
            }
            return { success: false, result: `Element not found for scroll: ref=${action.ref}` }
          } else {
            const direction = action.direction === 'up' ? -1 : 1
            const amount = action.amount || 500
            await page.evaluate((y) => window.scrollBy(0, y), direction * amount)
            this.recordAction(sessionId, { action: 'scroll', params: { direction: action.direction, amount: action.amount } })
            return { success: true, result: `Scrolled ${action.direction} by ${amount}px` }
          }
        }

        case 'wait':
          if (action.selector) {
            await page.waitForSelector(action.selector, { timeout: action.timeout || 5000 })
          } else {
            await page.waitForTimeout(action.timeout || 1000)
          }
          return { success: true, result: `Waited ${action.timeout || 1000}ms` }

        case 'screenshot':
          const screenshot = await page.screenshot({
            type: 'png',
            fullPage: action.fullPage
          })
          return {
            success: true,
            result: `Screenshot captured: ${screenshot.toString('base64').substring(0, 100)}...`
          }

        case 'analyze':
          // 返回页面摘要
          const summary = await this.getPageSummary(sessionId)
          return {
            success: true,
            result: `Page analyzed. ${summary}`
          }

        case 'back':
          await page.goBack()
          return { success: true, result: 'Navigated back' }

        case 'forward':
          await page.goForward()
          return { success: true, result: 'Navigated forward' }

        case 'close':
          await this.close(sessionId)
          return { success: true, result: 'Browser closed for this session' }

        default:
          return { success: false, result: `Unknown action type: ${action.type}` }
      }
    } catch (error) {
      console.error('[BrowserAI] Action failed:', error)
      return {
        success: false,
        result: `Error: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  /**
   * 刷新页面上下文（使用 CDP）
   */
  async refreshPageContext(sessionId: string): Promise<{
    url: string
    title: string
    elements: BrowserUseElement[]
  }> {
    const page = await this.getPage(sessionId)
    const sessionState = this.getSessionState(sessionId)

    const url = page.url()
    const title = await page.title()

    // 使用 CDP 获取元素
    const elements = await browserUseDOM.getInteractiveElements(page)

    // 更新缓存
    sessionState.currentElementMap.clear()
    elements.forEach(el => {
      sessionState.currentElementMap.set(el.index, el)
    })

    // 保存上下文
    sessionState.lastPageContext = {
      url,
      title,
      elements,
      timestamp: Date.now()
    }

    this.recordAction(sessionId, {
      action: 'context',
      params: { url, elementCount: elements.length },
      success: true
    })

    return { url, title, elements }
  }

  /**
   * 通过索引执行点击（基于 CDP）
   */
  async clickByIndex(sessionId: string, index: number): Promise<{ success: boolean; result: string }> {
    const page = await this.getPage(sessionId)
    const sessionState = this.getSessionState(sessionId)

    // 如果缓存中没有，刷新上下文
    if (!sessionState.currentElementMap.has(index)) {
      await this.refreshPageContext(sessionId)
    }

    const element = sessionState.currentElementMap.get(index)
    if (!element) {
      return { success: false, result: `Element with index [${index}] not found` }
    }

    const locator = await this.findElementFromSignature(page, element)
    if (!locator) {
      return { success: false, result: `Could not locate element [${index}]` }
    }

    try {
      await locator.click()
      await page.waitForLoadState('networkidle')

      this.recordAction(sessionId, {
        action: 'click',
        params: { index },
        success: true
      })

      return { success: true, result: `Clicked element [${index}]` }
    } catch (error) {
      return {
        success: false,
        result: `Click failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  /**
   * 通过索引输入文本（基于 CDP）
   */
  async typeByIndex(sessionId: string, index: number, text: string): Promise<{ success: boolean; result: string }> {
    const page = await this.getPage(sessionId)
    const sessionState = this.getSessionState(sessionId)

    // 如果缓存中没有，刷新上下文
    if (!sessionState.currentElementMap.has(index)) {
      await this.refreshPageContext(sessionId)
    }

    const element = sessionState.currentElementMap.get(index)
    if (!element) {
      return { success: false, result: `Element with index [${index}] not found` }
    }

    const locator = await this.findElementFromSignature(page, element)
    if (!locator) {
      return { success: false, result: `Could not locate element [${index}]` }
    }

    try {
      await locator.fill(text)

      this.recordAction(sessionId, {
        action: 'type',
        params: { index, text },
        success: true
      })

      return { success: true, result: `Typed "${text}" into element [${index}]` }
    } catch (error) {
      return {
        success: false,
        result: `Type failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  /**
   * 获取页面 LLM 友好摘要（基于 CDP）
   */
  async getPageSummary(sessionId: string): Promise<string> {
    const sessionState = this.getSessionState(sessionId)

    // 如果没有当前上下文，先获取一个
    if (!sessionState.lastPageContext) {
      await this.refreshPageContext(sessionId)
    }

    if (!sessionState.lastPageContext) {
      return 'Failed to capture page context'
    }

    const { url, title, elements } = sessionState.lastPageContext
    const lines: string[] = []

    lines.push(`Page: ${title}`)
    lines.push(`URL: ${url}`)
    lines.push('')
    lines.push('Available Elements:')
    lines.push('')

    elements.forEach((el) => {
      const role = el.role || el.tag
      const name = el.name || el.placeholder || el.ariaLabel || '(unnamed)'

      let line = `[${el.index}] <${el.tag}>`

      if (role && role !== el.tag) {
        line += ` role="${role}"`
      }

      if (name && name !== '(unnamed)') {
        line += ` name="${name.substring(0, 50)}"`
      }

      if (el.type) {
        line += ` type="${el.type}"`
      }

      lines.push(line)
    })

    lines.push('')
    lines.push(`Total: ${elements.length} interactive elements`)

    return lines.join('\n')
  }

  /**
   * 获取页面上下文（用于服务端 AI 解析）
   * 使用 CDP 获取元素，确保与 executeAction 一致
   */
  async getPageContext(sessionId: string): Promise<{
    url: string
    title: string
    elements: Array<{
      ref: number
      tag: string
      id?: string
      type?: string
      name?: string
      placeholder?: string
      text?: string
      role?: string
      ariaLabel?: string
      hash?: string
      stableHash?: string
    }>
  }> {
    const context = await this.refreshPageContext(sessionId)
    const sessionState = this.getSessionState(sessionId)

    const elements = context.elements.map(el => ({
      ref: el.index,
      tag: el.tag,
      id: el.id,
      type: el.type,
      name: el.name,
      placeholder: el.placeholder,
      text: el.name || el.placeholder || el.ariaLabel,
      role: el.role || el.tag,
      ariaLabel: el.ariaLabel,
      hash: el.hash,
      stableHash: el.stableHash
    }))

    console.log(`[BrowserAI] Page context: ${elements.length} elements at ${context.url}`)

    // 打印所有元素用于调试（特别是检测弹窗元素）
    elements.forEach(el => {
      console.log(`[BrowserAI]   ref=${el.ref}, tag=${el.tag}, role=${el.role}, name="${el.name?.substring(0, 30)}"`)
    })

    return {
      url: context.url,
      title: context.title,
      elements
    }
  }

  /**
   * 记录操作历史
   */
  private recordAction(sessionId: string, action: BrowserAction): void {
    const sessionState = this.getSessionState(sessionId)
    sessionState.actionHistory.push({
      ...action,
      timestamp: Date.now()
    })
    // 只保留最近 50 条
    if (sessionState.actionHistory.length > 50) {
      sessionState.actionHistory.shift()
    }
  }

  /**
   * 获取操作历史
   */
  getActionHistory(sessionId: string): BrowserAction[] {
    const sessionState = this.getSessionState(sessionId)
    return [...sessionState.actionHistory]
  }

  /**
   * 获取当前 URL
   */
  async getCurrentUrl(sessionId: string): Promise<string | null> {
    try {
      const page = await this.getPage(sessionId)
      return page.url()
    } catch {
      return null
    }
  }

  /**
   * 获取 DOM 哈希（用于检测页面变化）
   * 使用页面可交互元素的数量和关键属性生成简单哈希
   */
  async getDOMHash(sessionId: string): Promise<string> {
    try {
      const page = await this.getPage(sessionId)

      // 使用 page.evaluate 获取页面特征
      const domFeatures = await page.evaluate(() => {
        const interactiveElements = document.querySelectorAll(
          'button, input, textarea, select, a, [role="button"], [role="link"], [onclick]'
        )

        // 收集关键特征
        const features = {
          url: window.location.href,
          elementCount: interactiveElements.length,
          // 前 10 个元素的标签和文本特征
          elementSignatures: Array.from(interactiveElements)
            .slice(0, 10)
            .map(el => ({
              tag: el.tagName,
              id: el.id,
              text: el.textContent?.slice(0, 20) || ''
            })),
          // 是否有弹窗
          hasModal: !!document.querySelector('[role="dialog"], [role="alertdialog"], .modal'),
          // 页面滚动位置
          scrollY: window.scrollY
        }

        return features
      })

      // 生成简单哈希
      const hashInput = JSON.stringify(domFeatures)
      let hash = 0
      for (let i = 0; i < hashInput.length; i++) {
        const char = hashInput.charCodeAt(i)
        hash = ((hash << 5) - hash) + char
        hash = hash & hash
      }

      return hash.toString(16)
    } catch (error) {
      console.error('[BrowserAI] Failed to get DOM hash:', error)
      return Date.now().toString(16) // 失败时返回时间戳，确保不缓存
    }
  }

  /**
   * 返回上一页
   */
  async back(sessionId: string): Promise<void> {
    const page = await this.getPage(sessionId)
    await page.goBack()
  }

  /**
   * 前进到下一页
   */
  async forward(sessionId: string): Promise<void> {
    const page = await this.getPage(sessionId)
    await page.goForward()
  }

  /**
   * 关闭指定会话的浏览器上下文
   */
  async close(sessionId: string): Promise<void> {
    // 清理会话状态
    this.sessionStates.delete(sessionId)
    // 通过 BrowserManager 关闭 context（保留 browser 实例）
    await browserManager.closeSession(sessionId)
    console.log(`[BrowserAI] Session ${sessionId} closed`)
  }

  /**
   * 关闭所有会话
   */
  async closeAll(): Promise<void> {
    this.sessionStates.clear()
    await browserManager.closeAllSessions()
    console.log('[BrowserAI] All sessions closed')
  }
}

// 导出单例（不再是单例 browser，而是管理多个 session 的 manager）
export const browserAI = new BrowserAI()
