/**
 * WebSocket 服务器
 * 处理客户端连接、消息路由、跨实例通信
 */

import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'http'
import type { WSConnection, WSMessage, MessageType } from '../types/index.js'
import { SessionManager } from '../services/session-manager.js'

export class WebSocketGateway {
  private wss: WebSocketServer
  private connections = new Map<string, WSConnection>()
  private userConnections = new Map<string, Set<string>>()
  private sessionManager: SessionManager
  private instanceId: string

  constructor(server: Server, sessionManager: SessionManager, instanceId: string) {
    this.sessionManager = sessionManager
    this.instanceId = instanceId

    this.wss = new WebSocketServer({
      server,
      path: '/ws',
      // 每 30 秒心跳检测
      clientTracking: true
    })

    this.setupServer()
    this.startHeartbeat()
  }

  private setupServer(): void {
    this.wss.on('connection', (socket: WebSocket, req: any) => {
      console.log('[WebSocket] New connection from', req.socket.remoteAddress)

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
          console.error('[WebSocket] Invalid message:', error)
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
        console.error('[WebSocket] Socket error:', error)
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

    console.log(`[WebSocket] User ${userId} authenticated, connection ${connectionId}`)
  }

  /**
   * 处理业务消息
   */
  private async handleMessage(connection: WSConnection, message: WSMessage): Promise<void> {
    console.log(`[WebSocket] Received ${message.type} from ${connection.userId}`)

    try {
      switch (message.type) {
        case 'session.create':
          await this.handleSessionCreate(connection, message)
          break

        case 'session.list':
          await this.handleSessionList(connection, message)
          break

        case 'session.switch':
          await this.handleSessionSwitch(connection, message)
          break

        case 'session.delete':
          await this.handleSessionDelete(connection, message)
          break

        case 'session.rename':
          await this.handleSessionRename(connection, message)
          break

        case 'session.messages.get':
          await this.handleSessionMessagesGet(connection, message)
          break

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

        case 'ping':
          this.sendToConnection(connection.id, {
            type: 'pong' as MessageType,
            messageId: this.generateId(),
            timestamp: Date.now()
          })
          break

        default:
          console.log(`[WebSocket] Unknown message type: ${message.type}`)
      }
    } catch (error) {
      console.error('[WebSocket] Error handling message:', error)
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
    const session = await this.sessionManager.createSession(connection.userId, message.payload?.title)

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
  private async handleSessionList(connection: WSConnection, message: WSMessage): Promise<void> {
    const sessions = this.sessionManager.getUserSessions(connection.userId)

    this.sendToConnection(connection.id, {
      type: 'state.sync' as MessageType,
      messageId: this.generateId(),
      timestamp: Date.now(),
      payload: { sessions }
    })
  }

  /**
   * 运行 Agent
   */
  private async handleAgentRun(connection: WSConnection, message: WSMessage): Promise<void> {
    const sessionId = message.sessionId || message.payload?.sessionId
    const { content } = message.payload || {}

    if (!content) {
      throw new Error('Missing content')
    }

    const { agentLoop } = await this.sessionManager.getOrCreateSession(connection.userId, sessionId)

    // 绑定 WebSocket 用于工具调用
    agentLoop.bindWebSocket(connection)

    // 订阅会话消息
    if (sessionId) {
      connection.subscriptions.add(sessionId)
    }

    // 清除旧的事件监听，避免重复绑定
    agentLoop.removeAllListeners('stream_chunk')
    agentLoop.removeAllListeners('tool_start')
    agentLoop.removeAllListeners('tool_end')
    agentLoop.removeAllListeners('run_complete')
    agentLoop.removeAllListeners('run_error')

    // 设置事件监听
    agentLoop.on('stream_chunk', (data) => {
      this.sendToConnection(connection.id, {
        type: 'stream.chunk' as MessageType,
        messageId: this.generateId(),
        timestamp: Date.now(),
        sessionId,
        payload: data
      })
    })

    agentLoop.on('tool_start', (data) => {
      this.sendToConnection(connection.id, {
        type: 'state.update' as MessageType,
        messageId: this.generateId(),
        timestamp: Date.now(),
        sessionId,
        payload: {
          type: 'tool_start',
          toolCall: data.toolCall
        }
      })
    })

    agentLoop.on('tool_end', (data) => {
      this.sendToConnection(connection.id, {
        type: 'state.update' as MessageType,
        messageId: this.generateId(),
        timestamp: Date.now(),
        sessionId,
        payload: {
          type: 'tool_end',
          toolCall: data.toolCall,
          result: data.result
        }
      })
    })

    agentLoop.on('run_complete', (data) => {
      this.sendToConnection(connection.id, {
        type: 'stream.complete' as MessageType,
        messageId: this.generateId(),
        timestamp: Date.now(),
        sessionId,
        payload: {
          output: data.output
        }
      })
    })

    agentLoop.on('run_error', (data) => {
      this.sendToConnection(connection.id, {
        type: 'stream.error' as MessageType,
        messageId: this.generateId(),
        timestamp: Date.now(),
        sessionId,
        payload: {
          error: data.error.message
        }
      })
    })

    // 启动 Agent Loop
    agentLoop.run(content).catch(error => {
      console.error('[WebSocket] Agent loop error:', error)
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
    const { toolCallId, success, data, error, metadata } = message.payload || {}
    const { sessionId } = message

    if (!sessionId) return

    const agentLoop = this.sessionManager.getAgentLoop(sessionId)
    if (!agentLoop) return

    // 找到对应的 tool bridge 并返回结果
    // 这里简化处理，实际应该通过 requestId 匹配
    console.log(`[WebSocket] Tool result for session ${sessionId}:`, { toolCallId, success })
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
      this.userConnections.get(conn.userId)?.delete(connectionId)
      this.connections.delete(connectionId)
      console.log(`[WebSocket] Connection ${connectionId} removed`)
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
