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
}

export class BrowserAI {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private actionHistory: BrowserAction[] = []
  private currentSnapshot: PageSnapshot | null = null
  private config: Required<BrowserAIConfig>
  private securityGuard: BrowserSecurityGuard

  constructor(config: BrowserAIConfig = {}) {
    this.config = {
      headless: config.headless ?? false,
      securityGuard: config.securityGuard ?? defaultSecurityGuard,
      snapshotFormat: config.snapshotFormat ?? 'role',
      enableSnapshots: config.enableSnapshots ?? true,
      maxRetries: config.maxRetries ?? 1
    }
    this.securityGuard = this.config.securityGuard
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
   * 语义化操作 - 用自然语言描述执行浏览器操作
   * 支持的操作描述：
   * - "点击{文本}" / "click on {text}"
   * - "在{字段}输入{内容}" / "type {text} in {field}"
   * - "搜索{关键词}" / "search for {keyword}"
   * - "选择{选项}" / "select {option}"
   * - "滚动到{元素}" / "scroll to {element}"
   */
  async semanticAct(instruction: string): Promise<{ success: boolean; result: string }> {
    await this.initialize()
    const page = this.page!

    console.log(`[BrowserAI] Semantic action: ${instruction}`)

    try {
      // 1. 先分析页面，获取当前可交互元素
      const analysis = await this.analyzePage()

      // 2. 解析指令意图
      const action = this.parseInstruction(instruction, analysis)

      // 3. 执行操作
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
          const clickTarget = await this.findElement(action.target, analysis)
          if (!clickTarget) {
            return { success: false, result: `Element not found: ${action.target}` }
          }
          await clickTarget.click()
          await page.waitForLoadState('networkidle')
          this.recordAction({ action: 'click', params: { target: action.target } })
          return { success: true, result: `Clicked on "${action.target}"` }

        case 'type':
          const inputTarget = await this.findInputField(action.field, analysis)
          if (!inputTarget) {
            return { success: false, result: `Input field not found: ${action.field}` }
          }
          await inputTarget.fill(action.text)
          this.recordAction({ action: 'type', params: { field: action.field, text: action.text } })
          return { success: true, result: `Typed "${action.text}" into "${action.field}"` }

        case 'search':
          // 智能搜索：找到搜索框，输入内容，提交
          const searchInput = await this.findSearchField(analysis)
          if (!searchInput) {
            return { success: false, result: 'Search field not found' }
          }
          await searchInput.fill(action.keyword)

          // 尝试找到搜索按钮或直接回车
          const searchButton = await this.findSearchButton(analysis)
          if (searchButton) {
            await searchButton.click()
          } else {
            await searchInput.press('Enter')
          }
          await page.waitForLoadState('networkidle')
          this.recordAction({ action: 'type', params: { keyword: action.keyword } })
          return { success: true, result: `Searched for "${action.keyword}"` }

        case 'scroll':
          if (action.direction === 'to_element') {
            const scrollTarget = await this.findElement(action.target, analysis)
            if (scrollTarget) {
              await scrollTarget.scrollIntoViewIfNeeded()
            }
          } else {
            const direction = action.direction === 'up' ? -1 : 1
            const amount = action.amount || 500
            await page.evaluate((y) => window.scrollBy(0, y), direction * amount)
          }
          this.recordAction({ action: 'scroll', params: { direction: action.direction, amount: action.amount } })
          return { success: true, result: `Scrolled ${action.direction}` }

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
   * 解析自然语言指令
   */
  private parseInstruction(instruction: string, analysis: PageAnalysis): any {
    const lowerInst = instruction.toLowerCase()

    // 导航
    if (lowerInst.startsWith('go to ') || lowerInst.startsWith('navigate to ') || lowerInst.startsWith('open ')) {
      const url = instruction.replace(/^(go to|navigate to|open)\s+/i, '').trim()
      return { type: 'navigate', url: url.startsWith('http') ? url : `https://${url}` }
    }

    // 点击
    if (lowerInst.startsWith('click ') || lowerInst.startsWith('click on ') || lowerInst.startsWith('press ')) {
      const target = instruction.replace(/^(click on|click|press)\s+/i, '').trim().replace(/["']/g, '')
      return { type: 'click', target }
    }

    // 输入
    const typeMatch = instruction.match(/type\s+["']?(.+?)["']?\s+in(?:to)?\s+["']?(.+?)["']?$/i)
    if (typeMatch) {
      return { type: 'type', text: typeMatch[1], field: typeMatch[2] }
    }

    // 搜索
    if (lowerInst.startsWith('search for ') || lowerInst.startsWith('search ')) {
      const keyword = instruction.replace(/^search\s+(for\s+)?/i, '').trim().replace(/["']/g, '')
      return { type: 'search', keyword }
    }

    // 滚动
    if (lowerInst.includes('scroll')) {
      if (lowerInst.includes('up')) {
        return { type: 'scroll', direction: 'up', amount: 500 }
      } else if (lowerInst.includes('down')) {
        return { type: 'scroll', direction: 'down', amount: 500 }
      } else {
        return { type: 'scroll', direction: 'down', amount: 500 }
      }
    }

    // 等待
    if (lowerInst.startsWith('wait')) {
      const timeout = parseInt(lowerInst.match(/\d+/)?.[0] || '1000')
      return { type: 'wait', timeout }
    }

    // 截图
    if (lowerInst.includes('screenshot') || lowerInst.includes('take a photo')) {
      return { type: 'screenshot', fullPage: lowerInst.includes('full') }
    }

    // 默认尝试作为点击处理
    return { type: 'click', target: instruction }
  }

  /**
   * 根据文本查找元素
   */
  private async findElement(text: string, analysis: PageAnalysis): Promise<Locator | null> {
    const page = this.page!
    const lowerText = text.toLowerCase()

    // 1. 先在分析结果中查找
    const matchingElement = analysis.interactiveElements.find((e) =>
      e.text?.toLowerCase().includes(lowerText) ||
      e.name?.toLowerCase().includes(lowerText) ||
      e.placeholder?.toLowerCase().includes(lowerText)
    )

    if (matchingElement) {
      try {
        return page.locator(matchingElement.selector).first()
      } catch {
        // 继续尝试其他方法
      }
    }

    // 2. 尝试用 Playwright 的 getByText
    try {
      const locator = page.getByText(text, { exact: false })
      if (await locator.count() > 0) {
        return locator.first()
      }
    } catch {
      // 继续尝试
    }

    // 3. 尝试用 role 和 name
    try {
      const locator = page.getByRole('button', { name: text, exact: false })
      if (await locator.count() > 0) {
        return locator.first()
      }
    } catch {
      // 继续尝试
    }

    // 4. 尝试用 label
    try {
      const locator = page.getByLabel(text, { exact: false })
      if (await locator.count() > 0) {
        return locator.first()
      }
    } catch {
      // 未找到
    }

    return null
  }

  /**
   * 查找输入字段
   */
  private async findInputField(fieldName: string, analysis: PageAnalysis): Promise<Locator | null> {
    const page = this.page!
    const lowerName = fieldName.toLowerCase()

    // 1. 先在分析结果中查找
    const matchingField = analysis.interactiveElements.find((e) =>
      (e.tag === 'input' || e.tag === 'textarea') &&
      (e.placeholder?.toLowerCase().includes(lowerName) ||
       e.name?.toLowerCase().includes(lowerName))
    )

    if (matchingField) {
      try {
        return page.locator(matchingField.selector).first()
      } catch {
        // 继续尝试
      }
    }

    // 2. 尝试用 placeholder
    try {
      const locator = page.locator(`input[placeholder*="${fieldName}" i], textarea[placeholder*="${fieldName}" i]`)
      if (await locator.count() > 0) {
        return locator.first()
      }
    } catch {
      // 继续尝试
    }

    // 3. 尝试用 label
    try {
      const locator = page.getByLabel(fieldName, { exact: false })
      if (await locator.count() > 0) {
        return locator.first()
      }
    } catch {
      // 继续尝试
    }

    // 4. 尝试用 role
    try {
      const locator = page.getByRole('textbox', { name: fieldName, exact: false })
      if (await locator.count() > 0) {
        return locator.first()
      }
    } catch {
      // 未找到
    }

    return null
  }

  /**
   * 查找搜索字段
   */
  private async findSearchField(analysis: PageAnalysis): Promise<Locator | null> {
    const page = this.page!

    // 1. 尝试用 type="search"
    try {
      const locator = page.locator('input[type="search"]').first()
      if (await locator.count() > 0) {
        return locator
      }
    } catch {}

    // 2. 尝试用 placeholder 包含 search/query
    try {
      const locator = page.locator('input[placeholder*="search" i], input[placeholder*="query" i]').first()
      if (await locator.count() > 0) {
        return locator
      }
    } catch {}

    // 3. 尝试用 name 包含 search/q
    try {
      const locator = page.locator('input[name*="search" i], input[name="q"], input[name="query"]').first()
      if (await locator.count() > 0) {
        return locator
      }
    } catch {}

    // 4. 尝试用 aria-label
    try {
      const locator = page.locator('[aria-label*="search" i]').first()
      if (await locator.count() > 0) {
        return locator
      }
    } catch {}

    // 5. 返回第一个文本输入框
    try {
      return page.locator('input[type="text"]').first()
    } catch {
      return null
    }
  }

  /**
   * 查找搜索按钮
   */
  private async findSearchButton(analysis: PageAnalysis): Promise<Locator | null> {
    const page = this.page!

    // 尝试找到搜索按钮
    const searchButton = analysis.interactiveElements.find((e) =>
      e.type === 'submit' ||
      e.text?.toLowerCase().includes('search') ||
      e.text?.toLowerCase().includes('搜索')
    )

    if (searchButton) {
      try {
        return page.locator(searchButton.selector).first()
      } catch {
        return null
      }
    }

    return null
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
