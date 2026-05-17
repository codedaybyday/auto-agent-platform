/**
 * AI 友好的 Browser 工具增强版
 * 基于 Playwright，提供语义化操作和智能页面分析
 *
 * 增强功能：
 * - CDP 获取页面元素（browser-use 风格）
 * - 元素稳定引用（hash + stableHash）
 * - 安全层（SSRF 防护、URL 校验）
 * - 操作历史追踪和重试
 */

import { Browser, BrowserContext, Page, chromium, Locator } from 'playwright'
import { BrowserSecurityGuard, defaultSecurityGuard, SecurityError } from './browser-security'
import { DOMSerializer, SerializedDOM, domSerializer } from './dom-serializer'
import { RobustLocator, robustLocator } from './robust-locator'
import type { ElementSignature } from './element-hash'
import type { BrowserUseElement } from './browser-use-dom'
import { browserUseDOM } from './browser-use-dom'
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

// Browser 工具定义已移到后端服务

export class BrowserAI {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private actionHistory: BrowserAction[] = []
  private currentDOM: SerializedDOM | null = null
  private config: Required<BrowserAIConfig>
  private securityGuard: BrowserSecurityGuard
  private domSerializer: DOMSerializer
  // Browser-use style: cached element map (index -> element)
  private currentElementMap: Map<number, BrowserUseElement> = new Map()
  // Last captured page context
  private lastPageContext: {
    url: string
    title: string
    elements: BrowserUseElement[]
    timestamp: number
  } | null = null

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
   * 初始化浏览器（无头+stealth 模式）
   */
  async initialize(headless?: boolean): Promise<void> {
    if (!this.browser) {
      const useHeadless = headless ?? this.config.headless

      this.browser = await chromium.launch({
        headless: useHeadless,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-site-isolation-trials',
          '--disable-dev-shm-usage',
          '--window-size=1280,720',
          '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.0.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ]
      })
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.0.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai'
      })
      this.page = await this.context.newPage()

      // 注入 stealth 脚本
      await this.page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
        // @ts-ignore
        if (!window.chrome) window.chrome = {}
        Object.defineProperty(navigator, 'plugins', {
          get: () => [{ name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' }]
        })
      })

      this.page.setDefaultTimeout(10000)
      this.page.setDefaultNavigationTimeout(30000)
      await this.setupSecurityInterceptors()

      console.log('[BrowserAI] Browser initialized (stealth mode)')
    }
  }

  /**
   * 设置安全拦截器
   */
  private async setupSecurityInterceptors(): Promise<void> {
    if (!this.page) return

    // 监听导航事件
    this.page.on('framenavigated', async (frame) => {
      if (frame === this.page!.mainFrame()) {
        try {
          this.securityGuard.assertNavigationAllowed({
            url: frame.url(),
            timestamp: Date.now()
          })
        } catch (error) {
          console.error('[BrowserAI] Security check failed:', error)
          // 阻止继续导航
          await this.page!.evaluate(() => window.stop())
        }
      }
    })
  }

  /**
   * 执行浏览器动作
   * 由后端 LLM 解析指令后调用，接收结构化的动作参数
   *
   * @param action 结构化动作对象
   * @returns 执行结果
   */
  async executeBrowserAction(action: {
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
  }): Promise<{ success: boolean; result: string }> {
    await this.initialize()

    console.log(`[BrowserAI] Executing action: ${action.type}`, action)

    return this.executeAction(action, this.page!)
  }

  /**
   * 智能元素定位 - Browser-use style
   * 优先使用缓存的 element map，保持一致性
   */
  private async locateElement(signature: Partial<ElementSignature> & { index?: number }): Promise<{ locator: Locator; strategy: string } | null> {
    const page = this.page!

    // 优先使用缓存的 element map（与 getPageContext 一致）
    if (signature.index !== undefined && this.currentElementMap.has(signature.index)) {
      const element = this.currentElementMap.get(signature.index)!
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
    action: any,
    page: Page
  ): Promise<{ success: boolean; result: string }> {
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
          this.recordAction({ action: 'navigate', params: { url: action.url }, success: true })

          // 导航后更新 CDP 上下文
          await this.refreshPageContext()

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

          const clickResult = await this.locateElement(clickSignature)
          if (!clickResult) {
            return { success: false, result: `Element not found: ref=${action.ref}, desc=${JSON.stringify(action.description)}` }
          }

          await clickResult.locator.click()
          await page.waitForLoadState('networkidle')
          this.recordAction({ action: 'click', params: { ref: action.ref, description: action.description, strategy: clickResult.strategy } })

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

          const typeResult = await this.locateElement(typeSignature)
          if (!typeResult) {
            return { success: false, result: `Input field not found: ref=${action.ref}, field=${JSON.stringify(action.field)}` }
          }

          await typeResult.locator.fill(action.text)
          this.recordAction({ action: 'type', params: { ref: action.ref, text: action.text, strategy: typeResult.strategy } })

          return { success: true, result: `Typed "${action.text}" into element [${action.ref}] using ${typeResult.strategy}` }
        }

        case 'select': {
          const selectSignature: Partial<ElementSignature> & { index?: number } = {
            index: action.ref,
            tag: 'select',
            role: 'combobox',
            name: action.description?.name
          }
          const selectResult = await this.locateElement(selectSignature)
          if (!selectResult) {
            return { success: false, result: `Select field not found: ref=${action.ref}` }
          }
          await selectResult.locator.selectOption(action.option)
          this.recordAction({ action: 'select', params: { ref: action.ref, option: action.option, strategy: selectResult.strategy } })
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
            const scrollResult = await this.locateElement(scrollSignature)
            if (scrollResult) {
              await scrollResult.locator.scrollIntoViewIfNeeded()
              this.recordAction({ action: 'scroll', params: { ref: action.ref, strategy: scrollResult.strategy } })
              return { success: true, result: `Scrolled to element [${action.ref}] using ${scrollResult.strategy}` }
            }
            return { success: false, result: `Element not found for scroll: ref=${action.ref}` }
          } else {
            const direction = action.direction === 'up' ? -1 : 1
            const amount = action.amount || 500
            await page.evaluate((y) => window.scrollBy(0, y), direction * amount)
            this.recordAction({ action: 'scroll', params: { direction: action.direction, amount: action.amount } })
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
          const summary = await this.getPageSummary()
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
          await this.close()
          return { success: true, result: 'Browser closed' }

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
   * 智能页面分析 - 提取 LLM 友好的页面结构
   */
  async analyzePage(): Promise<PageAnalysis> {
    await this.initialize()
    const page = this.page!

    const analysis = await page.evaluate(() => {
      const result: PageAnalysis = {
        url: window.location.href,
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.getAttribute('content') || undefined,
        interactiveElements: [],
        forms: [],
        links: [],
        headings: [],
        textContent: ''
      }

      // 提取标题
      document.querySelectorAll('h1, h2, h3').forEach((el) => {
        result.headings.push({
          level: parseInt(el.tagName[1]),
          text: el.textContent?.trim() || ''
        })
      })

      // 提取可交互元素
      const interactiveSelectors = [
        'button',
        'a[href]',
        'input[type="text"]',
        'input[type="search"]',
        'input[type="email"]',
        'input[type="password"]',
        'input[type="submit"]',
        'textarea',
        'select',
        '[role="button"]',
        '[role="link"]',
        '[onclick]'
      ]

      const seenElements = new Set<Element>()

      interactiveSelectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((el) => {
          if (seenElements.has(el)) return
          seenElements.add(el)

          const rect = el.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) return // 不可见元素

          const element: PageElement = {
            tag: el.tagName.toLowerCase(),
            selector: '', // 稍后生成
            role: el.getAttribute('role') || undefined,
            name: el.getAttribute('name') || undefined,
            text: el.textContent?.trim().substring(0, 100),
            placeholder: el.getAttribute('placeholder') || undefined,
            type: (el as HTMLInputElement).type || undefined,
            href: (el as HTMLAnchorElement).href || undefined,
            boundingBox: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height
            }
          }

          // 生成选择器
          if (el.id) {
            element.selector = `#${el.id}`
          } else if (el.className && typeof el.className === 'string') {
            element.selector = `.${el.className.split(' ')[0]}`
          } else {
            element.selector = el.tagName.toLowerCase()
          }

          result.interactiveElements.push(element)

          // 分类
          if (el.tagName === 'A' && (el as HTMLAnchorElement).href) {
            result.links.push(element)
          }
        })
      })

      // 提取表单
      document.querySelectorAll('form').forEach((form, index) => {
        const fields: PageElement[] = []
        let submitButton: PageElement | undefined

        form.querySelectorAll('input, textarea, select').forEach((field) => {
          const fieldInfo: PageElement = {
            tag: field.tagName.toLowerCase(),
            selector: `${form.tagName.toLowerCase()}:nth-of-type(${index + 1}) ${field.tagName.toLowerCase()}`,
            name: field.getAttribute('name') || undefined,
            placeholder: field.getAttribute('placeholder') || undefined,
            type: (field as HTMLInputElement).type || undefined
          }
          fields.push(fieldInfo)

          if ((field as HTMLInputElement).type === 'submit') {
            submitButton = fieldInfo
          }
        })

        result.forms.push({
          selector: `form:nth-of-type(${index + 1})`,
          fields,
          submitButton
        })
      })

      // 提取主要内容文本
      const mainContent = document.querySelector('main, article, [role="main"], .content, #content')
      if (mainContent) {
        result.textContent = mainContent.textContent?.trim().substring(0, 3000) || ''
      } else {
        result.textContent = document.body.textContent?.trim().substring(0, 2000) || ''
      }

      return result
    })

    return analysis
  }

  /**
   * 提取结构化数据 - 根据给定的模式提取页面数据
   */
  async extractData<T = any>(schema: {
    [key: string]: {
      selector: string
      attribute?: string
      multiple?: boolean
    }
  }): Promise<{ success: boolean; data?: T; error?: string }> {
    await this.initialize()
    const page = this.page!

    try {
      const result = await page.evaluate((extractSchema) => {
        const data: any = {}

        for (const [key, config] of Object.entries(extractSchema)) {
          if (config.multiple) {
            const elements = Array.from(document.querySelectorAll(config.selector))
            data[key] = elements.map((el) => {
              if (config.attribute) {
                return el.getAttribute(config.attribute)
              }
              return el.textContent?.trim()
            })
          } else {
            const el = document.querySelector(config.selector)
            if (el) {
              if (config.attribute) {
                data[key] = el.getAttribute(config.attribute)
              } else {
                data[key] = el.textContent?.trim()
              }
            }
          }
        }

        return data
      }, schema)

      return { success: true, data: result as T }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * 根据坐标查找元素（备用方法）
   */
  private async findElementByCoordinates(x: number, y: number): Promise<Locator | null> {
    const page = this.page!
    // 使用坐标点击
    try {
      await page.mouse.click(x, y)
      return page.locator('body') // 返回 body 作为占位符
    } catch {
      return null
    }
  }

  /**
   * 记录操作历史
   */
  private recordAction(action: BrowserAction): void {
    this.actionHistory.push({
      ...action,
      timestamp: Date.now()
    })
    // 只保留最近 50 条
    if (this.actionHistory.length > 50) {
      this.actionHistory.shift()
    }
  }

  /**
   * 刷新页面上下文（使用 CDP）
   */
  async refreshPageContext(): Promise<{
    url: string
    title: string
    elements: BrowserUseElement[]
  }> {
    await this.initialize()
    const page = this.page!

    const url = page.url()
    const title = await page.title()

    // 使用 CDP 获取元素
    const elements = await browserUseDOM.getInteractiveElements(page)

    // 更新缓存
    this.currentElementMap.clear()
    elements.forEach(el => {
      this.currentElementMap.set(el.index, el)
    })

    // 保存上下文
    this.lastPageContext = {
      url,
      title,
      elements,
      timestamp: Date.now()
    }

    this.recordAction({
      action: 'context',
      params: { url, elementCount: elements.length },
      success: true
    })

    return { url, title, elements }
  }

  /**
   * 通过索引执行点击（基于 CDP）
   */
  async clickByIndex(index: number): Promise<{ success: boolean; result: string }> {
    await this.initialize()
    const page = this.page!

    // 如果缓存中没有，刷新上下文
    if (!this.currentElementMap.has(index)) {
      await this.refreshPageContext()
    }

    const element = this.currentElementMap.get(index)
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

      this.recordAction({
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
  async typeByIndex(index: number, text: string): Promise<{ success: boolean; result: string }> {
    await this.initialize()
    const page = this.page!

    // 如果缓存中没有，刷新上下文
    if (!this.currentElementMap.has(index)) {
      await this.refreshPageContext()
    }

    const element = this.currentElementMap.get(index)
    if (!element) {
      return { success: false, result: `Element with index [${index}] not found` }
    }

    const locator = await this.findElementFromSignature(page, element)
    if (!locator) {
      return { success: false, result: `Could not locate element [${index}]` }
    }

    try {
      await locator.fill(text)

      this.recordAction({
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
  async getPageSummary(): Promise<string> {
    // 如果没有当前上下文，先获取一个
    if (!this.lastPageContext) {
      await this.refreshPageContext()
    }

    if (!this.lastPageContext) {
      return 'Failed to capture page context'
    }

    const { url, title, elements } = this.lastPageContext
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
  async getPageContext(): Promise<{
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
    await this.initialize()

    const context = await this.refreshPageContext()

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

    // 打印前 10 个元素用于调试
    elements.slice(0, 10).forEach(el => {
      console.log(`[BrowserAI]   ref=${el.ref}, tag=${el.tag}, role=${el.role}, name="${el.name?.substring(0, 20)}"`)
    })

    return {
      url: context.url,
      title: context.title,
      elements
    }
  }

  /**
   * 获取操作历史
   */
  getActionHistory(): BrowserAction[] {
    return [...this.actionHistory]
  }

  /**
   * 获取当前 URL
   */
  getCurrentUrl(): string | null {
    return this.page?.url() || null
  }

  /**
   * 返回上一页
   */
  async back(): Promise<void> {
    await this.page?.goBack()
  }

  /**
   * 前进到下一页
   */
  async forward(): Promise<void> {
    await this.page?.goForward()
  }

  /**
   * 关闭浏览器
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
      this.context = null
      this.page = null
      this.actionHistory = []
      this.currentElementMap.clear()
      this.lastPageContext = null
      console.log('[BrowserAI] Browser closed')
    }
  }
}

// 导出单例
export const browserAI = new BrowserAI()
