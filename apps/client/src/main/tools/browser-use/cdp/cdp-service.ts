/**
 * CDP Service - Chrome DevTools Protocol 服务管理器
 *
 * 提供原生的 Chrome CDP 能力：
 * 1. Accessibility Tree 获取
 * 2. DOMDebugger 事件监听检测
 * 3. DOM BoxModel 计算
 *
 * 参考 browser-use 的 CDP 使用方式
 */

import { Page, CDPSession } from 'playwright'

// AX Tree 类型定义（基于 CDP Accessibility 域）
export interface AXNode {
  nodeId: string
  ignored?: boolean
  ignoredReasons?: Array<{ name: string }>
  role?: { type: string; value?: string }
  name?: { type: string; value?: string }
  value?: { type: string; value?: string }
  description?: { type: string; value?: string }
  properties?: Array<{
    name: string
    value: { type: string; value?: any }
  }>
  childIds?: string[]
  backendDOMNodeId?: number
}

// 事件监听器信息
export interface EventListener {
  type: string
  useCapture: boolean
  passive: boolean
  once: boolean
  handler?: {
    type: string
    scriptId?: string
    lineNumber?: number
    columnNumber?: number
  }
}

// 增强的元素信息
export interface EnhancedElementInfo {
  // DOM 信息
  nodeId: number
  backendNodeId: number
  nodeName: string

  // AX Tree 信息
  axNode?: AXNode
  axRole?: string
  axName?: string
  isFocusable?: boolean
  isEditable?: boolean
  isSettable?: boolean

  // 事件监听
  eventListeners: EventListener[]
  hasClickListener: boolean
  hasInputListener: boolean
  hasKeyListener: boolean

  // 盒模型
  boundingBox?: {
    x: number
    y: number
    width: number
    height: number
  }
}

export class CDPService {
  private sessions = new Map<string, CDPSession>()

  /**
   * 获取或创建 CDP 会话
   */
  async getSession(page: Page): Promise<CDPSession> {
    const pageKey = page.url() + page.mainFrame().name()

    let session = this.sessions.get(pageKey)
    if (!session) {
      // 创建新的 CDP 会话
      session = await page.context().newCDPSession(page)
      this.sessions.set(pageKey, session)

      // 启用必要的域
      await this.enableDomains(session)

      log.info('CDPService', `New CDP session created for ${page.url()}`)
    }

    return session
  }

  /**
   * 启用必要的 CDP 域
   */
  private async enableDomains(session: CDPSession): Promise<void> {
    try {
      // 启用 Accessibility 域
      await session.send('Accessibility.enable')
      log.info('CDPService', 'Accessibility domain enabled')

      // 启用 DOM 域
      await session.send('DOM.enable')

      // 启用 CSS 域（用于计算样式）
      await session.send('CSS.enable')
    } catch (error) {
      log.error('CDPService', 'Failed to enable CDP domains', error)
      throw error
    }
  }

  /**
   * 获取完整的 Accessibility Tree
   * 参考 browser-use: browser_use/dom/service.py
   */
  async getFullAXTree(page: Page): Promise<AXNode[]> {
    const session = await this.getSession(page)

    try {
      const result = await session.send('Accessibility.getFullAXTree')
      return result.nodes || []
    } catch (error) {
      log.error('CDPService', 'Failed to get AX tree', error)
      return []
    }
  }

  /**
   * 通过 backendNodeId 获取对应的 AXNode
   */
  async getAXNodeByBackendId(
    page: Page,
    backendNodeId: number
  ): Promise<AXNode | undefined> {
    const axNodes = await this.getFullAXTree(page)

    return axNodes.find(node => node.backendDOMNodeId === backendNodeId)
  }

  /**
   * 获取元素的事件监听器
   * 参考 browser-use: 检测 Vue/React/Angular 事件绑定
   */
  async getEventListeners(
    page: Page,
    backendNodeId: number
  ): Promise<EventListener[]> {
    const session = await this.getSession(page)

    try {
      // 首先将 backendNodeId 转为 DOM node
      const result = await session.send('DOM.pushNodesByBackendIdsToFrontend', {
        backendNodeIds: [backendNodeId]
      }) as any

      const nodeIds = result?.nodeIds || []
      if (!nodeIds || nodeIds.length === 0) {
        return []
      }

      // 获取 RemoteObject
      const { object } = await session.send('DOM.resolveNode', {
        nodeId: nodeIds[0]
      })

      if (!object || !object.objectId) {
        return []
      }

      // 获取事件监听器
      const { listeners } = await session.send('DOMDebugger.getEventListeners', {
        objectId: object.objectId
      })

      // 释放 remote object
      await session.send('Runtime.releaseObject', {
        objectId: object.objectId
      })

      return listeners || []
    } catch (error) {
      log.warn('CDPService', `Failed to get event listeners for node ${backendNodeId}`, error)
      return []
    }
  }

  /**
   * 获取元素的盒模型
   */
  async getBoxModel(
    page: Page,
    backendNodeId: number
  ): Promise<{ x: number; y: number; width: number; height: number } | undefined> {
    const session = await this.getSession(page)

    try {
      const result = await session.send('DOM.getBoxModel', {
        backendNodeId
      })

      if (result && result.model) {
        // content 数组格式: [x1, y1, x2, y2, x3, y3, x4, y4]
        const content = result.model.content
        return {
          x: content[0],
          y: content[1],
          width: content[2] - content[0],
          height: content[5] - content[1]
        }
      }
    } catch (error) {
      log.warn('CDPService', `Failed to get box model for node ${backendNodeId}`)
    }

    return undefined
  }

  /**
   * 批量获取元素的增强信息
   * 这是主要的 API，整合所有 CDP 能力
   */
  async getEnhancedElements(
    page: Page,
    backendNodeIds: number[]
  ): Promise<Map<number, EnhancedElementInfo>> {
    const result = new Map<number, EnhancedElementInfo>()

    // 1. 获取所有 AX Nodes
    const axNodes = await this.getFullAXTree(page)
    const axNodeMap = new Map<number, AXNode>()
    for (const node of axNodes) {
      if (node.backendDOMNodeId) {
        axNodeMap.set(node.backendDOMNodeId, node)
      }
    }

    // 2. 批量获取每个元素的信息
    for (const backendNodeId of backendNodeIds) {
      const axNode = axNodeMap.get(backendNodeId)
      const listeners = await this.getEventListeners(page, backendNodeId)
      const boundingBox = await this.getBoxModel(page, backendNodeId)

      // 解析 AX 属性
      const isFocusable = axNode?.properties?.some(
        p => p.name === 'focusable' && p.value.value === true
      )
      const isEditable = axNode?.properties?.some(
        p => p.name === 'editable' && p.value.value === true
      )
      const isSettable = axNode?.properties?.some(
        p => p.name === 'settable' && p.value.value === true
      )

      // 检查事件类型
      const hasClickListener = listeners.some(l =>
        ['click', 'mousedown', 'mouseup'].includes(l.type)
      )
      const hasInputListener = listeners.some(l =>
        ['input', 'change', 'focus', 'blur'].includes(l.type)
      )
      const hasKeyListener = listeners.some(l =>
        ['keydown', 'keyup', 'keypress'].includes(l.type)
      )

      const info: EnhancedElementInfo = {
        nodeId: 0, // 由调用者填充
        backendNodeId,
        nodeName: axNode?.role?.value || '',
        axNode,
        axRole: axNode?.role?.value,
        axName: axNode?.name?.value,
        isFocusable,
        isEditable,
        isSettable,
        eventListeners: listeners,
        hasClickListener,
        hasInputListener,
        hasKeyListener,
        boundingBox
      }

      result.set(backendNodeId, info)
    }

    return result
  }

  /**
   * 关闭所有 CDP 会话
   */
  async cleanup(): Promise<void> {
    for (const [key, session] of this.sessions) {
      try {
        await session.detach()
        log.info('CDPService', `Detached CDP session: ${key}`)
      } catch (e) {
        log.warn('CDPService', `Error detaching session: ${key}`, e)
      }
    }
    this.sessions.clear()
  }
}

// 导出单例
export const cdpService = new CDPService()

// 导入 log
import { log } from '@auto-agent/shared-utils'
