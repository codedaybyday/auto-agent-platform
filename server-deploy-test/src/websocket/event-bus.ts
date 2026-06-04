/**
 * 中央事件总线
 * 负责接收所有 AgentLoop 事件，并路由到对应的用户连接
 */

import type { AgentLoop } from '../services/agent/loop.js'
import type { SessionManager } from '../services/agent/session.js'

export interface AgentEvent {
  sessionId: string
  type: 'stream_chunk' | 'stream_complete' | 'stream_error' | 'tool_start' | 'tool_end'
  data: any
}

export type MessageHandler = (event: AgentEvent) => void

export class EventBus {
  // 会话 -> 用户 的路由表
  private sessionUserMap = new Map<string, string>()

  // 用户 -> 连接 的映射
  private userConnections = new Map<string, Set<string>>()

  // 连接 -> socket 的映射
  private connections = new Map<string, WebSocket>()

  // 已绑定监听器的会话（防止重复绑定）
  private boundSessions = new Set<string>()

  // 消息处理器（由 WebSocketGateway 设置）
  private messageHandler: MessageHandler | null = null

  constructor(private sessionManager: SessionManager) {}

  /**
   * 设置消息处理器
   */
  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler
  }

  /**
   * 注册会话到路由表
   * 新建会话时调用
   */
  registerSession(sessionId: string, userId: string): void {
    this.sessionUserMap.set(sessionId, userId)
    console.log(`[EventBus] Registered session ${sessionId} for user ${userId}`)
  }

  /**
   * 注销会话
   */
  unregisterSession(sessionId: string): void {
    this.sessionUserMap.delete(sessionId)
    this.boundSessions.delete(sessionId)
    console.log(`[EventBus] Unregistered session ${sessionId}`)
  }

  /**
   * 注册用户连接
   */
  registerConnection(userId: string, connectionId: string, socket: WebSocket): void {
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set())
    }
    this.userConnections.get(userId)!.add(connectionId)
    this.connections.set(connectionId, socket)
    console.log(`[EventBus] Registered connection ${connectionId} for user ${userId}`)
  }

  /**
   * 注销用户连接
   */
  unregisterConnection(userId: string, connectionId: string): void {
    this.userConnections.get(userId)?.delete(connectionId)
    this.connections.delete(connectionId)
    console.log(`[EventBus] Unregistered connection ${connectionId}`)
  }

  /**
   * 获取用户的所有连接
   */
  getUserConnections(userId: string): Set<string> | undefined {
    return this.userConnections.get(userId)
  }

  /**
   * 获取连接对应的 socket
   */
  getConnectionSocket(connectionId: string): WebSocket | undefined {
    return this.connections.get(connectionId)
  }

  /**
   * 绑定 AgentLoop 事件到 EventBus
   * 在 SessionManager 创建 AgentLoop 时调用
   */
  bindAgentLoop(agentLoop: AgentLoop, sessionId: string): void {
    // 检查是否已经绑定过，防止重复绑定
    if (this.boundSessions.has(sessionId)) {
      console.log(`[EventBus] Session ${sessionId} already bound, skipping`)
      return
    }

    // 获取会话信息以确定用户
    const session = this.sessionManager.getSession(sessionId)
    if (!session) {
      console.error(`[EventBus] Cannot bind AgentLoop: session ${sessionId} not found`)
      return
    }

    const userId = session.userId

    // 确保会话已注册
    this.registerSession(sessionId, userId)

    // 标记为已绑定
    this.boundSessions.add(sessionId)

    // 绑定各种事件
    agentLoop.on('stream_chunk', (data) => {
      this.handleAgentEvent({
        sessionId,
        type: 'stream_chunk',
        data
      })
    })

    agentLoop.on('run_complete', (data) => {
      this.handleAgentEvent({
        sessionId,
        type: 'stream_complete',
        data
      })
    })

    agentLoop.on('run_error', (data) => {
      this.handleAgentEvent({
        sessionId,
        type: 'stream_error',
        data
      })
    })

    agentLoop.on('tool_start', (data) => {
      this.handleAgentEvent({
        sessionId,
        type: 'tool_start',
        data
      })
    })

    agentLoop.on('tool_end', (data) => {
      this.handleAgentEvent({
        sessionId,
        type: 'tool_end',
        data
      })
    })

    console.log(`[EventBus] Bound AgentLoop for session ${sessionId}`)
  }

  /**
   * 处理 AgentLoop 事件
   */
  private handleAgentEvent(event: AgentEvent): void {
    const { sessionId, type } = event

    // 查找该会话属于哪个用户
    const userId = this.sessionUserMap.get(sessionId)
    if (!userId) {
      console.warn(`[EventBus] No user found for session ${sessionId}`)
      return
    }

    console.log(`[EventBus] Handling event: ${type} for session ${sessionId}, user ${userId}`)

    // 调用消息处理器（由 WebSocketGateway 实现）
    if (this.messageHandler) {
      this.messageHandler(event)
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    sessions: number
    users: number
    connections: number
  } {
    return {
      sessions: this.sessionUserMap.size,
      users: this.userConnections.size,
      connections: this.connections.size
    }
  }
}
