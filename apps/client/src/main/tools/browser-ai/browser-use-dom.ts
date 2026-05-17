/**
 * Browser-use 风格的 DOM 获取器
 * 使用 Playwright 的 CDP 会话获取完整的 DOM 信息
 */

import { Page } from 'playwright'

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
}

export class BrowserUseDOMService {
  /**
   * 获取页面可交互元素（browser-use 风格）
   * 结合 CDP DOM Snapshot + Accessibility Tree
   */
  async getInteractiveElements(page: Page): Promise<BrowserUseElement[]> {
    const cdpSession = await page.context().newCDPSession(page)

    try {
      console.log('[BrowserUseDOM] Getting DOM snapshot...')

      // 1. 获取 DOM Snapshot
      const snapshot = await cdpSession.send('DOMSnapshot.captureSnapshot', {
        computedStyles: ['display', 'visibility', 'opacity', 'cursor'],
        includePaintOrder: true,
        includeDOMRects: true,
      })

      console.log(`[BrowserUseDOM] Got snapshot with ${snapshot.documents?.length || 0} documents`)

      // 2. 获取 Accessibility Tree
      const axTree = await cdpSession.send('Accessibility.getFullAXTree')

      console.log(`[BrowserUseDOM] Got AX tree with ${axTree.nodes?.length || 0} nodes`)

      // 3. 提取可交互元素
      const elements = this.extractInteractiveElements(snapshot, axTree)

      console.log(`[BrowserUseDOM] Extracted ${elements.length} interactive elements`)

      // Debug: Log first few elements
      elements.slice(0, 5).forEach((el, i) => {
        console.log(`[BrowserUseDOM]   [${i}] ${el.tag} name="${el.name?.substring(0, 20)}" placeholder="${el.placeholder?.substring(0, 20)}"`)
      })

      // 4. 计算 hash
      const elementsWithHash = elements.map((el, idx) => ({
        ...el,
        index: idx,
        hash: this.computeHash(el),
        stableHash: this.computeStableHash(el),
      }))

      return elementsWithHash
    } catch (error) {
      console.error('[BrowserUseDOM] Error getting interactive elements:', error)
      throw error
    } finally {
      await cdpSession.detach()
    }
  }

  /**
   * 从 DOM Snapshot 提取可交互元素
   */
  private extractInteractiveElements(snapshot: any, axTree: any): Omit<BrowserUseElement, 'index' | 'hash' | 'stableHash'>[] {
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

    console.log(`[BrowserUseDOM] AX Tree has ${axTree.nodes?.length || 0} nodes, mapped ${axNodeMap.size} nodes`)

    // Process DOM nodes
    // DOMSnapshot returns arrays in parallel structure
    const docIndex = 0 // First document is usually the main frame
    const documents = snapshot.documents || []

    if (!documents.length) {
      console.log('[BrowserUseDOM] No documents in snapshot')
      return elements
    }

    // Use the first document
    const doc = documents[0]
    const nodes = doc.nodes || {}

    // Extract node info from arrays
    const nodeTypes = nodes.nodeType || []
    const nodeNames = nodes.nodeName || []
    const backendIds = nodes.backendNodeId || []
    const attributes = nodes.attributes || []
    const layoutNodeIndices = nodes.layoutNodeIndex || []

    console.log(`[BrowserUseDOM] Processing ${nodeTypes.length} nodes`)
    console.log(`[BrowserUseDOM] Layout nodes: ${doc.layout?.layoutTreeNode?.length || 0}`)

    let elementNodeCount = 0
    let interactiveTagCount = 0
    let withBoundsCount = 0
    let noLayoutIndexCount = 0

    for (let i = 0; i < nodeTypes.length; i++) {
      // Skip non-element nodes (nodeType !== 1)
      if (nodeTypes[i] !== 1) continue
      elementNodeCount++

      // nodeName can be string or array [namespace, name]
      const rawName = nodeNames[i]
      let tagName = ''
      if (typeof rawName === 'string') {
        tagName = rawName
      } else if (Array.isArray(rawName) && rawName.length > 0) {
        // If it's an array, use the last element (local name)
        const lastElement = rawName[rawName.length - 1]
        tagName = typeof lastElement === 'string' ? lastElement : String(lastElement)
      } else {
        tagName = String(rawName || '')
      }

      const tag = tagName.toLowerCase()
      const backendNodeId = backendIds[i]

      // Parse attributes array into key-value pairs first
      const attrMap = this.parseAttributes(attributes[i] || [])

      // Check if interactive
      const isInteractive = this.isInteractive(tag, attrMap, axNodeMap, backendNodeId)
      if (!isInteractive) {
        if (i < 20) {
          console.log(`[BrowserUseDOM] Node ${i} <${tag}> not interactive`)
        }
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

      // Get accessibility info
      const axNode = axNodeMap.get(backendNodeId)

      elements.push({
        nodeId: i,
        backendNodeId,
        tag,
        id: attrMap.get('id'),
        role: axNode?.role?.value || attrMap.get('role'),
        name: axNode?.name?.value,
        type: attrMap.get('type'),
        placeholder: attrMap.get('placeholder'),
        value: attrMap.get('value'),
        ariaLabel: attrMap.get('aria-label'),
        isClickable: this.isClickable(attrMap, axNode),
        isVisible: bounds.width > 0 && bounds.height > 0,
        bounds,
      })
    }

    console.log(`[BrowserUseDOM] Element nodes: ${elementNodeCount}, interactive: ${interactiveTagCount}, noLayoutIdx: ${noLayoutIndexCount}, withBounds: ${withBoundsCount}, final: ${elements.length}`)

    return elements
  }

  /**
   * Parse attributes array from CDP format
   * CDP returns attributes as [name1, value1, name2, value2, ...]
   * Name can be string or array [namespace, localName]
   */
  private parseAttributes(attrArray: any[]): Map<string, string> {
    const map = new Map<string, string>()
    for (let i = 0; i < attrArray.length; i += 2) {
      const rawName = attrArray[i]
      const value = attrArray[i + 1]

      // Handle name that could be string or array
      let name = ''
      if (typeof rawName === 'string') {
        name = rawName
      } else if (Array.isArray(rawName) && rawName.length > 0) {
        // Use the last element (local name)
        const lastElement = rawName[rawName.length - 1]
        name = typeof lastElement === 'string' ? lastElement : String(lastElement)
      } else {
        name = String(rawName || '')
      }

      if (name) {
        map.set(name.toLowerCase(), value || '')
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

  /**
   * 判断元素是否可交互
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

    // 3. 基于 Accessibility Tree
    const axNode = axNodeMap.get(backendNodeId)
    if (axNode) {
      const axRole = axNode.role?.value
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
   */
  formatForLLM(elements: BrowserUseElement[], maxLength: number = 50): string {
    const lines: string[] = []

    for (const el of elements.slice(0, maxLength)) {
      const parts: string[] = [`[${el.index}]`]
      parts.push(`<${el.tag}>`)

      if (el.role) parts.push(`role="${el.role}"`)
      if (el.type) parts.push(`type="${el.type}"`)
      if (el.name) parts.push(`name="${this.truncate(el.name, 30)}"`)
      if (el.placeholder) parts.push(`placeholder="${this.truncate(el.placeholder, 20)}"`)

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
