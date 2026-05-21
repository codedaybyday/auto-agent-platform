/**
 * Accessibility Tree 获取器
 * 使用 Chrome DevTools Protocol (CDP) 获取可访问性树
 *
 * 优势：
 * 1. 比 DOM 遍历更稳定（浏览器内核维护）
 * 2. 自动过滤不可见元素
 * 3. 包含 ARIA 属性
 * 4. 不受 React/Vue 动态更新影响
 */

import { Page, CDPSession } from 'playwright'

// CDP AXNode interface (relaxed types for CDP compatibility)
interface AXNode {
  nodeId: string
  ignored?: boolean
  ignoredReasons?: Array<{ name: string }>
  role?: { type: string; value?: string } | any
  name?: { type: string; value?: string; sources?: any[] } | any
  description?: string | any
  value?: { type: string; value?: string } | any
  properties?: Array<{ name: string; value: { type: string; value?: any } }> | any
  childIds?: string[]
  backendDOMNodeId?: number
}

export interface InteractiveElement {
  index: number
  nodeId: string
  backendDOMNodeId: number
  role: string
  name?: string
  nameValue?: any // AXValue from Playwright
  description?: string
  value?: string
  valueValue?: any // AXValue from Playwright
  properties: Map<string, any>
  bounds?: { x: number; y: number; width: number; height: number }
}

export class AccessibilityTreeService {
  private cdpSession: CDPSession | null = null

  /**
   * 获取页面的 Accessibility Tree
   */
  async getAccessibilityTree(page: Page): Promise<{
    nodes: AXNode[]
    interactiveElements: InteractiveElement[]
  }> {
    // 创建 CDP 会话
    this.cdpSession = await page.context().newCDPSession(page)

    try {
      // 获取完整的 accessibility tree
      const result = await this.cdpSession.send('Accessibility.getFullAXTree')
      const nodes: AXNode[] = result.nodes

      // 提取可交互元素
      const interactiveElements = this.extractInteractiveElements(nodes)

      // 获取元素位置信息
      await this.enrichWithBounds(interactiveElements)

      return { nodes, interactiveElements }
    } finally {
      // 不关闭会话，可以复用
      // await this.cdpSession.detach()
    }
  }

  /**
   * 提取可交互元素
   */
  private extractInteractiveElements(nodes: AXNode[]): InteractiveElement[] {
    const interactiveRoles = new Set([
      'button',
      'link',
      'textbox',
      'searchbox',
      'combobox',
      'listbox',
      'checkbox',
      'radio',
      'menu',
      'menuitem',
      'tab',
      'tabpanel',
      'tree',
      'treeitem',
      'slider',
      'spinbutton',
      'switch',
    ])

    const interactiveTags = new Set([
      'input',
      'button',
      'select',
      'textarea',
      'a',
    ])

    const elements: InteractiveElement[] = []
    let index = 0

    for (const node of nodes) {
      // 跳过被忽略的元素
      if (node.ignored) continue

      const role = node.role?.value?.toLowerCase() || ''
      const name = node.name || ''

      // 检查是否是可交互元素
      const isInteractive = interactiveRoles.has(role) || this.hasInteractiveProperty(node)

      if (!isInteractive) continue

      // 提取属性
      const properties = new Map<string, any>()
      if (node.properties) {
        for (const prop of node.properties) {
          properties.set(prop.name, prop.value.value)
        }
      }

      elements.push({
        index: index++,
        nodeId: node.nodeId,
        backendDOMNodeId: node.backendDOMNodeId || 0,
        role,
        name,
        nameValue: node.name,
        description: node.description,
        value: node.value?.value,
        valueValue: node.value,
        properties,
      })
    }

    return elements
  }

  /**
   * 检查节点是否有可交互属性
   */
  private hasInteractiveProperty(node: AXNode): boolean {
    const interactiveProps = ['focusable', 'clickable', 'editable']
    if (!node.properties) return false

    return node.properties.some((prop: { name: string; value: { value?: any } }) =>
      interactiveProps.includes(prop.name) && prop.value.value === true
    )
  }

  /**
   * 使用 DOM.getBoxModel 获取元素位置
   */
  private async enrichWithBounds(elements: InteractiveElement[]): Promise<void> {
    if (!this.cdpSession) return

    for (const el of elements) {
      try {
        // 通过 backendDOMNodeId 获取位置
        const result = await this.cdpSession.send('DOM.getBoxModel', {
          backendNodeId: el.backendDOMNodeId,
        })

        if (result && result.model) {
          const { content } = result.model
          // content 是 [x1, y1, x2, y2, x3, y3, x4, y4] 四角坐标
          el.bounds = {
            x: Math.round(content[0]),
            y: Math.round(content[1]),
            width: Math.round(content[2] - content[0]),
            height: Math.round(content[5] - content[1]),
          }
        }
      } catch {
        // 某些元素可能无法获取位置，忽略
      }
    }
  }

  /**
   * 将可交互元素格式化为 LLM 友好的文本
   */
  formatForLLM(elements: InteractiveElement[], maxLength: number = 50): string {
    const lines: string[] = []

    for (const el of elements.slice(0, maxLength)) {
      const parts: string[] = [`[${el.index}]`]

      // 角色
      parts.push(`<${el.role}>`)

      // 名称/文本
      if (el.name) {
        parts.push(`name="${this.truncate(el.name, 40)}"`)
      }

      // 值（输入框）
      if (el.value) {
        parts.push(`value="${this.truncate(el.value, 30)}"`)
      }

      // placeholder
      const placeholder = el.properties.get('placeholder')
      if (placeholder) {
        parts.push(`placeholder="${this.truncate(placeholder, 30)}"`)
      }

      lines.push(parts.join(' '))
    }

    return lines.join('\n')
  }

  private truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str
    return str.substring(0, maxLen - 3) + '...'
  }

  /**
   * 查找元素的 backend DOM node ID
   */
  async findBackendNodeId(page: Page, selector: string): Promise<number | null> {
    if (!this.cdpSession) return null

    try {
      // 先获取元素的 objectId
      const remoteObject = await this.cdpSession.send('Runtime.evaluate', {
        expression: `document.querySelector('${selector}')`,
        returnByValue: false,
      })

      if (!remoteObject.result.objectId) return null

      // 请求 node ID
      const nodeInfo = await this.cdpSession.send('DOM.requestNode', {
        objectId: remoteObject.result.objectId,
      })

      return nodeInfo.nodeId
    } catch {
      return null
    }
  }

  /**
   * 通过 index 查找元素（用于从 LLM 响应定位）
   */
  async findElementByIndex(
    page: Page,
    index: number,
    elements: InteractiveElement[]
  ): Promise<{ nodeId: string; backendNodeId: number } | null> {
    const el = elements[index]
    if (!el) return null

    return {
      nodeId: el.nodeId,
      backendNodeId: el.backendDOMNodeId,
    }
  }
}

// 默认实例
export const accessibilityService = new AccessibilityTreeService()
