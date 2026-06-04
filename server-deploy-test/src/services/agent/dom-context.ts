/**
 * DOM Context Manager
 * 管理页面 DOM 状态，实现智能缓存和增量更新
 *
 * 设计理念：
 * - 每 step 只获取一次 DOM
 * - 根据动作类型智能判断是否需要刷新
 * - 支持 DOM 版本管理
 */

import { WSConnection } from '../../types/index.js'

export interface DOMState {
  url: string
  title: string
  elements: SerializedElement[]
  screenshot?: string
  timestamp: number
  version: number
  sessionId: string
}

export interface SerializedElement {
  ref: number
  tag: string
  id?: string
  type?: string
  name?: string
  placeholder?: string
  text?: string
  role?: string
  ariaLabel?: string
  hash?: string
  stableHash?: string
  bbox?: {
    x: number
    y: number
    width: number
    height: number
  }
}

export interface DOMChange {
  type: 'added' | 'removed' | 'modified'
  element: SerializedElement
  parentRef?: number
}

interface DOMCacheEntry {
  state: DOMState
  lastAction?: ActionInfo
}

interface ActionInfo {
  type: string
  timestamp: number
  target?: string
}

export class DOMContextManager {
  private cache = new Map<string, DOMCacheEntry>()
  private wsClient: WSConnection | null = null

  bindWebSocket(wsClient: WSConnection): void {
    this.wsClient = wsClient
  }

  /**
   * 获取当前 DOM 状态（智能缓存）
   */
  async getCurrentState(sessionId: string, forceRefresh = false): Promise<DOMState> {
    const cached = this.cache.get(sessionId)

    if (!forceRefresh && cached) {
      // 检查缓存是否有效
      if (this.isCacheValid(cached)) {
        console.log(`[DOMContext] Using cached DOM (v${cached.state.version})`)
        return cached.state
      }
    }

    // 获取新鲜 DOM
    const fresh = await this.fetchFreshDOM(sessionId)
    this.cache.set(sessionId, {
      state: fresh,
      lastAction: cached?.lastAction
    })

    return fresh
  }

  /**
   * 标记缓存失效（在状态改变动作后调用）
   */
  invalidate(sessionId: string, action?: ActionInfo): void {
    const cached = this.cache.get(sessionId)
    if (cached) {
      cached.lastAction = action
      // 不立即删除，下次 getCurrentState 时会判断
    }
  }

  /**
   * 判断缓存是否有效
   */
  private isCacheValid(entry: DOMCacheEntry): boolean {
    const { state, lastAction } = entry

    // 1. 超时检查（5秒）
    if (Date.now() - state.timestamp > 5000) {
      console.log('[DOMContext] Cache expired (>5s)')
      return false
    }

    // 2. 根据最后动作类型判断
    if (lastAction) {
      const timeSinceAction = Date.now() - lastAction.timestamp

      // 导航后必须刷新
      if (lastAction.type === 'navigate' && timeSinceAction < 1000) {
        console.log('[DOMContext] Navigation detected, needs refresh')
        return false
      }

      // 点击后检查是否可能改变 DOM
      if (lastAction.type === 'click' && timeSinceAction < 500) {
        // 保守策略：点击后短暂认为缓存无效
        return false
      }
    }

    return true
  }

  /**
   * 获取最新 DOM
   */
  private async fetchFreshDOM(sessionId: string): Promise<DOMState> {
    console.log(`[DOMContext] Fetching fresh DOM for ${sessionId}`)

    if (!this.wsClient?.isAlive) {
      throw new Error('WebSocket not connected')
    }

    const response = await this.sendWebSocketRequest({
      toolCall: {
        id: this.generateId(),
        name: 'browser_get_context',
        arguments: {}
      },
      timeout: 30000
    })

    if (!response.success || !response.data) {
      throw new Error(`Failed to fetch DOM: ${response.error}`)
    }

    const data = response.data
    const currentVersion = this.cache.get(sessionId)?.state.version ?? 0

    return {
      url: data.url,
      title: data.title,
      elements: data.elements || [],
      timestamp: Date.now(),
      version: currentVersion + 1,
      sessionId
    }
  }

  /**
   * 增量更新 DOM（用于局部变化，如弹窗）
   */
  async incrementalUpdate(
    sessionId: string,
    changes: DOMChange[]
  ): Promise<DOMState> {
    const entry = this.cache.get(sessionId)
    if (!entry) {
      return this.fetchFreshDOM(sessionId)
    }

    const state = entry.state

    // 应用变化
    for (const change of changes) {
      this.applyChange(state, change)
    }

    state.version++
    state.timestamp = Date.now()

    console.log(`[DOMContext] Incremental update to v${state.version}`)
    return state
  }

  /**
   * 应用单个变化
   */
  private applyChange(state: DOMState, change: DOMChange): void {
    const { elements } = state

    switch (change.type) {
      case 'added':
        // 分配新 ref
        const newRef = Math.max(...elements.map(e => e.ref), 0) + 1
        elements.push({ ...change.element, ref: newRef })
        break

      case 'removed':
        const removeIdx = elements.findIndex(e => e.ref === change.element.ref)
        if (removeIdx >= 0) {
          elements.splice(removeIdx, 1)
        }
        break

      case 'modified':
        const modifyIdx = elements.findIndex(e => e.ref === change.element.ref)
        if (modifyIdx >= 0) {
          elements[modifyIdx] = { ...elements[modifyIdx], ...change.element }
        }
        break
    }
  }

  /**
   * 检测特定元素是否存在（用于弹窗检测）
   */
  async detectElement(
    sessionId: string,
    selector: string
  ): Promise<boolean> {
    // 简化为获取完整 DOM 后检查
    // 后续可优化为客户端直接检测
    const state = await this.getCurrentState(sessionId)
    // 这里可以通过元素的 role/name 等属性模拟检测
    return state.elements.some(el =>
      el.role === 'dialog' ||
      el.role === 'alertdialog'
    )
  }

  /**
   * 清理会话缓存
   */
  cleanup(sessionId: string): void {
    this.cache.delete(sessionId)
  }

  /**
   * WebSocket 请求
   */
  private async sendWebSocketRequest(request: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const requestId = this.generateId()
      const timeout = setTimeout(() => {
        reject(new Error('DOM fetch timeout'))
      }, request.timeout || 30000)

      const handleMessage = (data: any) => {
        try {
          const message = JSON.parse(data.toString())
          if (message.type === 'tool.result' && message.messageId === requestId) {
            clearTimeout(timeout)
            this.wsClient?.socket.removeListener('message', handleMessage)
            resolve({
              success: message.payload?.success,
              data: message.payload?.data,
              error: message.payload?.error
            })
          }
        } catch {
          // ignore
        }
      }

      this.wsClient?.socket.on('message', handleMessage)
      this.wsClient?.socket.send(JSON.stringify({
        type: 'tool.execute',
        messageId: requestId,
        timestamp: Date.now(),
        sessionId: request.toolCall.sessionId,
        payload: {
          toolCall: request.toolCall,
          timeout: request.timeout
        }
      }))
    })
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}

// 导出单例
export const domContextManager = new DOMContextManager()
