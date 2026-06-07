/**
 * MCP Hub
 * 统一管理 MCP Client 连接和工具注册
 *
 * 架构（WebSocket 桥接）：
 * - Server (云端) <--WebSocket--> Client (本地) <--stdio--> MCP Server
 * - 每个用户/会话有独立的 MCP 状态
 */

import { toolRegistry } from './registry.js'
import { log } from '@auto-agent/shared-utils'
import type { WSConnection } from '../../types/index.js'

export interface MCPServerConfig {
  name: string
  transport: 'stdio' | 'sse' | 'websocket'
  // stdio/sse 配置（用于外部 MCP Server）
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

interface PendingRequest {
  resolve: (value: any) => void
  reject: (reason: Error) => void
  timeout: NodeJS.Timeout
}

interface SessionMCPState {
  sessionId: string
  userId: string
  wsClient: WSConnection | null
  connected: boolean
  pendingRequests: Map<string, PendingRequest>
}

export class MCPHub {
  // 按会话隔离的 MCP 状态
  private sessionStates: Map<string, SessionMCPState> = new Map()

  /**
   * 获取或创建会话的 MCP 状态
   */
  private getOrCreateSessionState(sessionId: string, userId: string): SessionMCPState {
    let state = this.sessionStates.get(sessionId)
    if (!state) {
      state = {
        sessionId,
        userId,
        wsClient: null,
        connected: false,
        pendingRequests: new Map()
      }
      this.sessionStates.set(sessionId, state)
    }
    return state
  }

  /**
   * 绑定 WebSocket 客户端（从 WebSocketServer 传入）
   */
  bindWebSocket(sessionId: string, userId: string, wsClient: WSConnection): void {
    const state = this.getOrCreateSessionState(sessionId, userId)
    state.wsClient = wsClient
    state.connected = wsClient.isAlive
    state.userId = userId

    log.info('MCPHub', `WebSocket bound for session: ${sessionId}, user: ${userId}`)
  }

  /**
   * 为会话初始化 MCP
   */
  async initializeForSession(sessionId: string, userId: string): Promise<void> {
    log.info('MCPHub', `Initializing MCP for session: ${sessionId}, user: ${userId}`)

    const state = this.getOrCreateSessionState(sessionId, userId)

    if (!state.wsClient || !state.wsClient.isAlive) {
      throw new Error(`WebSocket not connected for session: ${sessionId}`)
    }

    // 获取工具列表
    const tools = await this.listTools(sessionId, userId)

    // 注册工具（带会话前缀）
    for (const tool of tools) {
      const sessionToolName = `${sessionId}.${tool.name}`
      toolRegistry.registerMCP(`${sessionId}.local-tools`, {
        ...tool,
        name: sessionToolName
      })
    }

    log.info('MCPHub', `MCP initialized for session: ${sessionId}, registered ${tools.length} tools`)
  }

  /**
   * 获取工具列表
   */
  async listTools(sessionId: string, userId: string): Promise<any[]> {
    const state = this.getOrCreateSessionState(sessionId, userId)

    if (!state.wsClient || !state.wsClient.isAlive) {
      throw new Error(`WebSocket not connected for session: ${sessionId}`)
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    return new Promise((resolve, reject) => {
      // 设置超时
      const timeout = setTimeout(() => {
        state.pendingRequests.delete(requestId)
        reject(new Error('listTools timeout'))
      }, 10000)

      // 存储 pending 请求
      state.pendingRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeout)
          // 处理两种可能的格式: { tools: [...] } 或 { result: { tools: [...] } }
          const tools = result?.tools || result?.result?.tools || []
          resolve(tools)
        },
        reject: (error) => {
          clearTimeout(timeout)
          reject(error)
        },
        timeout
      })

      // 发送请求给 Client
      state.wsClient!.socket.send(JSON.stringify({
        type: 'mcp.listTools',
        messageId: requestId,
        sessionId,
        timestamp: Date.now()
      }))
    })
  }

  /**
   * 调用工具
   */
  async callTool(
    sessionId: string,
    userId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<any> {
    const state = this.getOrCreateSessionState(sessionId, userId)

    if (!state.wsClient || !state.wsClient.isAlive) {
      throw new Error(`WebSocket not connected for session: ${sessionId}`)
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // 去掉会话前缀，获取原始工具名
    const originalToolName = toolName.replace(`${sessionId}.`, '')

    log.info('MCPHub', `Calling tool: ${originalToolName} for session: ${sessionId}`, args)

    return new Promise((resolve, reject) => {
      // 设置超时（根据工具类型调整）
      const timeoutMs = this.getToolTimeout(originalToolName)
      const timeout = setTimeout(() => {
        state.pendingRequests.delete(requestId)
        reject(new Error(`callTool timeout: ${originalToolName}`))
      }, timeoutMs)

      // 存储 pending 请求
      state.pendingRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeout)
          resolve(result)
        },
        reject: (error) => {
          clearTimeout(timeout)
          reject(error)
        },
        timeout
      })

      // 发送请求给 Client
      state.wsClient!.socket.send(JSON.stringify({
        type: 'mcp.callTool',
        messageId: requestId,
        sessionId,
        timestamp: Date.now(),
        payload: {
          name: originalToolName,
          arguments: args
        }
      }))
    })
  }

  /**
   * 处理 MCP 响应（从 Client 返回）
   */
  handleResponse(sessionId: string, messageId: string, result: any): void {
    const state = this.sessionStates.get(sessionId)
    if (!state) {
      log.warn('MCPHub', `No session state found for: ${sessionId}`)
      return
    }

    const pending = state.pendingRequests.get(messageId)
    if (pending) {
      pending.resolve(result)
      state.pendingRequests.delete(messageId)
    } else {
      log.warn('MCPHub', `No pending request found for: ${messageId}`)
    }
  }

  /**
   * 处理 MCP 错误（从 Client 返回）
   */
  handleError(sessionId: string, messageId: string, error: string): void {
    const state = this.sessionStates.get(sessionId)
    if (!state) {
      log.warn('MCPHub', `No session state found for: ${sessionId}`)
      return
    }

    const pending = state.pendingRequests.get(messageId)
    if (pending) {
      pending.reject(new Error(error))
      state.pendingRequests.delete(messageId)
    } else {
      log.warn('MCPHub', `No pending request found for: ${messageId}`)
    }
  }

  /**
   * 清理会话的 MCP 状态
   */
  async cleanupSession(sessionId: string): Promise<void> {
    const state = this.sessionStates.get(sessionId)
    if (!state) return

    log.info('MCPHub', `Cleaning up MCP for session: ${sessionId}`)

    // 拒绝所有 pending 请求
    for (const [id, pending] of state.pendingRequests) {
      pending.reject(new Error('Session closed'))
      clearTimeout(pending.timeout)
    }
    state.pendingRequests.clear()

    // 注销该会话的工具
    toolRegistry.unregisterMCPServer(`${sessionId}.local-tools`)

    // 删除会话状态
    this.sessionStates.delete(sessionId)

    log.info('MCPHub', `MCP cleaned up for session: ${sessionId}`)
  }

  /**
   * 获取工具超时时间
   */
  private getToolTimeout(toolName: string): number {
    const timeouts: Record<string, number> = {
      'browser_navigate': 30000,
      'browser_click': 10000,
      'browser_type': 10000,
      'browser_scroll': 10000,
      'browser_screenshot': 15000,
      'browser_get_context': 20000,
      'bash': 30000,
      'file_read': 5000,
      'file_write': 5000
    }
    return timeouts[toolName] || 30000
  }

  /**
   * 获取会话状态
   */
  getStatus(sessionId: string) {
    const state = this.sessionStates.get(sessionId)
    if (!state) {
      return {
        connected: false,
        pendingRequests: 0
      }
    }

    return {
      connected: state.connected && state.wsClient?.isAlive,
      pendingRequests: state.pendingRequests.size
    }
  }

  /**
   * 获取所有会话状态
   */
  getAllStatus() {
    const result: Record<string, ReturnType<typeof this.getStatus>> = {}
    for (const sessionId of this.sessionStates.keys()) {
      result[sessionId] = this.getStatus(sessionId)
    }
    return result
  }
}

// 全局单例
export const mcpHub = new MCPHub()
