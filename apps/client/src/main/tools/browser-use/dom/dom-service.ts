/**
 * DOMService - 对齐 browser-use 的 DOM 获取服务
 *
 * 核心改进：
 * 1. 使用 DOMSnapshot + Accessibility Tree 获取完整信息
 * 2. 通过 DOM.getBoxModel 获取准确的 bounds
 * 3. 构建树结构，支持父子关系
 * 4. 稳定的元素哈希
 */

import { Page, CDPSession } from 'playwright'
import { log } from '@auto-agent/shared-utils'
import {
  DOMState,
  ElementNode,
  BoundingBox,
  computeCenter,
  computeElementHash
} from './dom-state'

export class DOMService {
  private sessions = new Map<string, CDPSession>()

  /**
   * 获取页面的完整 DOMState
   * 主入口函数
   */
  async getDOMState(page: Page): Promise<DOMState> {
    const startTime = Date.now()
    const url = page.url()
    const title = await page.title()

    // 获取或创建 CDP 会话
    const session = await this.getSession(page)

    try {
      // 1. 启用必要的域
      await this.enableDomains(session)

      // 2. 获取 DOM Snapshot
      const snapshot = await session.send('DOMSnapshot.captureSnapshot', {
        computedStyles: ['display', 'visibility', 'opacity'],
        includePaintOrder: true,
        includeDOMRects: true
      }) as any

      // 3. 获取 Accessibility Tree
      const axTree = await session.send('Accessibility.getFullAXTree') as any

      // 4. 构建元素树
      const elementTree = await this.buildElementTree(
        snapshot,
        axTree,
        session
      )

      // 5. 构建 selector map
      const selectorMap = new Map<number, ElementNode>()
      for (const element of elementTree) {
        selectorMap.set(element.index, element)
      }

      const visibleElements = elementTree.filter(e => e.isVisible).length
      const interactiveElements = elementTree.filter(e => e.isInteractive).length

      const state: DOMState = {
        url,
        title,
        timestamp: Date.now(),
        elementTree,
        selectorMap,
        stats: {
          totalElements: elementTree.length,
          visibleElements,
          interactiveElements
        }
      }

      log.info('DOMService', `Got DOMState: ${elementTree.length} elements (${interactiveElements} interactive) in ${Date.now() - startTime}ms`)

      return state
    } catch (error) {
      log.error('DOMService', 'Failed to get DOMState', error)
      throw error
    }
  }

  /**
   * 获取或创建 CDP 会话
   */
  private async getSession(page: Page): Promise<CDPSession> {
    const pageId = page.url()

    let session = this.sessions.get(pageId)
    if (!session) {
      session = await page.context().newCDPSession(page)
      this.sessions.set(pageId, session)
    }

    return session
  }

  /**
   * 启用必要的 CDP 域
   */
  private async enableDomains(session: CDPSession): Promise<void> {
    await session.send('DOM.enable')
    await session.send('Accessibility.enable')
    // DOMDebugger.enable 在某些 Chrome 版本中不可用，忽略错误
  }

  /**
   * 构建元素树
   */
  private async buildElementTree(
    snapshot: any,
    axTree: any,
    session: CDPSession
  ): Promise<ElementNode[]> {
    const elements: ElementNode[] = []

    // 构建 AX Node 映射（backendNodeId -> axNode）
    const axNodeMap = new Map<number, any>()
    if (axTree.nodes) {
      for (const node of axTree.nodes) {
        if (node.backendDOMNodeId) {
          axNodeMap.set(node.backendDOMNodeId, node)
        }
      }
    }

    // 处理 DOM Snapshot
    const documents = snapshot.documents || []
    if (!documents.length) {
      return elements
    }

    const doc = documents[0]
    const nodes = doc.nodes || {}
    const strings = snapshot.strings || []

    const nodeTypes = nodes.nodeType || []
    const nodeNames = nodes.nodeName || []
    const backendIds = nodes.backendNodeId || []
    const attributes = nodes.attributes || []
    const parentIndices = nodes.parentIndex || []

    // 首先构建索引映射
    const indexMap = new Map<number, number>() // backendNodeId -> index

    let elementIndex = 0
    for (let i = 0; i < nodeTypes.length; i++) {
      if (nodeTypes[i] !== 1) continue // 跳过非元素节点

      const backendNodeId = backendIds[i]
      if (backendNodeId) {
        indexMap.set(backendNodeId, elementIndex++)
      }
    }

    // 重置索引
    elementIndex = 0

    for (let i = 0; i < nodeTypes.length; i++) {
      // 跳过非元素节点
      if (nodeTypes[i] !== 1) continue

      const backendNodeId = backendIds[i]
      const tagName = this.resolveString(nodeNames[i], strings).toLowerCase()
      const attrMap = this.parseAttributes(attributes[i] || [], strings)
      const axNode = axNodeMap.get(backendNodeId)

      // 检查是否为可交互元素
      const isInteractive = this.isInteractiveElement(tagName, attrMap, axNode)

      // 获取 bounds（优先使用 CDP DOM.getBoxModel）
      let bounds = { x: 0, y: 0, width: 0, height: 0 }
      let isVisible = false

      if (backendNodeId) {
        try {
          const boxModel = await session.send('DOM.getBoxModel', {
            backendNodeId
          }) as any

          if (boxModel?.model?.content) {
            const content = boxModel.model.content
            bounds = {
              x: Math.round(content[0]),
              y: Math.round(content[1]),
              width: Math.round(content[2] - content[0]),
              height: Math.round(content[5] - content[1])
            }
            isVisible = bounds.width > 0 && bounds.height > 0
          }
        } catch {
          // 元素可能已不存在或不可见
        }
      }

      // 构建父子和兄弟关系
      const parentIndex = parentIndices[i]
      const children: number[] = []

      // 查找子元素
      for (let j = i + 1; j < nodeTypes.length; j++) {
        if (nodeTypes[j] !== 1) continue
        if (parentIndices[j] === i) {
          const childBackendId = backendIds[j]
          const childIndex = indexMap.get(childBackendId)
          if (childIndex !== undefined) {
            children.push(childIndex)
          }
        }
      }

      const element: ElementNode = {
        index: elementIndex,
        backendNodeId,
        tagName,
        role: axNode?.role?.value || attrMap.get('role'),
        name: axNode?.name?.value,
        description: axNode?.description?.value,
        id: attrMap.get('id'),
        className: attrMap.get('class'),
        type: attrMap.get('type'),
        placeholder: attrMap.get('placeholder'),
        ariaLabel: attrMap.get('aria-label'),
        ariaRole: attrMap.get('role'),
        href: attrMap.get('href'),
        src: attrMap.get('src'),
        isVisible,
        isEnabled: !attrMap.get('disabled'),
        isReadOnly: attrMap.get('readonly') === 'true',
        isInteractive,
        isClickable: this.isClickable(attrMap, axNode),
        isEditable: this.isEditable(tagName, attrMap, axNode),
        isFocusable: this.isFocusable(attrMap, axNode),
        bounds,
        center: computeCenter(bounds),
        children,
        parent: parentIndex >= 0 ? indexMap.get(backendIds[parentIndices[parentIndex]]) : undefined,
        text: axNode?.value?.value || attrMap.get('value'),
        hash: '' // 稍后计算
      }

      // 计算哈希
      element.hash = computeElementHash(element)

      elements.push(element)
      elementIndex++
    }

    return elements
  }

  /**
   * 解析属性数组
   */
  private parseAttributes(attrArray: any[], strings: string[]): Map<string, string> {
    const map = new Map<string, string>()

    for (let i = 0; i < attrArray.length; i += 2) {
      const name = this.resolveString(attrArray[i], strings).toLowerCase()
      const value = this.resolveString(attrArray[i + 1], strings)

      if (name) {
        map.set(name, value)
      }
    }

    return map
  }

  /**
   * 解析字符串表索引
   */
  private resolveString(value: any, strings: string[]): string {
    if (typeof value === 'number' && value >= 0 && value < strings.length) {
      return strings[value]
    }
    return String(value || '')
  }

  /**
   * 判断元素是否可交互
   */
  private isInteractiveElement(tagName: string, attrMap: Map<string, string>, axNode: any): boolean {
    // 基于标签名
    const interactiveTags = ['input', 'button', 'a', 'textarea', 'select', 'option']
    if (interactiveTags.includes(tagName)) return true

    // 基于 ARIA role
    const role = attrMap.get('role')
    const interactiveRoles = ['button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'tab']
    if (role && interactiveRoles.includes(role)) return true

    // 基于 AX Tree
    if (axNode?.role?.value && interactiveRoles.includes(axNode.role.value)) return true

    // 基于事件处理器
    if (attrMap.get('onclick') || attrMap.get('onmousedown')) return true

    // 基于 tabindex
    const tabIndex = attrMap.get('tabindex')
    if (tabIndex && parseInt(tabIndex) >= 0) return true

    return false
  }

  /**
   * 判断元素是否可点击
   */
  private isClickable(attrMap: Map<string, string>, axNode: any): boolean {
    if (axNode?.properties?.some((p: any) => p.name === 'clickable' && p.value?.value)) {
      return true
    }
    if (attrMap.get('onclick')) return true
    return false
  }

  /**
   * 判断元素是否可编辑
   */
  private isEditable(tagName: string, attrMap: Map<string, string>, axNode: any): boolean {
    if (tagName === 'input' || tagName === 'textarea') {
      const type = attrMap.get('type')
      if (type === 'button' || type === 'submit' || type === 'checkbox' || type === 'radio') {
        return false
      }
      return !attrMap.get('readonly') && !attrMap.get('disabled')
    }

    if (axNode?.properties?.some((p: any) => p.name === 'editable' && p.value?.value)) {
      return true
    }

    return false
  }

  /**
   * 判断元素是否可聚焦
   */
  private isFocusable(attrMap: Map<string, string>, axNode: any): boolean {
    if (axNode?.properties?.some((p: any) => p.name === 'focusable' && p.value?.value)) {
      return true
    }

    const tabIndex = attrMap.get('tabindex')
    if (tabIndex && parseInt(tabIndex) >= 0) return true

    return false
  }

  /**
   * 清理会话
   */
  async cleanup(): Promise<void> {
    for (const [key, session] of this.sessions) {
      try {
        await session.detach()
        log.info('DOMService', `Detached session: ${key}`)
      } catch (e) {
        // ignore
      }
    }
    this.sessions.clear()
  }
}

// 导出单例
export const domService = new DOMService()
