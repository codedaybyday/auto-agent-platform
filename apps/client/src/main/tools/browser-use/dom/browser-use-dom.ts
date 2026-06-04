/**
 * Browser-use 风格的 DOM 获取器
 * 使用 Playwright 的 CDP 会话获取完整的 DOM 信息
 */

import { Page } from 'playwright'
import { log } from '@auto-agent/shared-utils'

export interface BrowserUseElement {
  index: number
  nodeId: number
  backendNodeId: number
  tag: string
  id?: string
  role?: string
  name?: string
  type?: string
  placeholder?: string
  value?: string
  ariaLabel?: string
  isClickable: boolean
  isVisible: boolean
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
  // Hash for stable identification
  hash: string
  stableHash: string

  // 通用元素语义分类（新增）
  elementType: 'text_input' | 'search' | 'button' | 'link' | 'select' | 'checkbox' | 'radio' | 'other'
  confidence: number // 0-1，元素识别的置信度
  isMainAction?: boolean // 是否为主要操作按钮（如提交、搜索按钮）
}

export class BrowserUseDOMService {
  /**
   * 获取页面可交互元素（browser-use 风格）
   * 结合 CDP DOM Snapshot + Accessibility Tree
   */
  async getInteractiveElements(page: Page): Promise<BrowserUseElement[]> {
    const cdpSession = await page.context().newCDPSession(page)

    try {
      log.debug('BrowserUseDOM', 'Getting DOM snapshot...', undefined)

      // 1. 获取 DOM Snapshot
      const snapshot = await cdpSession.send('DOMSnapshot.captureSnapshot', {
        computedStyles: ['display', 'visibility', 'opacity', 'cursor'],
        includePaintOrder: true,
        includeDOMRects: true,
      })

      log.debug('BrowserUseDOM', `Got snapshot with ${snapshot.documents?.length || 0} documents`, undefined)

      // 2. 获取 Accessibility Tree
      const axTree = await cdpSession.send('Accessibility.getFullAXTree')

      log.debug('BrowserUseDOM', `Got AX tree with ${axTree.nodes?.length || 0} nodes`, undefined)

      // 3. 提取可交互元素
      const elements = await this.extractInteractiveElements(snapshot, axTree, cdpSession)

      log.debug('BrowserUseDOM', `Extracted ${elements.length} interactive elements`, undefined)

      // 4. 计算 hash
      const elementsWithHash = elements.map((el, idx) => ({
        ...el,
        index: idx,
        hash: this.computeHash(el),
        stableHash: this.computeStableHash(el),
      }))

      return elementsWithHash
    } catch (error) {
      log.error('BrowserUseDOM', 'Error getting interactive elements', error)
      throw error
    } finally {
      await cdpSession.detach()
    }
  }

  /**
   * 从 DOM Snapshot 提取可交互元素
   */
  private async extractInteractiveElements(
    snapshot: any,
    axTree: any,
    cdpSession: any
  ): Promise<Omit<BrowserUseElement, 'index' | 'hash' | 'stableHash'>[]> {
    const elements: Omit<BrowserUseElement, 'index' | 'hash' | 'stableHash'>[] = []

    // Build accessibility node map (backendNodeId -> axNode)
    const axNodeMap = new Map<number, any>()
    if (axTree.nodes) {
      for (const node of axTree.nodes) {
        if (node.backendDOMNodeId) {
          axNodeMap.set(node.backendDOMNodeId, node)
        }
      }
    }

    log.debug('BrowserUseDOM', `AX Tree: ${axTree.nodes?.length || 0} nodes, mapped ${axNodeMap.size}`, undefined)

    // Process DOM nodes
    // DOMSnapshot returns arrays in parallel structure
    const docIndex = 0 // First document is usually the main frame
    const documents = snapshot.documents || []

    if (!documents.length) {
      log.warn('BrowserUseDOM', 'No documents in snapshot')
      return elements
    }

    // Use the first document
    const doc = documents[0]
    const nodes = doc.nodes || {}

    // CDP uses string table - indices in arrays point to snapshot.strings
    const strings = snapshot.strings || []
    log.debug('BrowserUseDOM', `String table: ${strings.length} entries`, undefined)

    // Extract node info from arrays
    const nodeTypes = nodes.nodeType || []
    const nodeNames = nodes.nodeName || []
    const backendIds = nodes.backendNodeId || []
    const attributes = nodes.attributes || []
    const layoutNodeIndices = nodes.layoutNodeIndex || []

    log.debug('BrowserUseDOM', `Processing ${nodeTypes.length} nodes, Layout nodes: ${doc.layout?.layoutTreeNode?.length || 0}`, undefined)

    let elementNodeCount = 0
    let interactiveTagCount = 0
    let withBoundsCount = 0
    let noLayoutIndexCount = 0

    for (let i = 0; i < nodeTypes.length; i++) {
      // Skip non-element nodes (nodeType !== 1)
      if (nodeTypes[i] !== 1) continue
      elementNodeCount++

      // nodeName can be string, number (string table index), or array [namespace, name]
      const rawName = nodeNames[i]
      let tagName = ''
      if (typeof rawName === 'number' && rawName >= 0 && rawName < strings.length) {
        // String table index
        tagName = strings[rawName]
      } else if (typeof rawName === 'string') {
        tagName = rawName
      } else if (Array.isArray(rawName) && rawName.length > 0) {
        // If it's an array, use the last element (local name)
        const lastElement = rawName[rawName.length - 1]
        if (typeof lastElement === 'number' && lastElement >= 0 && lastElement < strings.length) {
          tagName = strings[lastElement]
        } else {
          tagName = typeof lastElement === 'string' ? lastElement : String(lastElement)
        }
      } else {
        tagName = String(rawName || '')
      }

      const tag = tagName.toLowerCase()
      const backendNodeId = backendIds[i]

      // Parse attributes array into key-value pairs first
      // CDP returns attribute names as string table indices
      const attrArray = attributes[i] || []
      const attrMap = this.parseAttributes(attrArray, strings)

      // Debug: 打印弹窗元素的原始属性 (索引 45-54)
      if (i >= 45 && i <= 55) {
        log.debug('BrowserUseDOM', `Debug Node ${i} <${tag}>`, { attrs: Array.from(attrMap.entries()), axName: axNodeMap.get(backendNodeId)?.name?.value })
      }

      // Check if interactive
      const isInteractive = this.isInteractive(tag, attrMap, axNodeMap, backendNodeId)
      if (!isInteractive) {
        continue
      }
      interactiveTagCount++

      // Get bounds from layout tree (optional - may not be available)
      let bounds = { x: 0, y: 0, width: 0, height: 0 }
      const layoutIndex = layoutNodeIndices[i]

      if (layoutIndex !== undefined && layoutIndex >= 0) {
        const layoutBounds = this.getBoundsFromLayout(layoutIndex, doc.layout?.layoutTreeNode || [])
        if (layoutBounds) {
          bounds = layoutBounds
          withBoundsCount++
        } else {
          noLayoutIndexCount++
        }
      } else {
        noLayoutIndexCount++
      }

      // 如果没有从 layout 获取到 bounds，尝试使用 CDP DOM.getBoxModel
      if (bounds.width === 0 && bounds.height === 0 && backendNodeId) {
        try {
          const boxModel = await cdpSession.send('DOM.getBoxModel', {
            backendNodeId
          }) as any
          if (boxModel?.model?.content) {
            const content = boxModel.model.content
            // content: [x1, y1, x2, y2, x3, y3, x4, y4]
            bounds = {
              x: Math.round(content[0]),
              y: Math.round(content[1]),
              width: Math.round(content[2] - content[0]),
              height: Math.round(content[5] - content[1])
            }
            if (bounds.width > 0 && bounds.height > 0) {
              withBoundsCount++
            }
          }
        } catch {
          // 忽略错误，bounds 保持为 0
        }
      }

      // Get accessibility info
      const axNode = axNodeMap.get(backendNodeId)
      const axRole = axNode?.role?.value
      const domRole = attrMap.get('role')
      const finalRole = axRole || domRole

      // 分类元素类型（基于 AX Tree role > DOM role > tag）
      const elementType = this.classifyElementType(tag, finalRole, attrMap)

      // 计算置信度
      const confidence = this.calculateConfidence(tag, finalRole, axNode, attrMap)

      // 判断是否为主要操作按钮
      const isMainAction = this.isMainActionButton(elementType, finalRole, attrMap, axNode)

      elements.push({
        nodeId: i,
        backendNodeId,
        tag,
        id: attrMap.get('id'),
        role: finalRole,
        name: axNode?.name?.value,
        type: attrMap.get('type'),
        placeholder: attrMap.get('placeholder'),
        value: attrMap.get('value'),
        ariaLabel: attrMap.get('aria-label'),
        isClickable: this.isClickable(attrMap, axNode),
        isVisible: bounds.width > 0 && bounds.height > 0,
        bounds,
        elementType,
        confidence,
        isMainAction,
      })
    }

    log.debug('BrowserUseDOM', `Summary - Elements: ${elementNodeCount}, Interactive: ${interactiveTagCount}, WithBounds: ${withBoundsCount}, Final: ${elements.length}`, undefined)

    return elements
  }

  /**
   * Parse attributes array from CDP format
   * CDP returns attributes as [nameIndex1, valueIndex1, nameIndex2, valueIndex2, ...]
   * where indices point to snapshot.strings array
   * Name can be string or array [namespace, localName]
   */
  private parseAttributes(attrArray: any[], strings: string[]): Map<string, string> {
    const map = new Map<string, string>()
    for (let i = 0; i < attrArray.length; i += 2) {
      const rawName = attrArray[i]
      const rawValue = attrArray[i + 1]

      // Resolve string table index to actual string
      let name = ''
      if (typeof rawName === 'number' && rawName >= 0 && rawName < strings.length) {
        name = strings[rawName]
      } else if (typeof rawName === 'string') {
        name = rawName
      } else if (Array.isArray(rawName) && rawName.length > 0) {
        // Handle array of indices
        const lastIdx = rawName[rawName.length - 1]
        if (typeof lastIdx === 'number' && lastIdx >= 0 && lastIdx < strings.length) {
          name = strings[lastIdx]
        } else {
          name = String(lastIdx || '')
        }
      } else {
        name = String(rawName || '')
      }

      // Resolve value from string table if it's an index
      let value = ''
      if (typeof rawValue === 'number' && rawValue >= 0 && rawValue < strings.length) {
        value = strings[rawValue]
      } else {
        value = String(rawValue || '')
      }

      if (name) {
        map.set(name.toLowerCase(), value)
      }
    }
    return map
  }

  /**
   * Get bounds from layout tree
   */
  private getBoundsFromLayout(layoutIndex: number, layoutNodes: any[]): { x: number; y: number; width: number; height: number } | null {
    // layoutIndex of -1 means no layout info available
    if (layoutIndex === undefined || layoutIndex < 0 || !layoutNodes || !layoutNodes[layoutIndex]) {
      return null
    }

    const layout = layoutNodes[layoutIndex]
    // bounds is typically [x, y, width, height] or [x1, y1, x2, y2, x3, y3, x4, y4]
    const bounds = layout.bounds
    if (!bounds || bounds.length < 4) return null

    // Handle both formats
    if (bounds.length === 4) {
      return {
        x: Math.round(bounds[0]),
        y: Math.round(bounds[1]),
        width: Math.round(bounds[2]),
        height: Math.round(bounds[3]),
      }
    }

    // If 8 values (quad), calculate bounding box
    if (bounds.length === 8) {
      const x = Math.min(bounds[0], bounds[2], bounds[4], bounds[6])
      const y = Math.min(bounds[1], bounds[3], bounds[5], bounds[7])
      const maxX = Math.max(bounds[0], bounds[2], bounds[4], bounds[6])
      const maxY = Math.max(bounds[1], bounds[3], bounds[5], bounds[7])
      return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(maxX - x),
        height: Math.round(maxY - y),
      }
    }

    return null
  }

  // 搜索指示器关键词（通用语义，不针对特定网站）
  private SEARCH_INDICATORS = [
    'search', 'query', 'find', 'lookup',
    'searchbox', 'search-input', 'search-field'
  ]

  /**
   * 判断元素是否可交互
   * 增强版：整合 AX Tree、DOM 属性和搜索框特殊检测
   */
  private isInteractive(
    tag: string,
    attrMap: Map<string, string>,
    axNodeMap: Map<number, any>,
    backendNodeId: number
  ): boolean {
    // 1. 基于标签名
    const interactiveTags = new Set([
      'input', 'textarea', 'select', 'button', 'a', 'option',
      'details', 'summary',
    ])
    if (interactiveTags.has(tag)) return true

    // 2. 基于 ARIA role
    const role = attrMap.get('role')
    const interactiveRoles = new Set([
      'button', 'link', 'textbox', 'searchbox', 'combobox',
      'checkbox', 'radio', 'tab', 'menuitem', 'option',
      'slider', 'spinbutton', 'switch',
    ])
    if (role && interactiveRoles.has(role)) return true

    // 3. 基于 Accessibility Tree（最可靠的语义信息源）
    const axNode = axNodeMap.get(backendNodeId)
    if (axNode) {
      const axRole = axNode.role?.value
      // AX Tree 中的 searchbox 角色是搜索框的黄金标准
      if (axRole && interactiveRoles.has(axRole)) return true

      // Check interactive properties
      if (axNode.properties) {
        for (const prop of axNode.properties) {
          if (['focusable', 'clickable', 'editable'].includes(prop.name) && prop.value?.value === true) {
            return true
          }
        }
      }
    }

    // 4. 基于事件处理器
    const hasClickHandler = attrMap.get('onclick') ||
                           attrMap.get('onmousedown') ||
                           attrMap.get('onmouseup')
    if (hasClickHandler) return true

    // 5. 基于 tabindex
    const tabindex = attrMap.get('tabindex')
    if (tabindex && parseInt(tabindex) >= 0) return true

    // 6. contenteditable
    if (attrMap.get('contenteditable') === 'true') return true

    return false
  }

  /**
   * 基于语义信息分类元素类型
   * 优先级：AX Tree role > DOM role > HTML tag
   */
  private classifyElementType(
    tag: string,
    role: string | undefined,
    attrMap: Map<string, string>
  ): BrowserUseElement['elementType'] {
    const effectiveRole = role?.toLowerCase()
    const inputType = attrMap.get('type')?.toLowerCase()

    // 基于 ARIA role 分类（最可靠）
    switch (effectiveRole) {
      case 'searchbox':
        return 'search'
      case 'textbox':
        return 'text_input'
      case 'button':
        return 'button'
      case 'link':
        return 'link'
      case 'combobox':
      case 'listbox':
        return 'select'
      case 'checkbox':
        return 'checkbox'
      case 'radio':
        return 'radio'
    }

    // 基于 HTML tag 和 type 属性分类
    if (tag === 'input') {
      switch (inputType) {
        case 'search':
          return 'search'
        case 'text':
        case 'email':
        case 'password':
        case 'url':
        case 'tel':
        case 'number':
          return 'text_input'
        case 'checkbox':
          return 'checkbox'
        case 'radio':
          return 'radio'
        case 'submit':
        case 'button':
        case 'reset':
          return 'button'
        default:
          return 'text_input'
      }
    }

    if (tag === 'textarea') return 'text_input'
    if (tag === 'button') return 'button'
    if (tag === 'a') return 'link'
    if (tag === 'select') return 'select'

    return 'other'
  }

  /**
   * 计算元素识别置信度（0-1）
   * 基于多信号一致性
   */
  private calculateConfidence(
    tag: string,
    role: string | undefined,
    axNode: any,
    attrMap: Map<string, string>
  ): number {
    let signals = 0
    let agreedSignals = 0

    // Signal 1: AX Tree 提供 role
    if (axNode?.role?.value) {
      signals++
      agreedSignals++
    }

    // Signal 2: DOM 提供 role
    if (attrMap.get('role')) {
      signals++
      if (axNode?.role?.value === attrMap.get('role')) {
        agreedSignals++
      }
    }

    // Signal 3: 交互属性
    if (axNode?.properties) {
      const hasInteractiveProp = axNode.properties.some(
        (p: any) => ['focusable', 'clickable', 'editable'].includes(p.name) && p.value?.value === true
      )
      if (hasInteractiveProp) {
        signals++
        agreedSignals++
      }
    }

    // Signal 4: 标准交互标签
    const interactiveTags = ['input', 'button', 'a', 'textarea', 'select']
    if (interactiveTags.includes(tag)) {
      signals++
      agreedSignals++
    }

    // 置信度 = 同意的信号 / 总信号
    return signals > 0 ? agreedSignals / signals : 0.5
  }

  /**
   * 判断是否为主要操作按钮
   * 基于语义和位置启发式
   */
  private isMainActionButton(
    elementType: BrowserUseElement['elementType'],
    role: string | undefined,
    attrMap: Map<string, string>,
    axNode: any
  ): boolean {
    if (elementType !== 'button') return false

    // 基于 type 属性
    const type = attrMap.get('type')
    if (type === 'submit') return true

    // 基于 ARIA 属性
    const ariaLabel = (attrMap.get('aria-label') || '').toLowerCase()
    if (ariaLabel.includes('search') || ariaLabel.includes('submit')) return true

    // 基于名称
    const name = (axNode?.name?.value || '').toLowerCase()
    const primaryActions = ['search', 'submit', 'save', 'confirm', 'continue', 'next', 'done']
    if (primaryActions.some(a => name.includes(a))) return true

    return false
  }

  /**
   * 判断元素是否可点击
   */
  private isClickable(attrMap: Map<string, string>, axNode: any): boolean {
    // Check AX properties
    if (axNode?.properties) {
      for (const prop of axNode.properties) {
        if (prop.name === 'clickable' && prop.value?.value === true) {
          return true
        }
      }
    }

    // Click handlers
    if (attrMap.get('onclick')) return true

    // Cursor style (would need computed styles, skipping for now)

    return false
  }

  /**
   * 计算元素哈希
   */
  private computeHash(el: Omit<BrowserUseElement, 'index' | 'hash' | 'stableHash'>): string {
    const input = [
      el.tag,
      el.role,
      el.name,
      el.type,
      el.ariaLabel,
      el.placeholder,
      Math.round(el.bounds.x),
      Math.round(el.bounds.y),
    ].join('|')

    return this.hashString(input)
  }

  /**
   * 计算稳定哈希（过滤动态属性）
   */
  private computeStableHash(el: Omit<BrowserUseElement, 'index' | 'hash' | 'stableHash'>): string {
    const input = [
      el.tag,
      el.role,
      el.name,
      el.type,
      el.ariaLabel,
      // 不包含 placeholder（可能动态变化）
      // 使用相对位置而非绝对位置
      Math.round(el.bounds.x / 100) * 100,
      Math.round(el.bounds.y / 100) * 100,
    ].join('|')

    return this.hashString(input)
  }

  private hashString(input: string): string {
    let hash = 0
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return hash.toString(16)
  }

  /**
   * 格式化为 LLM 友好的表示
   * 优先显示主要操作元素，包含语义类型信息
   */
  formatForLLM(elements: BrowserUseElement[], maxLength: number = 50): string {
    const lines: string[] = []

    // 按优先级排序：主要操作 > 高置信度 > 其他
    const sortedElements = [...elements].sort((a, b) => {
      if (a.isMainAction && !b.isMainAction) return -1
      if (!a.isMainAction && b.isMainAction) return 1
      return b.confidence - a.confidence
    })

    for (const el of sortedElements.slice(0, maxLength)) {
      const parts: string[] = [`[${el.index}]`]

      // 显示元素类型（LLM 更容易理解）
      parts.push(`${el.elementType}`)

      // 标签和 role
      if (el.role && el.role !== el.tag) {
        parts.push(`<${el.tag} role="${el.role}">`)
      } else {
        parts.push(`<${el.tag}>`)
      }

      // 名称（最重要的识别信息）
      if (el.name) {
        parts.push(`name="${this.truncate(el.name, 30)}"`)
      } else if (el.placeholder) {
        parts.push(`placeholder="${this.truncate(el.placeholder, 25)}"`)
      }

      // 输入框类型
      if (el.type && el.elementType !== 'button' && el.elementType !== 'link') {
        parts.push(`type="${el.type}"`)
      }

      // 低置信度标记（提醒 LLM 谨慎）
      if (el.confidence < 0.6) {
        parts.push('(low_confidence)')
      }

      lines.push(parts.join(' '))
    }

    return lines.join('\n')
  }

  private truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str
    return str.substring(0, maxLen - 3) + '...'
  }
}

// 默认实例
export const browserUseDOM = new BrowserUseDOMService()
