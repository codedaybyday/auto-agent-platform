/**
 * 五级 DOM 序列化流水线
 * 将大型 DOM 树精简为 LLM 优化的格式
 *
 * 五个关键步骤：
 * 1. 节点简化 - 过滤无用元素
 * 2. 绘制顺序过滤 - 基于 z-index 和遮挡关系
 * 3. 树结构优化 - 移除冗余包装器
 * 4. 边界框过滤 - 避免重复信息
 * 5. 交互索引分配 - 生成简化列表
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
}

const DEFAULT_OPTIONS: Required<DOMSerializerOptions> = {
  maxElements: 200,
  includeTextNodes: false,
  maxTextLength: 100,
  minElementSize: 5,
  prioritizeViewport: true
}

/**
 * 五级 DOM 序列化器
 */
export class DOMSerializer {
  private options: Required<DOMSerializerOptions>

  constructor(options: DOMSerializerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * 序列化页面 DOM
   */
  async serialize(page: Page): Promise<SerializedDOM> {
    const startTime = Date.now()

    const result = await page.evaluate((opts) => {
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
       */
      function isVisible(element: Element): boolean {
        const style = window.getComputedStyle(element)

        // 检查 display
        if (style.display === 'none') return false

        // 检查 visibility
        if (style.visibility === 'hidden' || style.visibility === 'collapse') return false

        // 检查 opacity
        if (parseFloat(style.opacity) === 0) return false

        // 检查尺寸
        const rect = element.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return false

        // 检查是否在视口内（或附近）
        const viewportHeight = window.innerHeight
        const viewportWidth = window.innerWidth

        if (rect.bottom < -viewportHeight ||
            rect.top > viewportHeight * 2 ||
            rect.right < -viewportWidth ||
            rect.left > viewportWidth * 2) {
          return false
        }

        return true
      }

      /**
       * 检查元素是否有用
       */
      function isUseful(element: Element): boolean {
        const tag = element.tagName.toLowerCase()

        // 过滤无用标签
        if (USELESS_TAGS.has(tag)) return false

        // 检查可见性
        if (!isVisible(element)) return false

        return true
      }

      /**
       * 检查是否是可交互元素
       */
      function isInteractive(element: Element): boolean {
        const tag = element.tagName.toLowerCase()
        const role = element.getAttribute('role')

        // 检查标签
        if (INTERACTIVE_TAGS.has(tag)) return true

        // 检查 role
        if (role && INTERACTIVE_ROLES.has(role)) return true

        // 检查事件处理器
        if (element.hasAttribute('onclick') ||
            element.hasAttribute('onkeydown') ||
            element.hasAttribute('onkeypress') ||
            element.hasAttribute('onkeyup')) {
          return true
        }

        // 检查 tabindex
        const tabIndex = element.getAttribute('tabindex')
        if (tabIndex && parseInt(tabIndex) >= 0) return true

        // 检查 contenteditable
        if (element.hasAttribute('contenteditable')) return true

        // 检查 aria 交互属性
        if (element.hasAttribute('aria-expanded') ||
            element.hasAttribute('aria-selected') ||
            element.hasAttribute('aria-pressed')) {
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
       */
      function extractCandidates(node: TreeNode, candidates: CandidateElement[]): void {
        const element = node.element
        const rect = element.getBoundingClientRect()

        // 检查尺寸
        if (rect.width < opts.minElementSize || rect.height < opts.minElementSize) {
          // 但如果是可交互元素，仍然保留
          if (!isInteractive(element)) {
            return
          }
        }

        // 计算优先级
        let priority = 0

        // 可交互元素优先级高
        if (isInteractive(element)) {
          priority += 100
        }

        // 视口内元素优先级高
        const viewportHeight = window.innerHeight
        if (rect.top >= 0 && rect.bottom <= viewportHeight) {
          priority += 50
        }

        // 有文本内容的优先级高
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

        // 如果是可交互元素，不深入子节点（边界框过滤）
        if (isInteractive(element)) {
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
       * 分配索引并生成最终列表
       */
      function assignIndices(candidates: CandidateElement[]): FinalElement[] {
        // 按优先级排序
        candidates.sort((a, b) => b.priority - a.priority)

        // 去重：移除边界框高度重叠的元素
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

            // 如果重叠面积超过 80%，认为是重复
            if (overlapArea > candidateArea * 0.8 && overlapArea > existingArea * 0.8) {
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

        // 分配 ID
        return unique
          .slice(0, opts.maxElements)
          .map((c, index) => ({
            id: index,
            ...c.info,
            bbox: c.bbox,
            center: c.center
          }))
      }

      // ============================================
      // 执行流水线
      // ============================================

      const totalNodes = document.querySelectorAll('*').length

      // 步骤 1: 构建树
      const tree = buildTree(document.body)
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
      const optimizedTree = optimizeTree(tree)
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
      const candidates: CandidateElement[] = []
      extractCandidates(optimizedTree, candidates)

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
      const finalElements = assignIndices(filteredCandidates)

      // 生成摘要
      const summary = generateSummary(finalElements)

      // 计算大小
      const jsonString = JSON.stringify(finalElements)
      const sizeKB = Math.round(jsonString.length / 1024 * 100) / 100

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
