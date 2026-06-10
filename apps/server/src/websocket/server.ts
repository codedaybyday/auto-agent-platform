/**
 * WebSocket 服务器
 * 处理客户端连接、消息路由、跨实例通信
 */

import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'http'
import type { WSConnection, WSMessage, MessageType } from '../types/index.js'
import { SessionManager } from '../services/agent/session.js'
import { EventBus } from './event-bus.js'
import { RateLimiter } from '../services/rate-limiter.js'
import { mcpHub } from '../services/mcp/hub.js'
import { log } from '@auto-agent/shared-utils'

export class WebSocketGateway {
  private wss: WebSocketServer
  private connections = new Map<string, WSConnection>()
  private userConnections = new Map<string, Set<string>>()
  private sessionManager: SessionManager
  private instanceId: string
  // 中央事件总线
  private eventBus: EventBus
  // 限流器
  private rateLimiter: RateLimiter

  constructor(server: Server, sessionManager: SessionManager, instanceId: string, rateLimiter: RateLimiter) {
    this.sessionManager = sessionManager
    this.instanceId = instanceId
    this.rateLimiter = rateLimiter

    // 初始化事件总线
    this.eventBus = new EventBus(sessionManager)
    this.setupEventBusHandler()

    this.wss = new WebSocketServer({
      server,
      path: '/ws',
      // 每 30 秒心跳检测
      clientTracking: true
    })

    this.setupServer()
    this.startHeartbeat()
  }

  /**
   * 设置事件总线处理器
   */
  private setupEventBusHandler(): void {
    this.eventBus.setMessageHandler((event) => {
      const { sessionId, type, data } = event

      // 查找该会话属于哪个用户
      const userId = this.eventBus['sessionUserMap'].get(sessionId)
      if (!userId) return

      // 根据事件类型构造消息
      let message: WSMessage

      switch (type) {
        case 'stream_chunk':
          message = {
            type: 'stream.chunk' as MessageType,
            messageId: this.generateId(),
            timestamp: Date.now(),
            sessionId,
            payload: data
          }
          break
        case 'stream_complete':
          message = {
            type: 'stream.complete' as MessageType,
            messageId: this.generateId(),
            timestamp: Date.now(),
            sessionId,
            payload: data
          }
          break
        case 'stream_error':
          message = {
            type: 'stream.error' as MessageType,
            messageId: this.generateId(),
            timestamp: Date.now(),
            sessionId,
            payload: { error: data.error?.message || 'Unknown error' }
          }
          break
        case 'tool_start':
          message = {
            type: 'state.update' as MessageType,
            messageId: this.generateId(),
            timestamp: Date.now(),
            sessionId,
            payload: {
              type: 'tool_start',
              toolCall: data.toolCall
            }
          }
          break
        case 'tool_end':
          message = {
            type: 'state.update' as MessageType,
            messageId: this.generateId(),
            timestamp: Date.now(),
            sessionId,
            payload: {
              type: 'tool_end',
              toolCall: data.toolCall,
              result: data.result
            }
          }
          break
        default:
          return
      }

      // 推送给该用户的所有连接
      this.sendToUser(userId, message)
    })
  }

  private setupServer(): void {
    this.wss.on('connection', (socket: WebSocket, req: any) => {
      log.info('WebSocket', `New connection from ${req.socket.remoteAddress}`)

      // 等待客户端发送认证信息
      const authTimeout = setTimeout(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.close(4001, 'Authentication timeout')
        }
      }, 10000)

      // 临时存储，等待认证
      let tempConnection: Partial<WSConnection> = {
        socket,
        connectedAt: new Date(),
        lastPingAt: new Date(),
        isAlive: true,
        subscriptions: new Set()
      }

      socket.on('message', (data: Buffer) => {
        try {
          const message: WSMessage = JSON.parse(data.toString())

          // 第一个消息必须是认证
          if (message.type === 'connect') {
            clearTimeout(authTimeout)
            this.handleAuth(tempConnection, message)
          } else if (tempConnection.id) {
            // 已认证，处理消息
            this.handleMessage(tempConnection as WSConnection, message)
          } else {
            socket.close(4002, 'Not authenticated')
          }
        } catch (error) {
          log.error('WebSocket', 'Invalid message', error)
          socket.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Invalid message format' }
          }))
        }
      })

      socket.on('close', () => {
        clearTimeout(authTimeout)
        if (tempConnection.id) {
          this.removeConnection(tempConnection.id)
        }
      })

      socket.on('error', (error) => {
        log.error('WebSocket', 'Socket error', error)
      })

      socket.on('pong', () => {
        if (tempConnection.id) {
          const conn = this.connections.get(tempConnection.id)
          if (conn) {
            conn.isAlive = true
            conn.lastPingAt = new Date()
          }
        }
      })
    })
  }

  /**
   * 处理认证
   */
  private handleAuth(tempConnection: Partial<WSConnection>, message: WSMessage): void {
    const { userId, authToken } = message.payload || {}

    // TODO: 验证 authToken
    // 简化版：直接信任客户端提供的 userId
    if (!userId) {
      tempConnection.socket!.close(4003, 'Missing userId')
      return
    }

    const connectionId = this.generateId()
    const conn: WSConnection = {
      id: connectionId,
      userId,
      socket: tempConnection.socket!,
      connectedAt: new Date(),
      lastPingAt: new Date(),
      isAlive: true,
      subscriptions: new Set()
    }

    // 更新 tempConnection，使后续消息处理能识别已认证状态
    Object.assign(tempConnection, conn)

    this.connections.set(connectionId, conn)

    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set())
    }
    this.userConnections.get(userId)!.add(connectionId)

    // 发送认证成功响应
    this.sendToConnection(connectionId, {
      type: 'connect_ack' as MessageType,
      messageId: this.generateId(),
      timestamp: Date.now(),
      payload: {
        connectionId,
        instanceId: this.instanceId
      }
    })

    // 注册连接到事件总线
    this.eventBus.registerConnection(userId, connectionId, tempConnection.socket!)

    // 注册用户的所有会话到事件总线
    const sessions = this.sessionManager.getUserSessions(userId)
    for (const session of sessions) {
      this.eventBus.registerSession(session.id, userId)
      // 绑定 AgentLoop 事件
      const agentLoop = this.sessionManager.getAgentLoop(session.id)
      if (agentLoop) {
        this.eventBus.bindAgentLoop(agentLoop, session.id)
      }
      // 绑定 WebSocket 到 MCPHub（用于该会话的 MCP 工具调用）
      mcpHub.bindWebSocket(session.id, userId, conn)
    }

    log.success('WebSocket', `User ${userId} authenticated, connection ${connectionId}, registered ${sessions.length} sessions`)
  }

  /**
   * 处理业务消息
   */
  private async handleMessage(connection: WSConnection, message: WSMessage): Promise<void> {
    log.debug('WebSocket', `Received ${message.type}`, { userId: connection.userId })

    try {
      switch (message.type) {
        case 'session.create':
          await this.handleSessionCreate(connection, message)
          break

        // session.list / switch / delete / rename / messages.get
        // 已改用 HTTP API，不再通过 WebSocket 处理

        // case 'session.list':
        //   await this.handleSessionList(connection, message)
        //   break

        case 'agent.run':
          await this.handleAgentRun(connection, message)
          break

        case 'agent.pause':
          await this.handleAgentPause(connection, message)
          break

        case 'agent.stop':
          await this.handleAgentStop(connection, message)
          break

        case 'tool.result':
          await this.handleToolResult(connection, message)
          break

        case 'tool.error':
          await this.handleToolError(connection, message)
          break

        case 'mcp.response':
          this.handleMCPResponse(connection, message)
          break

        case 'mcp.error':
          this.handleMCPError(connection, message)
          break

        case 'ping':
          this.sendToConnection(connection.id, {
            type: 'pong' as MessageType,
            messageId: this.generateId(),
            timestamp: Date.now()
          })
          break

        default:
          log.warn('WebSocket', `Unknown message type: ${message.type}`)
      }
    } catch (error) {
      log.error('WebSocket', 'Error handling message', error)
      this.sendToConnection(connection.id, {
        type: 'error' as MessageType,
        messageId: this.generateId(),
        timestamp: Date.now(),
        payload: {
          originalMessageId: message.messageId,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      })
    }
  }

  /**
   * 创建会话
   */
  private async handleSessionCreate(connection: WSConnection, message: WSMessage): Promise<void> {
    // 根因：HTTP 创建会话后，WebSocket 消息又创建了新会话，导致 WebSocket 绑定错误
    // 修复：如果 payload 中有 sessionId，使用已存在的会话；否则创建新会话
    const existingSessionId = message.payload?.sessionId
    let session: any

    if (existingSessionId) {
      session = this.sessionManager.getSession(existingSessionId)
      if (!session) {
        throw new Error(`Session not found: ${existingSessionId}`)
      }
      console.log(`[WebSocket] Using existing session: ${existingSessionId}`)
    } else {
      session = await this.sessionManager.createSession(connection.userId, message.payload?.title)
      console.log(`[WebSocket] Created new session: ${session.id}`)
    }

    // 注册新会话到事件总线
    this.eventBus.registerSession(session.id, connection.userId)

    // 绑定 AgentLoop 事件（如果 AgentLoop 已创建）
    const agentLoop = this.sessionManager.getAgentLoop(session.id)
    if (agentLoop) {
      this.eventBus.bindAgentLoop(agentLoop, session.id)
    }

    // 绑定 WebSocket 到 MCPHub（用于该会话的 MCP 工具调用）
    mcpHub.bindWebSocket(session.id, connection.userId, connection)

    this.sendToConnection(connection.id, {
      type: 'session.create_ack' as MessageType,
      messageId: this.generateId(),
      timestamp: Date.now(),
      sessionId: session.id,
      payload: { session }
    })
  }

  /**
   * 获取会话列表
   */
  // private async handleSessionList(connection: WSConnection, message: WSMessage): Promise<void> {
  //   const sessions = this.sessionManager.getUserSessions(connection.userId)

  //   this.sendToConnection(connection.id, {
  //     type: 'state.sync' as MessageType,
  //     messageId: this.generateId(),
  //     timestamp: Date.now(),
  //     payload: { sessions }
  //   })
  // }

  /**
   * 运行 Agent
   */
  private async handleAgentRun(connection: WSConnection, message: WSMessage): Promise<void> {
    const sessionId = message.sessionId || message.payload?.sessionId
    const { content } = message.payload || {}

    if (!content) {
      throw new Error('Missing content')
    }

    // 1. 检查用户级HTTP限流
    const userCheck = this.rateLimiter.checkHttpRequest(connection.userId)
    if (!userCheck.allowed) {
      this.sendToConnection(connection.id, {
        type: 'stream.error' as import('../types/index.js').MessageType,
        messageId: this.generateId(),
        timestamp: Date.now(),
        payload: {
          error: `请求过于频繁，请 ${userCheck.retryAfter} 秒后再试`,
          retryAfter: userCheck.retryAfter
        }
      })
      return
    }

    // 2. 检查会话级消息限流
    const targetSessionId = sessionId || 'new'
    const sessionCheck = this.rateLimiter.checkSessionMessage(targetSessionId)
    if (!sessionCheck.allowed) {
      this.sendToConnection(connection.id, {
        type: 'stream.error' as import('../types/index.js').MessageType,
        messageId: this.generateId(),
        timestamp: Date.now(),
        payload: {
          error: `该会话请求过于频繁，请 ${sessionCheck.retryAfter} 秒后再试`,
          retryAfter: sessionCheck.retryAfter
        }
      })
      return
    }

    const { agentLoop, session } = await this.sessionManager.getOrCreateSession(connection.userId, sessionId)

    // 绑定 WebSocket 用于工具调用（双向通信）
    agentLoop.bindWebSocket(connection)

    // 订阅会话消息
    if (sessionId) {
      connection.subscriptions.add(sessionId)
    }

    // 注册会话到事件总线
    if (session) {
      this.eventBus.registerSession(session.id, connection.userId)
    }

    // 绑定 AgentLoop 事件到事件总线（幂等，多次调用不会重复绑定）
    if (sessionId) {
      this.eventBus.bindAgentLoop(agentLoop, sessionId)
    }

    // 启动 Agent Loop
    agentLoop.run(content).catch(error => {
      log.error('WebSocket', 'Agent loop error', error)
    })
  }

  /**
   * 暂停 Agent
   */
  private async handleAgentPause(connection: WSConnection, message: WSMessage): Promise<void> {
    const sessionId = message.sessionId || message.payload?.sessionId
    const agentLoop = this.sessionManager.getAgentLoop(sessionId)

    if (agentLoop) {
      agentLoop.pause()
    }
  }

  /**
   * 停止 Agent
   */
  private async handleAgentStop(connection: WSConnection, message: WSMessage): Promise<void> {
    const sessionId = message.sessionId || message.payload?.sessionId
    const agentLoop = this.sessionManager.getAgentLoop(sessionId)

    if (agentLoop) {
      agentLoop.stop()
    }
  }

  /**
   * 处理工具执行结果（客户端返回）
   */
  private async handleToolResult(connection: WSConnection, message: WSMessage): Promise<void> {
    const { toolCallId, success, data, error, metadata, executionTime } = message.payload || {}
    const { sessionId, messageId } = message

    if (!sessionId) return

    const agentLoop = this.sessionManager.getAgentLoop(sessionId)
    if (!agentLoop) return

    // 构建 ToolResult 并传递给 ToolBridge
    const toolResult: import('../types/index.js').ToolResult = {
      toolCallId: toolCallId || messageId,
      success: success ?? false,
      data,
      error,
      executionTime: executionTime || 0,
      metadata
    }

    // 通过 AgentLoop 的 ToolBridge 处理结果
    // 使用 messageId 作为 requestId 匹配
    const toolBridge = (agentLoop as any).toolBridge
    if (toolBridge && toolBridge.handleToolResult) {
      toolBridge.handleToolResult(messageId, toolResult)
      log.debug('WebSocket', `Tool result passed to AgentLoop`, { sessionId })
    } else {
      log.warn('WebSocket', `ToolBridge not found for session ${sessionId}`)
    }
  }

  private async handleToolError(connection: WSConnection, message: WSMessage): Promise<void> {
    const { toolCallId, error } = message.payload || {}
    const { sessionId, messageId } = message

    if (!sessionId) return

    const agentLoop = this.sessionManager.getAgentLoop(sessionId)
    if (!agentLoop) return

    // 传递错误给 ToolBridge
    const toolBridge = (agentLoop as any).toolBridge
    if (toolBridge && toolBridge.handleToolError) {
      toolBridge.handleToolError(messageId, error || 'Unknown error')
      log.debug('WebSocket', `Tool error passed to AgentLoop`, { sessionId })
    } else {
      log.warn('WebSocket', `ToolBridge not found for session ${sessionId}`)
    }
  }

  /**
   * 处理 MCP 响应（Client 返回的 MCP 工具执行结果）
   */
  private handleMCPResponse(connection: WSConnection, message: WSMessage): void {
    const { sessionId, messageId, payload } = message

    if (!sessionId || !messageId) {
      log.warn('WebSocket', 'MCP response missing sessionId or messageId')
      return
    }

    // 转发给 MCPHub 处理
    mcpHub.handleResponse(sessionId, messageId, payload?.result)
    log.debug('WebSocket', `MCP response forwarded to MCPHub`, { sessionId, messageId })
  }

  /**
   * 处理 MCP 错误（Client 返回的 MCP 工具执行错误）
   */
  private handleMCPError(connection: WSConnection, message: WSMessage): void {
    const { sessionId, messageId, payload } = message

    if (!sessionId || !messageId) {
      log.warn('WebSocket', 'MCP error missing sessionId or messageId')
      return
    }

    // 转发给 MCPHub 处理
    mcpHub.handleError(sessionId, messageId, payload?.error || 'Unknown MCP error')
    log.debug('WebSocket', `MCP error forwarded to MCPHub`, { sessionId, messageId })
  }

  /**
   * 发送消息到指定连接
   */
  sendToConnection(connectionId: string, message: WSMessage): void {
    const conn = this.connections.get(connectionId)
    if (conn && conn.socket.readyState === WebSocket.OPEN) {
      conn.socket.send(JSON.stringify(message))
    }
  }

  /**
   * 发送消息到用户的所有连接
   */
  sendToUser(userId: string, message: WSMessage): void {
    const connectionIds = this.userConnections.get(userId)
    log.debug('WebSocket', `Sending ${message.type} to user`, { userId, connections: connectionIds?.size || 0 })
    if (connectionIds) {
      for (const connId of connectionIds) {
        this.sendToConnection(connId, message)
      }
    }
  }

  /**
   * 移除连接
   */
  private removeConnection(connectionId: string): void {
    const conn = this.connections.get(connectionId)
    if (conn) {
      // 从事件总线注销连接
      this.eventBus.unregisterConnection(conn.userId, connectionId)
      this.userConnections.get(conn.userId)?.delete(connectionId)
      this.connections.delete(connectionId)

      // 清理该用户所有会话的 MCP 状态
      const sessions = this.sessionManager.getUserSessions(conn.userId)
      for (const session of sessions) {
        mcpHub.cleanupSession(session.id).catch(err => {
          log.warn('WebSocket', `Failed to cleanup MCP for session ${session.id}`, err)
        })
      }

      log.info('WebSocket', `Connection ${connectionId} removed`)
    }
  }

  /**
   * 心跳检测
   */
  private startHeartbeat(): void {
    const interval = setInterval(() => {
      for (const [connId, conn] of this.connections) {
        if (!conn.isAlive) {
          conn.socket.terminate()
          this.removeConnection(connId)
          continue
        }

        conn.isAlive = false
        conn.socket.ping()
      }
    }, 30000)

    process.on('SIGTERM', () => clearInterval(interval))
  }

  /**
   * 获取统计信息
   */
  getStats(): { totalConnections: number; totalUsers: number } {
    return {
      totalConnections: this.connections.size,
      totalUsers: this.userConnections.size
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}
