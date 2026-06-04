/**
 * Browser Controller - 对齐 browser-use 设计
 *
 * 核心职责：
 * 1. 维护 DOMState（页面状态快照）
 * 2. 执行 BrowserAction
 * 3. 管理操作历史
 */

import { Page, Locator } from 'playwright'
import { BrowserSecurityGuard, defaultSecurityGuard, SecurityError } from '../security/browser-security.js'
import { DOMState, ElementNode, BrowserAction, ActionResult, formatDOMStateForLLM } from '../dom/dom-state.js'
import { domService } from '../dom/dom-service.js'
import { browserManager } from '../../browser-manager.js'
import { log } from '@auto-agent/shared-utils'

export interface BrowserUseConfig {
  headless?: boolean
  securityGuard?: BrowserSecurityGuard
  maxRetries?: number
}

interface SessionState {
  domState: DOMState | null
  actionHistory: Array<{
    action: BrowserAction
    timestamp: number
    success: boolean
  }>
}

export class BrowserController {
  private sessions = new Map<string, SessionState>()
  private security: BrowserSecurityGuard

  constructor(config: BrowserUseConfig = {}) {
    this.security = config.securityGuard ?? defaultSecurityGuard
  }

  private getSession(sessionId: string): SessionState {
    let session = this.sessions.get(sessionId)
    if (!session) {
      session = { domState: null, actionHistory: [] }
      this.sessions.set(sessionId, session)
    }
    return session
  }

  private async getPage(sessionId: string): Promise<Page> {
    return browserManager.getPage(sessionId)
  }

  /**
   * 获取/刷新页面状态
   */
  async getPageState(sessionId: string): Promise<DOMState> {
    const page = await this.getPage(sessionId)
    const session = this.getSession(sessionId)

    // 如果是空白页，等待导航完成
    const url = page.url()
    if (url === 'about:blank' || !url) {
      log.warn('BrowserController', 'Page is blank, waiting for navigation...')
      // 返回一个空状态，让 LLM 知道需要先导航
      const emptyState: DOMState = {
        url: url || 'about:blank',
        title: 'Blank Page',
        timestamp: Date.now(),
        elementTree: [],
        selectorMap: new Map(),
        stats: { totalElements: 0, interactiveElements: 0, visibleElements: 0 }
      }
      return emptyState
    }

    const state = await domService.getDOMState(page)
    session.domState = state

    return state
  }

  /**
   * 执行单个动作
   */
  async executeAction(
    sessionId: string,
    action: BrowserAction
  ): Promise<ActionResult> {
    const page = await this.getPage(sessionId)
    const session = this.getSession(sessionId)

    const startTime = Date.now()
    let result: ActionResult

    // 兼容字段名：server 可能发送 ref 或 index，value 或 text
    const index = action.index ?? action.ref
    const text = action.text ?? action.value

    try {
      switch (action.type) {
        case 'navigate':
          result = await this.executeNavigate(page, action.url)
          break
        case 'click':
          result = await this.executeClick(page, sessionId, index)
          break
        case 'type':
          result = await this.executeType(page, sessionId, index, text, action.clearFirst)
          break
        case 'select':
          result = await this.executeSelect(page, sessionId, index, action.option)
          break
        case 'scroll':
          result = await this.executeScroll(page, action.direction, action.amount)
          break
        case 'wait':
          result = await this.executeWait(page, action.ms)
          break
        case 'screenshot':
          result = await this.executeScreenshot(page, action.fullPage)
          break
        case 'back':
          await page.goBack()
          result = { success: true, message: 'Navigated back' }
          break
        case 'forward':
          await page.goForward()
          result = { success: true, message: 'Navigated forward' }
          break
        case 'hover':
          result = await this.executeHover(page, sessionId, index)
          break
        case 'close':
          await this.close(sessionId)
          result = { success: true, message: 'Session closed' }
          break
        default:
          result = { success: false, message: `Unknown action: ${(action as any).type}` }
      }
    } catch (error) {
      result = {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`
      }
    }

    // 记录历史
    session.actionHistory.push({
      action,
      timestamp: Date.now(),
      success: result.success
    })

    // 动作执行后刷新状态
    if (result.success && action.type !== 'screenshot') {
      try {
        result.newState = await this.getPageState(sessionId)
      } catch {
        // 忽略刷新错误
      }
    }

    log.info('BrowserController', `Action ${action.type} completed in ${Date.now() - startTime}ms: ${result.message}`)

    return result
  }

  /**
   * 批量执行动作
   */
  async executeActions(
    sessionId: string,
    actions: BrowserAction[]
  ): Promise<ActionResult[]> {
    const results: ActionResult[] = []

    for (const action of actions) {
      const result = await this.executeAction(sessionId, action)
      results.push(result)

      if (!result.success) {
        break // 失败时停止
      }
    }

    return results
  }

  // ==================== 具体动作执行 ====================

  private async executeNavigate(page: Page, url: string): Promise<ActionResult> {
    try {
      this.security.assertNavigationAllowed({ url, timestamp: Date.now() })
    } catch (error) {
      if (error instanceof SecurityError) {
        return { success: false, message: `Security: ${error.message}` }
      }
      throw error
    }

    // 最佳实践：等待 load 事件（DOM + 基本资源就绪）
    // 不拦截样式，确保坐标计算正确
    await page.goto(url, { waitUntil: 'load', timeout: 15000 })

    // 可选：额外等待网络空闲，但设置较短超时避免慢资源阻塞
    try {
      await page.waitForLoadState('networkidle', { timeout: 3000 })
    } catch {
      // 网络空闲超时不影响页面可用性
    }

    return { success: true, message: `Navigated to ${page.url()}` }
  }

  private async executeClick(
    page: Page,
    sessionId: string,
    index: number | undefined
  ): Promise<ActionResult> {
    if (index === undefined) {
      return { success: false, message: 'Click action requires index or ref parameter' }
    }

    const session = this.getSession(sessionId)

    // 确保有最新状态
    if (!session.domState) {
      await this.getPageState(sessionId)
    }

    const element = session.domState?.selectorMap.get(index)
    if (!element) {
      return { success: false, message: `Element [${index}] not found` }
    }

    // 使用坐标点击（最可靠）
    await page.mouse.click(element.center.x, element.center.y)

    // 点击后短暂等待，让效果生效
    // 对于会触发导航的点击，由调用方检测 URL 变化决定是否继续等待
    await page.waitForTimeout(200)

    return { success: true, message: `Clicked [${index}] ${element.tagName}` }
  }

  private async executeType(
    page: Page,
    sessionId: string,
    index: number | undefined,
    text: string | undefined,
    clearFirst = true
  ): Promise<ActionResult> {
    if (index === undefined) {
      return { success: false, message: 'Type action requires index or ref parameter' }
    }
    if (text === undefined) {
      return { success: false, message: 'Type action requires text or value parameter' }
    }

    const session = this.getSession(sessionId)

    if (!session.domState) {
      await this.getPageState(sessionId)
    }

    const element = session.domState?.selectorMap.get(index)
    if (!element) {
      return { success: false, message: `Element [${index}] not found` }
    }

    // 点击聚焦
    await page.mouse.click(element.center.x, element.center.y)

    // 清除现有内容
    if (clearFirst) {
      await page.keyboard.press('Control+a')
      await page.keyboard.press('Delete')
    }

    // 输入文本
    await page.keyboard.type(text)

    return { success: true, message: `Typed "${text}" into [${index}]` }
  }

  private async executeSelect(
    page: Page,
    sessionId: string,
    index: number | undefined,
    option: string | undefined
  ): Promise<ActionResult> {
    if (index === undefined) {
      return { success: false, message: 'Select action requires index or ref parameter' }
    }
    if (!option) {
      return { success: false, message: 'Select action requires option parameter' }
    }

    const session = this.getSession(sessionId)

    if (!session.domState) {
      await this.getPageState(sessionId)
    }

    const element = session.domState?.selectorMap.get(index)
    if (!element) {
      return { success: false, message: `Element [${index}] not found` }
    }

    // 点击打开下拉框
    await page.mouse.click(element.center.x, element.center.y)
    await page.waitForTimeout(300)

    // 查找并点击选项
    const optionSelector = `option:has-text("${option}"), [role="option"]:has-text("${option}")`
    try {
      const optionElement = await page.locator(optionSelector).first()
      await optionElement.click()
      return { success: true, message: `Selected "${option}" in [${index}]` }
    } catch {
      // 如果找不到选项，尝试直接输入
      await page.keyboard.type(option)
      await page.keyboard.press('Enter')
      return { success: true, message: `Typed "${option}" in select [${index}]` }
    }
  }

  private async executeHover(
    page: Page,
    sessionId: string,
    index: number | undefined
  ): Promise<ActionResult> {
    if (index === undefined) {
      return { success: false, message: 'Hover action requires index or ref parameter' }
    }

    const session = this.getSession(sessionId)

    if (!session.domState) {
      await this.getPageState(sessionId)
    }

    const element = session.domState?.selectorMap.get(index)
    if (!element) {
      return { success: false, message: `Element [${index}] not found` }
    }

    await page.mouse.move(element.center.x, element.center.y)
    return { success: true, message: `Hovered over [${index}] ${element.tagName}` }
  }

  private async executeScroll(
    page: Page,
    direction: 'up' | 'down' | string,
    amount?: number
  ): Promise<ActionResult> {
    // 兼容不同方向表示
    const isUp = direction === 'up' || direction === 'top'
    const isBottom = direction === 'bottom' || direction === 'end'

    // 如果是滚动到底部，使用 scrollTo
    if (isBottom) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      return { success: true, message: 'Scrolled to bottom' }
    }

    // 普通滚动
    const scrollAmount = amount || 500
    const delta = isUp ? -scrollAmount : scrollAmount
    await page.evaluate((y) => window.scrollBy(0, y), delta)
    return { success: true, message: `Scrolled ${isUp ? 'up' : 'down'} ${scrollAmount}px` }
  }

  private async executeWait(page: Page, ms: number): Promise<ActionResult> {
    await page.waitForTimeout(ms)
    return { success: true, message: `Waited ${ms}ms` }
  }

  private async executeScreenshot(page: Page, fullPage = false): Promise<ActionResult> {
    const screenshot = await page.screenshot({ type: 'png', fullPage })
    const base64 = screenshot.toString('base64')
    return {
      success: true,
      message: `Screenshot captured: ${screenshot.length} bytes`,
      screenshot: base64
    }
  }

  // ==================== 工具方法 ====================

  /**
   * 获取页面上下文（给 LLM）
   */
  async getPageContext(sessionId: string): Promise<{ url: string; title: string; text: string; elements?: any[] }> {
    const state = await this.getPageState(sessionId)

    // 空白页特殊处理
    if (state.url === 'about:blank' || state.stats.totalElements === 0) {
      return {
        url: state.url,
        title: 'Blank Page',
        text: 'Current page is blank (about:blank). Need to navigate to a URL first.',
        elements: []
      }
    }

    const text = formatDOMStateForLLM(state)

    return {
      url: state.url,
      title: state.title,
      text,
      elements: state.elementTree.filter(e => e.isInteractive && e.isVisible).map(e => ({
        ref: e.index,
        tag: e.tagName,
        type: e.type,
        name: e.name,
        placeholder: e.placeholder,
        text: e.name || e.placeholder || e.text,
        role: e.role || e.tagName
      }))
    }
  }

  /**
   * 关闭会话
   */
  async close(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId)
    await browserManager.closeSession(sessionId)
  }

  /**
   * 关闭所有会话
   */
  async closeAll(): Promise<void> {
    this.sessions.clear()
    await browserManager.closeAllSessions()
  }
}

export const browserController = new BrowserController()
