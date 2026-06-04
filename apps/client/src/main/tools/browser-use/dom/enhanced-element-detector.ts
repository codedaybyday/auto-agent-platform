/**
 * Enhanced Element Detector - 增强型元素检测器
 *
 * 整合 CDP Accessibility Tree 和 DOMDebugger，实现 browser-use 标准的
 * 智能元素识别算法。
 *
 * 相比简单的 DOM 检查，能够：
 * 1. 通过 AX Tree 准确识别搜索框、按钮等语义化元素
 * 2. 检测 Vue/React/Angular 绑定的事件监听器
 * 3. 识别被包装在 label/span 中的表单控件
 * 4. 更准确的交互性评分
 */

import { Page } from 'playwright'
import { cdpService, EnhancedElementInfo, AXNode } from '../cdp/cdp-service'

export interface DetectedElement {
  // 基本信息
  ref: number
  tag: string
  role?: string
  name?: string
  text?: string
  placeholder?: string
  type?: string
  id?: string
  className?: string

  // AX Tree 信息
  axRole?: string
  axName?: string
  isFocusable?: boolean
  isEditable?: boolean
  isSettable?: boolean

  // 事件监听
  hasClickListener: boolean
  hasInputListener: boolean
  hasKeyListener: boolean

  // 边界框
  bbox?: {
    x: number
    y: number
    width: number
    height: number
  }

  // 语义标记
  isInteractive: boolean
  isSearchField: boolean
  isButton: boolean
  isTextInput: boolean
  isLink: boolean

  // 评分
  confidence: number // 0-1，交互性置信度
}

// 搜索指示器关键词（browser-use 标准）
const SEARCH_INDICATORS = [
  'search', 'magnify', 'glass', 'lookup', 'find', 'query',
  'search-icon', 'search-btn', 'search-button', 'searchbox',
  'search-input', 's_ipt' // 百度特有
]

// 交互式 ARIA 角色
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'menuitem', 'option', 'radio',
  'checkbox', 'tab', 'textbox', 'combobox', 'slider',
  'spinbutton', 'search', 'searchbox', 'listbox',
  'row', 'cell', 'gridcell'
])

// 基础交互标签
const INTERACTIVE_TAGS = new Set([
  'a', 'button', 'input', 'textarea', 'select',
  'option', 'details', 'summary'
])

export class EnhancedElementDetector {
  /**
   * 检测页面上的所有交互元素
   * 这是主入口函数
   */
  async detectInteractiveElements(page: Page): Promise<DetectedElement[]> {
    const startTime = Date.now()

    // 1. 首先获取 DOM 中的候选元素
    const candidates = await this.getDomCandidates(page)
    log.info('EnhancedElementDetector', `Found ${candidates.length} DOM candidates`)

    if (candidates.length === 0) {
      return []
    }

    // 2. 提取 backendNodeIds
    const backendNodeIds = candidates.map(c => c.backendNodeId).filter(Boolean) as number[]

    // 3. 批量获取 CDP 增强信息
    let enhancedInfoMap: Map<number, EnhancedElementInfo>
    try {
      enhancedInfoMap = await cdpService.getEnhancedElements(page, backendNodeIds)
    } catch (error) {
      log.warn('EnhancedElementDetector', 'CDP enhancement failed, falling back to DOM only', error)
      enhancedInfoMap = new Map()
    }

    // 4. 合并信息并检测
    const detectedElements: DetectedElement[] = []
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i]
      const enhancedInfo = candidate.backendNodeId
        ? enhancedInfoMap.get(candidate.backendNodeId)
        : undefined

      const detected = this.analyzeElement(candidate, enhancedInfo, i)
      if (detected.isInteractive) {
        detectedElements.push(detected)
      }
    }

    // 5. 按置信度排序
    detectedElements.sort((a, b) => b.confidence - a.confidence)

    log.info('EnhancedElementDetector', `Detected ${detectedElements.length} interactive elements in ${Date.now() - startTime}ms`)

    return detectedElements
  }

  /**
   * 从 DOM 获取候选元素
   */
  private async getDomCandidates(page: Page): Promise<Array<{
    element: Element
    backendNodeId: number | null
    tag: string
    text: string
    attributes: Record<string, string>
  }>> {
    return await page.evaluate(() => {
      const candidates: Array<{
        element: Element
        backendNodeId: number | null
        tag: string
        text: string
        attributes: Record<string, string>
      }> = []

      // 获取所有元素
      const allElements = document.querySelectorAll('*')

      for (const element of allElements) {
        // 跳过无用标签
        const uselessTags = new Set(['script', 'style', 'head', 'meta', 'link', 'noscript', 'template'])
        const tag = element.tagName.toLowerCase()
        if (uselessTags.has(tag)) continue

        // 检查可见性
        const style = window.getComputedStyle(element)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        if (parseFloat(style.opacity) === 0) continue

        // 获取 backendNodeId（通过 Chrome 内部属性）
        const backendNodeId = (element as any).backendNodeId || null

        // 获取文本内容
        const text = element.textContent?.trim().substring(0, 100) || ''

        // 获取属性
        const attributes: Record<string, string> = {}
        for (const attr of element.attributes) {
          attributes[attr.name] = attr.value
        }

        candidates.push({
          element,
          backendNodeId,
          tag,
          text,
          attributes
        })
      }

      return candidates
    })
  }

  /**
   * 分析单个元素，判断是否交互
   */
  private analyzeElement(
    candidate: {
      tag: string
      text: string
      attributes: Record<string, string>
    },
    enhancedInfo?: EnhancedElementInfo,
    ref: number = 0
  ): DetectedElement {
    const { tag, text, attributes } = candidate
    const id = attributes.id || ''
    const className = attributes.class || ''
    const classList = className.toLowerCase().split(/\s+/)

    // AX Tree 信息
    const axRole = enhancedInfo?.axRole
    const axName = enhancedInfo?.axName

    // 事件监听信息
    const hasClickListener = enhancedInfo?.hasClickListener || false
    const hasInputListener = enhancedInfo?.hasInputListener || false
    const hasKeyListener = enhancedInfo?.hasKeyListener || false

    // 盒模型
    const bbox = enhancedInfo?.boundingBox

    // ====================
    // 1. 基础交互性检查
    // ====================
    let isInteractive = false
    let confidence = 0

    // 1.1 AX Tree 角色检查（最可靠）
    if (axRole && INTERACTIVE_ROLES.has(axRole.toLowerCase())) {
      isInteractive = true
      confidence = 0.95
    }

    // 1.2 基础标签检查
    if (!isInteractive && INTERACTIVE_TAGS.has(tag)) {
      isInteractive = true
      confidence = Math.max(confidence, 0.9)
    }

    // 1.3 事件监听器检查（检测框架绑定）
    if (!isInteractive && (hasClickListener || hasInputListener || hasKeyListener)) {
      isInteractive = true
      confidence = Math.max(confidence, 0.85)
    }

    // 1.4 标准属性检查
    if (!isInteractive) {
      // ARIA 角色
      const role = attributes.role
      if (role && INTERACTIVE_ROLES.has(role.toLowerCase())) {
        isInteractive = true
        confidence = Math.max(confidence, 0.8)
      }

      // 事件处理器属性
      if (attributes.onclick || attributes.onmousedown || attributes.onkeydown) {
        isInteractive = true
        confidence = Math.max(confidence, 0.75)
      }

      // Tabindex
      const tabIndex = attributes.tabindex
      if (tabIndex !== undefined && parseInt(tabIndex) >= 0) {
        isInteractive = true
        confidence = Math.max(confidence, 0.7)
      }

      // Content editable
      if (attributes.contenteditable === 'true') {
        isInteractive = true
        confidence = Math.max(confidence, 0.8)
      }
    }

    // ====================
    // 2. 语义类型识别
    // ====================

    // 2.1 搜索框识别（专门优化）
    let isSearchField = false
    if (tag === 'input' || tag === 'textarea') {
      // AX Tree 标记
      if (axRole === 'searchbox') {
        isSearchField = true
      }
      // 百度等特有 ID
      else if (id === 'kw' || id === 'word') {
        isSearchField = true
      }
      // 关键词匹配
      else if (SEARCH_INDICATORS.some(ind =>
        id.toLowerCase().includes(ind) ||
        classList.some(c => c.includes(ind))
      )) {
        isSearchField = true
      }
      // 输入事件 + 中央位置
      else if (hasInputListener && bbox) {
        const isInSearchArea = bbox.y < 300 && // 顶部
                               bbox.x > 200 &&  // 不贴边
                               bbox.x + bbox.width < window.innerWidth - 200
        if (isInSearchArea) {
          isSearchField = true
        }
      }
    }

    // 2.2 按钮识别
    const isButton = tag === 'button' ||
                     axRole === 'button' ||
                     (attributes.type === 'button' || attributes.type === 'submit') ||
                     classList.some(c => c.includes('btn') || c.includes('button'))

    // 2.3 文本输入识别
    const isTextInput = tag === 'input' || tag === 'textarea' ||
                        axRole === 'textbox' ||
                        axRole === 'searchbox' ||
                        isSearchField

    // 2.4 链接识别
    const isLink = tag === 'a' || axRole === 'link'

    // 如果识别为搜索框，提升置信度
    if (isSearchField) {
      confidence = Math.max(confidence, 0.95)
    }

    // 计算最终 role
    let role = axRole || attributes.role
    if (!role) {
      if (isSearchField) role = 'searchbox'
      else if (isButton) role = 'button'
      else if (isTextInput) role = 'textbox'
      else if (isLink) role = 'link'
    }

    return {
      ref,
      tag,
      role,
      name: axName,
      text,
      placeholder: attributes.placeholder,
      type: attributes.type,
      id,
      className,
      axRole,
      axName,
      isFocusable: enhancedInfo?.isFocusable,
      isEditable: enhancedInfo?.isEditable,
      isSettable: enhancedInfo?.isSettable,
      hasClickListener,
      hasInputListener,
      hasKeyListener,
      bbox,
      isInteractive,
      isSearchField,
      isButton,
      isTextInput,
      isLink,
      confidence
    }
  }

  /**
   * 查找最可能的搜索框
   * 返回置信度最高的搜索框
   */
  async findSearchField(page: Page): Promise<DetectedElement | undefined> {
    const elements = await this.detectInteractiveElements(page)
    const searchFields = elements.filter(e => e.isSearchField)

    if (searchFields.length === 0) {
      // 如果没有明确标记的搜索框，返回文本输入框中位置最好的
      const textInputs = elements.filter(e => e.isTextInput && e.bbox)
      // 优先选择在页面中央的
      return textInputs.sort((a, b) => {
        const aCenter = a.bbox ? Math.abs(a.bbox.x + a.bbox.width/2 - window.innerWidth/2) : Infinity
        const bCenter = b.bbox ? Math.abs(b.bbox.x + b.bbox.width/2 - window.innerWidth/2) : Infinity
        return aCenter - bCenter
      })[0]
    }

    // 返回置信度最高的搜索框
    return searchFields.sort((a, b) => b.confidence - a.confidence)[0]
  }
}

// 导出单例
export const enhancedDetector = new EnhancedElementDetector()

// 导入 log
import { log } from '@auto-agent/shared-utils'
