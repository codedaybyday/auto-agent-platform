/**
 * AI 友好的 Browser 工具增强版
 * 基于 Playwright，提供语义化操作和智能页面分析
 *
 * 增强功能：
 * - Snapshot 系统（role/aria/ai 三种格式）
 * - 元素稳定引用（aria-ref）
 * - 安全层（SSRF 防护、URL 校验）
 * - 操作历史追踪和重试
 */

import { Browser, BrowserContext, Page, chromium, Locator } from 'playwright'
import { snapshotManager, PageSnapshot, SnapshotFormat } from './browser-snapshot'
import { BrowserSecurityGuard, defaultSecurityGuard, SecurityError } from './browser-security'
import { DOMSerializer, SerializedDOM, domSerializer } from './dom-serializer'
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
  action: 'navigate' | 'click' | 'type' | 'select' | 'hover' | 'scroll' | 'wait' | 'screenshot' | 'analyze' | 'back' | 'forward' | 'close' | 'snapshot'
  params: Record<string, any>
  timestamp?: number
  success?: boolean
  error?: string
}

export interface BrowserAIConfig {
  headless?: boolean
  securityGuard?: BrowserSecurityGuard
  snapshotFormat?: SnapshotFormat
  enableSnapshots?: boolean
  maxRetries?: number
  // 已移除：LLM 配置移到后端
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
  private currentSnapshot: PageSnapshot | null = null
  private currentDOM: SerializedDOM | null = null
  private config: Required<BrowserAIConfig>
  private securityGuard: BrowserSecurityGuard
  private domSerializer: DOMSerializer

  constructor(config: BrowserAIConfig = {}) {
    this.config = {
      headless: config.headless ?? false,
      securityGuard: config.securityGuard ?? defaultSecurityGuard,
      snapshotFormat: config.snapshotFormat ?? 'role',
      enableSnapshots: config.enableSnapshots ?? true,
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
   * 初始化浏览器
   */
  async initialize(headless?: boolean): Promise<void> {
    if (!this.browser) {
      const useHeadless = headless ?? this.config.headless
      this.browser = await chromium.launch({ headless: useHeadless })
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      })
      this.page = await this.context.newPage()

      // 设置默认超时
      this.page.setDefaultTimeout(10000)
      this.page.setDefaultNavigationTimeout(30000)

      // 设置请求拦截（安全检查）
      await this.setupSecurityInterceptors()

      console.log('[BrowserAI] Browser initialized')
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
   * 获取当前页面的 DOM 序列化
   */
  async getSerializedDOM(): Promise<SerializedDOM> {
    await this.initialize()
    const page = this.page!

    const serialized = await this.domSerializer.serialize(page)
    this.currentDOM = serialized

    console.log(`[BrowserAI] DOM serialized: ${serialized.stats.finalElements} elements (${serialized.stats.sizeKB}KB)`)

    return serialized
  }

  /**
   * 获取当前 DOM 的 LLM 友好格式
   */
  async getLLMContext(): Promise<string> {
    const dom = await this.getSerializedDOM()
    return this.domSerializer.formatForLLM(dom)
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
    description?: string
    text?: string
    field?: string
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
   * 使用 LLM 进行语义化操作
   *
   * 工作流程：
   * 1. 获取序列化 DOM（五级流水线处理后约 200 个元素）
   * 2. 构建 LLM 提示词，包含 DOM 上下文和用户指令
   * 3. 调用 LLM 解析为结构化动作
   * 4. 执行动作并返回结果
   */
  private async findElementByRef(ref: number): Promise<Locator | null> {
    const page = this.page!

    if (!this.currentDOM) {
      await this.getSerializedDOM()
    }

    const element = this.domSerializer.findElement(this.currentDOM!, ref)
    if (!element) return null

    // 使用坐标定位
    return page.locator(`xpath=//*[contains(@data-bbox, '${element.bbox.x},${element.bbox.y}')]`).first()
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

          // 自动捕获 snapshot
          if (this.config.enableSnapshots) {
            await this.captureSnapshot()
          }

          return { success: true, result: `Navigated to ${page.url()}` }

        case 'click':
          // 使用 ref 或 description 查找元素
          let clickTarget: Locator | null = null
          if (action.ref !== undefined) {
            clickTarget = await this.findElementByRef(action.ref)
          }
          if (!clickTarget && action.description) {
            // 降级到描述查找
            const match = this.domSerializer.findElementByDescription(
              this.currentDOM!,
              action.description
            )
            if (match) {
              clickTarget = await this.findElementByRef(match.id)
            }
          }
          if (!clickTarget) {
            return { success: false, result: `Element not found: ref=${action.ref}, desc=${action.description}` }
          }
          await clickTarget.click()
          await page.waitForLoadState('networkidle')
          this.recordAction({ action: 'click', params: { ref: action.ref, description: action.description } })
          return { success: true, result: `Clicked on element [${action.ref}]` }

        case 'type':
          let inputTarget: Locator | null = null
          if (action.ref !== undefined) {
            inputTarget = await this.findElementByRef(action.ref)
          }
          if (!inputTarget && action.field) {
            const match = this.domSerializer.findElementByDescription(
              this.currentDOM!,
              action.field
            )
            if (match) {
              inputTarget = await this.findElementByRef(match.id)
            }
          }
          if (!inputTarget) {
            return { success: false, result: `Input field not found: ref=${action.ref}, field=${action.field}` }
          }
          await inputTarget.fill(action.text)
          this.recordAction({ action: 'type', params: { ref: action.ref, text: action.text } })
          return { success: true, result: `Typed "${action.text}" into element [${action.ref}]` }

        case 'select':
          let selectTarget: Locator | null = null
          if (action.ref !== undefined) {
            selectTarget = await this.findElementByRef(action.ref)
          }
          if (!selectTarget) {
            return { success: false, result: `Select field not found: ref=${action.ref}` }
          }
          await selectTarget.selectOption(action.option)
          this.recordAction({ action: 'select', params: { ref: action.ref, option: action.option } })
          return { success: true, result: `Selected "${action.option}" in element [${action.ref}]` }

        case 'scroll':
          if (action.ref !== undefined) {
            const scrollTarget = await this.findElementByRef(action.ref)
            if (scrollTarget) {
              await scrollTarget.scrollIntoViewIfNeeded()
              this.recordAction({ action: 'scroll', params: { ref: action.ref } })
              return { success: true, result: `Scrolled to element [${action.ref}]` }
            }
            return { success: false, result: `Element not found for scroll: ref=${action.ref}` }
          } else {
            const direction = action.direction === 'up' ? -1 : 1
            const amount = action.amount || 500
            await page.evaluate((y) => window.scrollBy(0, y), direction * amount)
            this.recordAction({ action: 'scroll', params: { direction: action.direction, amount: action.amount } })
            return { success: true, result: `Scrolled ${action.direction} by ${amount}px` }
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
   * 捕获当前页面 Snapshot
   */
  async captureSnapshot(format?: SnapshotFormat): Promise<PageSnapshot> {
    await this.initialize()
    const page = this.page!

    const snapshot = await snapshotManager.capture(page, {
      format: format || this.config.snapshotFormat,
      interactiveOnly: true,
      compact: true
    })

    this.currentSnapshot = snapshot
    this.recordAction({
      action: 'snapshot',
      params: { format: snapshot.format },
      success: true
    })

    return snapshot
  }

  /**
   * 获取当前 Snapshot
   */
  getCurrentSnapshot(): PageSnapshot | null {
    return this.currentSnapshot
  }

  /**
   * 通过 ref 执行点击（支持稳定引用）
   */
  async clickByRef(ref: string): Promise<{ success: boolean; result: string }> {
    await this.initialize()
    const page = this.page!

    // 如果没有当前 snapshot，先捕获一个
    if (!this.currentSnapshot) {
      await this.captureSnapshot()
    }

    if (!this.currentSnapshot) {
      return { success: false, result: 'Failed to capture page snapshot' }
    }

    // 查找元素
    const locator = await snapshotManager.findByRef(page, ref, this.currentSnapshot)
    if (!locator) {
      return { success: false, result: `Element with ref '${ref}' not found` }
    }

    try {
      await locator.click()
      await page.waitForLoadState('networkidle')

      // 重新捕获 snapshot
      if (this.config.enableSnapshots) {
        await this.captureSnapshot()
      }

      this.recordAction({
        action: 'click',
        params: { ref },
        success: true
      })

      return { success: true, result: `Clicked element [${ref}]` }
    } catch (error) {
      return {
        success: false,
        result: `Click failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  /**
   * 通过 ref 输入文本（支持稳定引用）
   */
  async typeByRef(ref: string, text: string): Promise<{ success: boolean; result: string }> {
    await this.initialize()
    const page = this.page!

    // 如果没有当前 snapshot，先捕获一个
    if (!this.currentSnapshot) {
      await this.captureSnapshot()
    }

    if (!this.currentSnapshot) {
      return { success: false, result: 'Failed to capture page snapshot' }
    }

    // 查找元素
    const locator = await snapshotManager.findByRef(page, ref, this.currentSnapshot)
    if (!locator) {
      return { success: false, result: `Element with ref '${ref}' not found` }
    }

    try {
      await locator.fill(text)

      this.recordAction({
        action: 'type',
        params: { ref, text },
        success: true
      })

      return { success: true, result: `Typed "${text}" into element [${ref}]` }
    } catch (error) {
      return {
        success: false,
        result: `Type failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  /**
   * 获取页面 LLM 友好摘要（基于 Snapshot）
   */
  async getPageSummary(): Promise<string> {
    // 如果没有当前 snapshot，先捕获一个
    if (!this.currentSnapshot) {
      await this.captureSnapshot()
    }

    if (!this.currentSnapshot) {
      return 'Failed to capture page snapshot'
    }

    return snapshotManager.toAIFormat(this.currentSnapshot)
  }

  /**
   * 获取页面上下文（用于服务端 AI 解析）
   * 返回页面 URL、标题和可交互元素列表
   */
  async getPageContext(): Promise<{
    url: string
    title: string
    elements: Array<{
      ref: number
      tag: string
      type?: string
      name?: string
      placeholder?: string
      text?: string
      role?: string
      ariaLabel?: string
    }>
  }> {
    await this.initialize()
    const page = this.page!

    const url = page.url()
    const title = await page.title()

    console.log(`[BrowserAI] getPageContext start - URL: ${url}, Title: ${title}`)

    console.log(`[BrowserAI] Starting page.evaluate...`)

    // 提取可交互元素
    const result = await page.evaluate(() => {
      const logs: string[] = []
      logs.push(`[BrowserAI] page.evaluate started`)
      logs.push(`[BrowserAI] document.URL: ${document.URL}`)
      logs.push(`[BrowserAI] document.title: ${document.title}`)
      logs.push(`[BrowserAI] document.body exists: ${!!document.body}`)
      if (document.body) {
        logs.push(`[BrowserAI] document.body.innerHTML length: ${document.body.innerHTML.length}`)
        logs.push(`[BrowserAI] document.body children count: ${document.body.children.length}`)
      }

      const interactiveSelectors = [
        'input[type="text"]',
        'input[type="search"]',
        'input[type="email"]',
        'input[type="password"]',
        'input[type="submit"]',
        'input[type="button"]',
        'button',
        'a[href]',
        'textarea',
        'select',
        '[role="button"]',
        '[role="link"]',
        '[role="textbox"]',
        '[role="searchbox"]',
        '[contenteditable="true"]'
      ]

      const results: Array<{
        ref: number
        tag: string
        type?: string
        name?: string
        placeholder?: string
        text?: string
        role?: string
        ariaLabel?: string
      }> = []

      let refCounter = 1

      interactiveSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector)

        if (elements.length > 0) {
          logs.push(`[BrowserAI] Selector "${selector}" found ${elements.length} elements`)
        }
        elements.forEach(el => {
          const rect = el.getBoundingClientRect()
          const elId = el.id || '(no id)'
          logs.push(`[BrowserAI] Element: ${el.tagName}#${elId}, visible=${rect.width > 0 && rect.height > 0}, size=${rect.width}x${rect.height}`)
          // 只包含可见元素
          if (rect.width === 0 || rect.height === 0) {
            logs.push(`[BrowserAI]   -> skipped (not visible)`)
            return
          }

          const text = el.textContent?.trim().substring(0, 100) ||
                      (el as HTMLInputElement).value?.substring(0, 100) ||
                      (el as HTMLInputElement).placeholder ||
                      ''

          const elementData = {
            ref: refCounter++,
            tag: el.tagName.toLowerCase(),
            type: (el as HTMLInputElement).type,
            name: (el as HTMLInputElement).name,
            placeholder: (el as HTMLInputElement).placeholder,
            text: text || undefined,
            role: el.getAttribute('role') || undefined,
            ariaLabel: el.getAttribute('aria-label') || undefined
          }

          logs.push(`[BrowserAI]   -> ADDED ref=${elementData.ref}, tag=${elementData.tag}, placeholder="${elementData.placeholder?.substring(0, 20)}"`)
          results.push(elementData)
        })
      })

      logs.push(`[BrowserAI] Total elements found: ${results.length}`)
      return { elements: results, logs }
    })

    const elements = result.elements
    // 打印从页面 evaluate 返回的日志
    result.logs.forEach(log => console.log(log))

    console.log(`[BrowserAI] Page context: ${elements.length} elements at ${url}`)

    return { url, title, elements }
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
      console.log('[BrowserAI] Browser closed')
    }
  }
}

// 导出单例
export const browserAI = new BrowserAI()
