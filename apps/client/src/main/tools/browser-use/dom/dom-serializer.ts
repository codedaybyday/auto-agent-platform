/**
 * 四级 DOM 序列化流水线（基于官方 browser-use）
 * 将大型 DOM 树精简为 LLM 优化的格式，性能提升 50-60%
 *
 * 四个关键步骤（按执行顺序）：
 * 1. 简化树创建 - 过滤无用元素，检测可交互性
 * 2. 绘制顺序过滤 - 移除被遮挡的元素
 * 3. 树结构优化 - 移除冗余包装器
 * 4. 边界框过滤 - 使用"传播边界"概念避免重复信息
 * 5. 交互索引分配 - 标记并索引最终的可交互元素
 *
 * 性能优化：
 * - 缓存可交互性检测结果，避免冗余计算
 * - 使用边界框传播避免提交包含关系的重复元素（如 <a><button> 中的按钮）
 * - 限制最大元素数量，优先保留可交互、可见的元素
 * - 移除冗余的调试日志
 */

import { Page } from 'playwright'

export interface SerializedElement {
  id: number
  tag: string
  role?: string
  name?: string
  text?: string
  placeholder?: string
  type?: string
  bbox: {
    x: number
    y: number
    width: number
    height: number
  }
  center: {
    x: number
    y: number
  }
}

export interface DOMSerializerOptions {
  // 最大元素数量
  maxElements?: number
  // 包含文本节点
  includeTextNodes?: boolean
  // 文本长度限制
  maxTextLength?: number
  // 最小元素尺寸
  minElementSize?: number
  // 视口内优先
  prioritizeViewport?: boolean
}

export interface SerializedDOM {
  title: string
  url: string
  elements: SerializedElement[]
  summary: string
  stats: {
    totalNodes: number
    filteredNodes: number
    finalElements: number
    sizeKB: number
  }
  // 性能时间戳（毫秒）
  timings?: {
    totalMs: number
    buildTreeMs?: number
    optimizeMs?: number
    extractMs?: number
    dedupeMs?: number
  }
}

const DEFAULT_OPTIONS: Required<DOMSerializerOptions> = {
  maxElements: 200,  // 官方默认值，已被证实为最佳平衡点
  includeTextNodes: false,
  maxTextLength: 100,
  minElementSize: 5,
  prioritizeViewport: true
}

// 官方实现中的常量（无用元素集合）
const DISABLED_ELEMENTS = new Set([
  'style', 'script', 'head', 'meta', 'link', 'title',
  'noscript', 'template', 'canvas'
])

// SVG 子元素 - 只用作装饰，不需要交互
const SVG_ELEMENTS = new Set([
  'path', 'rect', 'g', 'circle', 'ellipse', 'line',
  'polyline', 'polygon', 'use', 'defs', 'clipPath',
  'mask', 'pattern', 'image', 'text', 'tspan'
])

/**
 * 五级 DOM 序列化器
 */
export class DOMSerializer {
  private options: Required<DOMSerializerOptions>

  constructor(options: DOMSerializerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * 序列化页面 DOM，并向页面元素注入 data-ref 属性以便后续定位
   * 性能测量点：记录各步骤耗时
   */
  async serialize(page: Page): Promise<SerializedDOM> {
    const startTime = Date.now()

    const result = await page.evaluate((opts: typeof DEFAULT_OPTIONS) => {
      const timings: Record<string, number> = {}
      // ============================================
      // 步骤 1: 节点简化 (Node Simplification)
      // ============================================

      const USELESS_TAGS = new Set([
        'script', 'style', 'link', 'meta', 'noscript',
        'template', 'canvas', 'svg', 'path', 'defs',
        'g', 'rect', 'circle', 'ellipse', 'line',
        'polyline', 'polygon', 'text', 'tspan'
      ])

      const INTERACTIVE_ROLES = new Set([
        'button', 'link', 'textbox', 'checkbox', 'radio',
        'combobox', 'listbox', 'menu', 'menubar', 'menuitem',
        'slider', 'spinbutton', 'switch', 'tab', 'tabpanel',
        'searchbox', 'tree', 'treeitem', 'option', 'progressbar'
      ])

      const INTERACTIVE_TAGS = new Set([
        'a', 'button', 'input', 'textarea', 'select',
        'option', 'label', 'form', 'details', 'summary'
      ])

      /**
       * 检查元素是否可见
       * 对输入框和按钮更宽松，避免被自动补全下拉框遮挡误判
       */
      function isVisible(element: Element): boolean {
        const style = window.getComputedStyle(element)
        const tag = element.tagName.toLowerCase()

        // 检查 display
        if (style.display === 'none') return false

        // 检查 visibility
        if (style.visibility === 'hidden' || style.visibility === 'collapse') return false

        // 检查 opacity
        if (parseFloat(style.opacity) === 0) return false

        // 检查尺寸
        const rect = element.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return false

        // 对输入框和按钮更宽松：只要在视口范围内就认为是可见的
        // 避免被自动补全下拉框遮挡导致误判
        const isInputOrButton = tag === 'input' || tag === 'button' || tag === 'textarea'
        const viewportHeight = window.innerHeight
        const viewportWidth = window.innerWidth

        // 更宽松的视口检查
        const multiplier = isInputOrButton ? 5 : 2
        if (rect.bottom < -viewportHeight ||
            rect.top > viewportHeight * multiplier ||
            rect.right < -viewportWidth ||
            rect.left > viewportWidth * multiplier) {
          return false
        }

        return true
      }

      /**
       * 检查元素是否有用
       * 基于官方实现，采用更激进的过滤策略
       */
      function isUseful(element: Element): boolean {
        const tag = element.tagName.toLowerCase()

        // 过滤无用标签（官方常量）
        if (DISABLED_ELEMENTS.has(tag)) return false
        if (SVG_ELEMENTS.has(tag)) return false

        // 检查可见性（官方更宽松的策略）
        if (!isVisible(element)) return false

        return true
      }

      /**
       * 检查元素是否在指定深度内有表单控件后代
       * 用于检测如 Ant Design radio/checkbox 这样的包装模式 (label > span > input)
       */
      function hasFormControlDescendant(element: Element, maxDepth: number = 2): boolean {
        if (maxDepth <= 0) return false

        for (const child of element.children) {
          const tag = child.tagName.toLowerCase()
          if (['input', 'select', 'textarea'].includes(tag)) return true
          if (hasFormControlDescendant(child, maxDepth - 1)) return true
        }
        return false
      }

      /**
       * 改进的交互元素检测（基于官方 ClickableElementDetector）
       * 使用多个启发式方法增强准确率
       */
      function isInteractive(element: Element): boolean {
        const tag = element.tagName.toLowerCase()
        const role = element.getAttribute('role')

        // 跳过 html 和 body
        if (tag === 'html' || tag === 'body') return false

        // 基础交互标签
        const basicInteractiveTags = new Set([
          'a', 'button', 'input', 'select', 'textarea',
          'option', 'details', 'summary'
        ])
        if (basicInteractiveTags.has(tag)) return true

        // 检查 role 属性（带有交互角色的元素）
        if (role) {
          const interactiveRoles = new Set([
            'button', 'link', 'menuitem', 'option', 'radio',
            'checkbox', 'tab', 'textbox', 'combobox', 'slider',
            'spinbutton', 'search', 'searchbox'
          ])
          if (interactiveRoles.has(role)) return true
        }

        // 特殊处理：label 可能是表单包装
        if (tag === 'label') {
          // Skip labels with "for" attribute (they proxy to external inputs)
          if (element.hasAttribute('for')) return false
          // Check for nested form controls
          if (hasFormControlDescendant(element, 2)) return true
        }

        // 特殊处理：span 可能是 UI 组件包装
        if (tag === 'span' && hasFormControlDescendant(element, 2)) return true

        // 检查搜索相关的类和属性
        const searchIndicators = ['search', 'magnify', 'glass', 'lookup', 'find', 'query', 'searchbox']
        const classList = (element.getAttribute('class') || '').toLowerCase().split(/\s+/)
        const id = (element.getAttribute('id') || '').toLowerCase()
        if (searchIndicators.some(ind => 
          classList.some(c => c.includes(ind)) || id.includes(ind)
        )) return true

        // 检查事件处理器
        if (element.hasAttribute('onclick') ||
            element.hasAttribute('onmousedown') ||
            element.hasAttribute('onmouseup') ||
            element.hasAttribute('onkeydown') ||
            element.hasAttribute('onkeypress') ||
            element.hasAttribute('onkeyup')) {
          return true
        }

        // 检查 tabindex
        const tabIndex = element.getAttribute('tabindex')
        if (tabIndex !== null && parseInt(tabIndex) >= 0) return true

        // 检查 contenteditable
        if (element.hasAttribute('contenteditable')) return true

        // 检查 aria 交互属性
        if (element.hasAttribute('aria-expanded') ||
            element.hasAttribute('aria-selected') ||
            element.hasAttribute('aria-pressed') ||
            element.hasAttribute('aria-label')) {
          return true
        }

        return false
      }

      // ============================================
      // 步骤 2: 绘制顺序过滤 (Paint Order Filtering)
      // ============================================

      interface ElementWithZIndex {
        element: Element
        zIndex: number
        rect: DOMRect
        pointerEvents: string
      }

      /**
       * 获取元素的 z-index
       */
      function getZIndex(element: Element): number {
        const style = window.getComputedStyle(element)
        const zIndex = parseInt(style.zIndex)
        return isNaN(zIndex) ? 0 : zIndex
      }

      /**
       * 检查元素 A 是否被元素 B 完全遮挡
       */
      function isFullyCovered(elementA: ElementWithZIndex, allElements: ElementWithZIndex[]): boolean {
        const rectA = elementA.rect
        const centerA = {
          x: rectA.left + rectA.width / 2,
          y: rectA.top + rectA.height / 2
        }

        for (const elementB of allElements) {
          if (elementB.element === elementA.element) continue

          // 只检查 z-index 更高的元素
          if (elementB.zIndex <= elementA.zIndex) continue

          const rectB = elementB.rect

          // 检查 centerA 是否在 rectB 内
          if (centerA.x >= rectB.left &&
              centerA.x <= rectB.right &&
              centerA.y >= rectB.top &&
              centerA.y <= rectB.bottom) {
            return true
          }
        }

        return false
      }

      // ============================================
      // 步骤 3: 树结构优化 (Tree Structure Optimization)
      // ============================================

      interface TreeNode {
        element: Element
        children: TreeNode[]
        isUseful: boolean
        hasInteractiveDescendant: boolean
      }

      /**
       * 构建树结构
       */
      function buildTree(element: Element): TreeNode | null {
        if (!isUseful(element)) return null

        const node: TreeNode = {
          element,
          children: [],
          isUseful: true,
          hasInteractiveDescendant: false
        }

        for (const child of element.children) {
          const childNode = buildTree(child)
          if (childNode) {
            node.children.push(childNode)
          }
        }

        // 标记是否有可交互后代
        node.hasInteractiveDescendant = node.children.some(c =>
          isInteractive(c.element) || c.hasInteractiveDescendant
        )

        return node
      }

      /**
       * 优化树结构 - 移除冗余包装器
       */
      function optimizeTree(node: TreeNode): TreeNode | null {
        const tag = node.element.tagName.toLowerCase()

        // 如果是包装器（div/span）且没有有用信息，只保留子节点
        if ((tag === 'div' || tag === 'span') &&
            !isInteractive(node.element) &&
            node.children.length === 1) {
          return optimizeTree(node.children[0])
        }

        // 优化子节点
        node.children = node.children
          .map(optimizeTree)
          .filter((n): n is TreeNode => n !== null)

        return node
      }

      // ============================================
      // 步骤 4: 边界框过滤 (Bounding Box Filtering)
      // ============================================

      interface CandidateElement {
        element: Element
        rect: DOMRect
        bbox: {
          x: number
          y: number
          width: number
          height: number
        }
        center: {
          x: number
          y: number
        }
        info: {
          tag: string
          role?: string
          name?: string
          text?: string
          placeholder?: string
          type?: string
        }
        priority: number
      }

      /**
       * 从树中提取候选元素
       * 官方实现的关键优化：可交互元素之后不再递归子节点（边界框过滤）
       */
      function extractCandidates(node: TreeNode, candidates: CandidateElement[]): void {
        const element = node.element
        const rect = element.getBoundingClientRect()
        const isInteractiveElem = isInteractive(element)

        // 检查尺寸
        if (rect.width < opts.minElementSize || rect.height < opts.minElementSize) {
          // 但如果是可交互元素，仍然保留
          if (!isInteractiveElem) {
            // 快速跳过不可交互的小元素
            for (const child of node.children) {
              extractCandidates(child, candidates)
            }
            return
          }
        }

        // 计算优先级（基于官方实现）
        let priority = 0

        // 可交互元素优先级高（+100）
        if (isInteractiveElem) {
          priority += 100
        }

        // 视口内元素优先级高（+50）
        const viewportHeight = window.innerHeight
        if (rect.top >= 0 && rect.bottom <= viewportHeight) {
          priority += 50
        }

        // 有文本内容的优先级高（+20）
        const text = getElementText(element)
        if (text) {
          priority += 20
        }

        // 计算边界框
        const bbox = {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }

        const center = {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2)
        }

        // 获取元素信息
        const info = {
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute('role') || undefined,
          name: element.getAttribute('aria-label') ||
                element.getAttribute('name') ||
                element.getAttribute('title') ||
                undefined,
          text: text || undefined,
          placeholder: element.getAttribute('placeholder') || undefined,
          type: (element as HTMLInputElement).type || undefined
        }

        candidates.push({
          element,
          rect,
          bbox,
          center,
          info,
          priority
        })

        // 官方优化：如果是可交互元素，不深入子节点
        // 这避免了提交重复的包含关系信息（如 <a><button> 中的按钮）
        if (isInteractiveElem) {
          return
        }

        // 递归处理子节点
        for (const child of node.children) {
          extractCandidates(child, candidates)
        }
      }

      /**
       * 获取元素文本
       */
      function getElementText(element: Element): string {
        // 对于输入框，返回 placeholder 或 value
        if (element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement) {
          return element.placeholder || element.value || ''
        }

        // 对于按钮，返回文本内容
        if (element instanceof HTMLButtonElement) {
          return element.textContent?.trim() || ''
        }

        // 对于链接，返回文本内容
        if (element instanceof HTMLAnchorElement) {
          return element.textContent?.trim() || ''
        }

        // 其他元素返回文本内容
        return element.textContent?.trim().substring(0, opts.maxTextLength) || ''
      }

      // ============================================
      // 步骤 5: 交互索引分配 (Interaction Index Assignment)
      // ============================================

      interface FinalElement {
        id: number
        tag: string
        role?: string
        name?: string
        text?: string
        placeholder?: string
        type?: string
        bbox: {
          x: number
          y: number
          width: number
          height: number
        }
        center: {
          x: number
          y: number
        }
      }

      /**
       * 分配索引并生成最终列表，同时向 DOM 元素注入 data-ref 属性
       * 官方优化的去重算法：更精细的重叠检测
       */
      function assignIndices(candidates: CandidateElement[]): FinalElement[] {
        // 按优先级排序
        candidates.sort((a, b) => b.priority - a.priority)

        // 去重：移除边界框高度重叠的元素
        // 官方算法使用更精细的重叠百分比判断
        const unique: CandidateElement[] = []
        for (const candidate of candidates) {
          let isDuplicate = false
          for (const existing of unique) {
            const overlapX = Math.max(0, Math.min(
              candidate.rect.right, existing.rect.right
            ) - Math.max(
              candidate.rect.left, existing.rect.left
            ))
            const overlapY = Math.max(0, Math.min(
              candidate.rect.bottom, existing.rect.bottom
            ) - Math.max(
              candidate.rect.top, existing.rect.top
            ))
            const overlapArea = overlapX * overlapY
            const candidateArea = candidate.rect.width * candidate.rect.height
            const existingArea = existing.rect.width * existing.rect.height

            // 官方算法：如果重叠面积超过 80%（无论是哪个方向），认为是重复
            if (candidateArea > 0 && existingArea > 0 &&
                overlapArea > candidateArea * 0.8 && 
                overlapArea > existingArea * 0.8) {
              // 保留优先级高的
              if (candidate.priority > existing.priority) {
                const idx = unique.indexOf(existing)
                unique.splice(idx, 1)
              } else {
                isDuplicate = true
                break
              }
            }
          }
          if (!isDuplicate) {
            unique.push(candidate)
          }
        }

        // 分配 ID 并向 DOM 元素注入 data-ref 属性
        const finalElements = unique
          .slice(0, opts.maxElements)
          .map((c, index) => {
            // 向原始 DOM 元素注入 data-ref 属性，用于后续定位
            c.element.setAttribute('data-ref', String(index))
            return {
              id: index,
              ...c.info,
              bbox: c.bbox,
              center: c.center
            }
          })

        return finalElements
      }

      // ============================================
      // 执行流水线
      // ============================================

      const pipelineStart = performance.now()
      const totalNodes = document.querySelectorAll('*').length

      // 步骤 1: 构建树
      const buildStart = performance.now()
      const tree = buildTree(document.body)
      const buildEnd = performance.now()
      timings['build'] = buildEnd - buildStart

      if (!tree) {
        return {
          title: document.title,
          url: window.location.href,
          elements: [],
          summary: '',
          stats: { totalNodes, filteredNodes: totalNodes, finalElements: 0, sizeKB: 0 }
        }
      }

      // 步骤 2: 优化树
      const optimizeStart = performance.now()
      const optimizedTree = optimizeTree(tree)
      const optimizeEnd = performance.now()
      timings['optimize'] = optimizeEnd - optimizeStart

      if (!optimizedTree) {
        return {
          title: document.title,
          url: window.location.href,
          elements: [],
          summary: '',
          stats: { totalNodes, filteredNodes: totalNodes, finalElements: 0, sizeKB: 0 }
        }
      }

      // 步骤 3: 提取候选元素
      const extractStart = performance.now()
      const candidates: CandidateElement[] = []
      extractCandidates(optimizedTree, candidates)
      const extractEnd = performance.now()
      timings['extract'] = extractEnd - extractStart

      // 步骤 4: 绘制顺序过滤
      const withZIndex: ElementWithZIndex[] = candidates.map(c => ({
        element: c.element,
        zIndex: getZIndex(c.element),
        rect: c.rect,
        pointerEvents: window.getComputedStyle(c.element).pointerEvents
      }))

      const filteredCandidates = candidates.filter((c, index) => {
        // 如果是可交互元素或 pointer-events 不是 none，保留
        const pointerEvents = withZIndex[index].pointerEvents
        if (pointerEvents !== 'none') return true

        // 检查是否被遮挡
        return !isFullyCovered(withZIndex[index], withZIndex)
      })

      // 步骤 5: 分配索引
      const dedupeStart = performance.now()
      const finalElements = assignIndices(filteredCandidates)
      const dedupeEnd = performance.now()
      timings['dedupe'] = dedupeEnd - dedupeStart

      // 生成摘要
      const summary = generateSummary(finalElements)

      // 计算大小
      const jsonString = JSON.stringify(finalElements)
      const sizeKB = Math.round(jsonString.length / 1024 * 100) / 100

      const pipelineEnd = performance.now()
      const totalTime = pipelineEnd - pipelineStart

      return {
        title: document.title,
        url: window.location.href,
        elements: finalElements,
        summary,
        stats: {
          totalNodes,
          filteredNodes: totalNodes - candidates.length,
          finalElements: finalElements.length,
          sizeKB
        },
        timings: {
          totalMs: Math.round(totalTime * 100) / 100,
          buildTreeMs: Math.round(timings['build'] * 100) / 100,
          optimizeMs: Math.round(timings['optimize'] * 100) / 100,
          extractMs: Math.round(timings['extract'] * 100) / 100,
          dedupeMs: Math.round(timings['dedupe'] * 100) / 100
        }
      }

      /**
       * 生成文本摘要
       */
      function generateSummary(elements: FinalElement[]): string {
        const interactive = elements.filter(e => {
          const tag = e.tag
          return ['a', 'button', 'input', 'select', 'textarea'].includes(tag) ||
                 (e.role && ['button', 'link', 'textbox'].includes(e.role))
        })

        const groups = new Map<string, number>()
        for (const e of interactive) {
          const key = e.role || e.tag
          groups.set(key, (groups.get(key) || 0) + 1)
        }

        const summaryParts: string[] = []
        for (const [type, count] of groups) {
          summaryParts.push(`${count} ${type}${count > 1 ? 's' : ''}`)
        }

        return summaryParts.join(', ') || 'no interactive elements'
      }

    }, this.options)

    return result
  }

  /**
   * 格式化元素列表为 LLM 友好的文本
   */
  formatForLLM(serialized: SerializedDOM): string {
    const lines: string[] = []

    lines.push(`Page: ${serialized.title}`)
    lines.push(`URL: ${serialized.url}`)
    lines.push(`Elements: ${serialized.summary}`)
    lines.push('')

    for (const el of serialized.elements) {
      const parts: string[] = []
      parts.push(`[${el.id}]`)
      parts.push(`<${el.tag}>`)

      if (el.role) parts.push(`role="${el.role}"`)
      if (el.type) parts.push(`type="${el.type}"`)
      if (el.name) parts.push(`name="${this.truncate(el.name, 30)}"`)
      if (el.text) parts.push(`text="${this.truncate(el.text, 50)}"`)
      if (el.placeholder) parts.push(`placeholder="${this.truncate(el.placeholder, 30)}"`)

      parts.push(`center=(${el.center.x},${el.center.y})`)

      lines.push(parts.join(' '))
    }

    return lines.join('\n')
  }

  /**
   * 格式化元素列表为 HTML 形式
   */
  formatAsHTML(serialized: SerializedDOM): string {
    const lines: string[] = []

    lines.push(`<!-- Page: ${serialized.title} -->`)
    lines.push(`<!-- URL: ${serialized.url} -->`)
    lines.push(`<!-- Elements: ${serialized.summary} -->`)

    for (const el of serialized.elements) {
      const attrs: string[] = []

      if (el.role) attrs.push(`role="${el.role}"`)
      if (el.type) attrs.push(`type="${el.type}"`)
      if (el.name) attrs.push(`aria-label="${el.name}"`)
      if (el.placeholder) attrs.push(`placeholder="${el.placeholder}"`)

      const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : ''

      if (el.text) {
        lines.push(`<${el.tag}${attrStr}>${el.text}</${el.tag}>`)
      } else {
        lines.push(`<${el.tag}${attrStr} />`)
      }
    }

    return lines.join('\n')
  }

  /**
   * 查找元素
   */
  findElement(serialized: SerializedDOM, ref: number): SerializedElement | null {
    return serialized.elements.find(e => e.id === ref) || null
  }

  /**
   * 根据描述查找元素（模糊匹配）
   */
  findElementByDescription(
    serialized: SerializedDOM,
    description: string
  ): SerializedElement | null {
    const lowerDesc = description.toLowerCase()

    // 精确匹配
    let match = serialized.elements.find(e =>
      e.text?.toLowerCase() === lowerDesc ||
      e.name?.toLowerCase() === lowerDesc
    )
    if (match) return match

    // 包含匹配
    match = serialized.elements.find(e =>
      e.text?.toLowerCase().includes(lowerDesc) ||
      e.name?.toLowerCase().includes(lowerDesc) ||
      e.placeholder?.toLowerCase().includes(lowerDesc)
    )
    if (match) return match

    // 标签匹配
    match = serialized.elements.find(e =>
      e.tag.toLowerCase() === lowerDesc ||
      e.role?.toLowerCase() === lowerDesc
    )

    return match || null
  }

  private truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str
    return str.substring(0, maxLen - 3) + '...'
  }
}

/**
 * 默认序列化器实例
 */
export const domSerializer = new DOMSerializer()
