/**
 * Session Manager 服务
 * 管理多用户会话生命周期
 */

import { AgentLoop } from './agent-loop.js'
import { config } from '../config/index.js'
import type { Session, SessionContext, Message } from '../types/index.js'

interface SessionConfig {
  maxSessionsPerUser: number
  maxGlobalSessions: number
  idleTimeout: number
}

export class SessionManager {
  // 本地存储的会话
  private localSessions = new Map<string, AgentLoop>()
  private sessionMetadata = new Map<string, Session>()

  // 用户会话索引
  private userSessions = new Map<string, Set<string>>()

  private config: SessionConfig
  private instanceId: string

  constructor(instanceId: string, config: Partial<SessionConfig> = {}) {
    this.instanceId = instanceId
    this.config = {
      maxSessionsPerUser: config.maxSessionsPerUser || 10,
      maxGlobalSessions: config.maxGlobalSessions || 1000,
      idleTimeout: config.idleTimeout || 30 * 60 * 1000 // 30分钟
    }

    // 启动定期清理
    this.startCleanupInterval()
  }

  /**
   * 创建新会话
   */
  async createSession(userId: string, title?: string): Promise<Session> {
    // 检查用户会话数限制
    const userSessionCount = this.getUserSessionCount(userId)
    if (userSessionCount >= this.config.maxSessionsPerUser) {
      // 回收最旧的非活跃会话
      await this.recycleOldestSession(userId)
    }

    const sessionId = this.generateId()
    const now = new Date()

    // 创建会话元数据
    const session: Session = {
      id: sessionId,
      userId,
      title: title || `会话 ${userSessionCount + 1}`,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      messages: [],
      metadata: {
        model: config.llm.model,
        totalTokens: 0,
        toolUsageCount: 0
      }
    }

    // 创建 Agent Loop，传入 LLM 配置
    const agentLoop = new AgentLoop(sessionId, userId, {
      model: config.llm.model,
      baseURL: config.llm.baseURL,
      systemPrompt: undefined // 使用默认系统提示词
    })

    // 存储
    this.localSessions.set(sessionId, agentLoop)
    this.sessionMetadata.set(sessionId, session)

    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, new Set())
    }
    this.userSessions.get(userId)!.add(sessionId)

    console.log(`[SessionManager] Created session ${sessionId} for user ${userId}`)

    return session
  }

  /**
   * 获取或创建会话
   */
  async getOrCreateSession(userId: string, sessionId?: string): Promise<{ session: Session; agentLoop: AgentLoop }> {
    if (sessionId) {
      const session = this.getSession(sessionId)
      const agentLoop = this.getAgentLoop(sessionId)
      if (session && agentLoop) {
        return { session, agentLoop }
      }
    }

    // 创建新会话
    const newSession = await this.createSession(userId)
    const newAgentLoop = this.getAgentLoop(newSession.id)!
    return { session: newSession, agentLoop: newAgentLoop }
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): Session | null {
    return this.sessionMetadata.get(sessionId) || null
  }

  /**
   * 获取 Agent Loop
   */
  getAgentLoop(sessionId: string): AgentLoop | null {
    return this.localSessions.get(sessionId) || null
  }

  /**
   * 获取用户的所有会话
   */
  getUserSessions(userId: string): Session[] {
    const sessionIds = this.userSessions.get(userId)
    if (!sessionIds) return []

    return Array.from(sessionIds)
      .map(id => this.sessionMetadata.get(id))
      .filter((s): s is Session => s !== undefined)
  }

  /**
   * 更新会话消息
   */
  async updateSessionMessages(sessionId: string, messages: Message[]): Promise<void> {
    const session = this.sessionMetadata.get(sessionId)
    if (session) {
      session.messages = messages
      session.updatedAt = new Date()
    }
  }

  /**
   * 清除会话消息
   */
  async clearSessionMessages(sessionId: string): Promise<void> {
    console.log('[SessionManager] Clearing messages for session:', sessionId)
    const session = this.sessionMetadata.get(sessionId)
    if (session) {
      const beforeCount = session.messages.length
      session.messages = []
      session.updatedAt = new Date()
      console.log('[SessionManager] Cleared', beforeCount, 'messages from session metadata')
    }
    // 同时清除 AgentLoop 中的消息
    const agentLoop = this.localSessions.get(sessionId)
    if (agentLoop) {
      const beforeCount = agentLoop.getMessages().length
      agentLoop.clearMessages()
      console.log('[SessionManager] Cleared', beforeCount, 'messages from AgentLoop')
    }
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessionMetadata.get(sessionId)
    if (!session) return

    // 清理 Agent Loop（包括通知客户端清理工具）
    const agentLoop = this.localSessions.get(sessionId)
    if (agentLoop) {
      await agentLoop.cleanup()
    }

    // 清理索引
    this.userSessions.get(session.userId)?.delete(sessionId)
    this.localSessions.delete(sessionId)
    this.sessionMetadata.delete(sessionId)

    console.log(`[SessionManager] Deleted session ${sessionId}`)
  }

  /**
   * 清理用户所有会话
   */
  async cleanupUserSessions(userId: string): Promise<void> {
    const sessionIds = this.userSessions.get(userId)
    if (!sessionIds) return

    for (const sessionId of Array.from(sessionIds)) {
      await this.deleteSession(sessionId)
    }

    this.userSessions.delete(userId)
  }

  /**
   * 获取用户会话数
   */
  getUserSessionCount(userId: string): number {
    return this.userSessions.get(userId)?.size || 0
  }

  /**
   * 获取全局会话数
   */
  getGlobalSessionCount(): number {
    return this.localSessions.size
  }

  /**
   * 回收最旧的会话
   */
  private async recycleOldestSession(userId: string): Promise<void> {
    const sessionIds = this.userSessions.get(userId)
    if (!sessionIds || sessionIds.size === 0) return

    // 找到最旧的非活跃会话
    let oldestId: string | null = null
    let oldestTime = Date.now()

    for (const sessionId of sessionIds) {
      const session = this.sessionMetadata.get(sessionId)
      if (session && session.status === 'idle') {
        const time = session.updatedAt.getTime()
        if (time < oldestTime) {
          oldestTime = time
          oldestId = sessionId
        }
      }
    }

    if (oldestId) {
      await this.deleteSession(oldestId)
    } else {
      // 如果没有空闲会话，删除最早的
      const firstId = Array.from(sessionIds)[0]
      if (firstId) {
        await this.deleteSession(firstId)
      }
    }
  }

  /**
   * 定期清理僵尸会话
   */
  private startCleanupInterval(): void {
    setInterval(() => {
      const now = Date.now()
      const timeout = this.config.idleTimeout

      for (const [sessionId, session] of this.sessionMetadata) {
        if (session.status === 'idle' && now - session.updatedAt.getTime() > timeout) {
          console.log(`[SessionManager] Cleaning up idle session ${sessionId}`)
          this.deleteSession(sessionId)
        }
      }
    }, 60000) // 每分钟检查
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalSessions: number
    totalUsers: number
    sessionsPerUser: Record<string, number>
  } {
    const sessionsPerUser: Record<string, number> = {}

    for (const [userId, sessionIds] of this.userSessions) {
      sessionsPerUser[userId] = sessionIds.size
    }

    return {
      totalSessions: this.localSessions.size,
      totalUsers: this.userSessions.size,
      sessionsPerUser
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}
