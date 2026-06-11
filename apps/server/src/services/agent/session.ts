/**
 * Session Manager 服务
 * 管理多用户会话生命周期
 */

import { AgentLoop } from './loop.js'
import { config } from '../../config/index.js'
import { LLMClient } from '../llm/client.js'
import { SessionStorage, sessionStorage } from '../session-storage.js'
import type { Session, SessionContext, Message } from '../../types/index.js'

interface SessionConfig {
  maxSessionsPerUser: number
  maxGlobalSessions: number
  idleTimeout: number
  llm?: {
    model?: string
    baseURL?: string
  }
}

export class SessionManager {
  // 本地存储的会话
  private localSessions = new Map<string, AgentLoop>()
  private sessionMetadata = new Map<string, Session>()

  // 用户会话索引
  private userSessions = new Map<string, Set<string>>()

  private config: SessionConfig
  private instanceId: string
  private llmClient: LLMClient
  private storage: SessionStorage

  constructor(instanceId: string, config: Partial<SessionConfig> = {}) {
    this.instanceId = instanceId
    this.config = {
      maxSessionsPerUser: config.maxSessionsPerUser || 10,
      maxGlobalSessions: config.maxGlobalSessions || 1000,
      idleTimeout: config.idleTimeout || 30 * 60 * 1000 // 30分钟
    }

    // 初始化 LLM 客户端（用于生成标题）
    this.llmClient = new LLMClient({
      model: config.llm?.model || process.env.LLM_MODEL || 'gpt-4o-mini',
      baseURL: config.llm?.baseURL || process.env.LLM_BASE_URL
    })

    // 初始化存储
    this.storage = sessionStorage
    this.storage.init()

    // 加载持久化的会话
    this.loadPersistedSessions()

    // 启动定期清理
    this.startCleanupInterval()
  }

  /**
   * 加载持久化的会话
   */
  private loadPersistedSessions(): void {
    // 从存储加载所有会话到内存
    // 注意：这里需要一个方法来获取所有用户，暂时简单处理
    // 实际使用时通过 getUserSessions(userId) 按需加载
    console.log('[SessionManager] Storage initialized, sessions will be loaded on-demand')
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

    // 设置消息持久化回调
    agentLoop.setOnMessageAdded((message) => {
      this.storage.saveMessage(sessionId, message)
    })

    // 存储到内存
    this.localSessions.set(sessionId, agentLoop)
    this.sessionMetadata.set(sessionId, session)

    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, new Set())
    }
    this.userSessions.get(userId)!.add(sessionId)

    // 持久化到 SQLite
    this.storage.saveSession(session)

    console.log(`[SessionManager] Created session ${sessionId} for user ${userId}`)

    return session
  }

  /**
   * 获取或创建会话
   */
  async getOrCreateSession(userId: string, sessionId?: string): Promise<{ session: Session; agentLoop: AgentLoop }> {
    if (sessionId) {
      const session = this.getSession(sessionId)
      if (session) {
        let agentLoop = this.getAgentLoop(sessionId)
        if (!agentLoop) {
          // 修复：为请求的会话创建 AgentLoop，而不是返回另一个会话
          agentLoop = new AgentLoop(session.id, userId, {
            model: session.metadata?.model || process.env.LLM_MODEL,
            baseURL: process.env.LLM_BASE_URL,
            systemPrompt: undefined
          })
          // 设置消息持久化回调
          agentLoop.setOnMessageAdded((message) => {
            this.storage.saveMessage(session.id, message)
          })
          this.localSessions.set(session.id, agentLoop)
          console.log(`[SessionManager] Created new AgentLoop for existing session: ${session.id}`)
        }
        return { session, agentLoop }
      }
      // session 不存在，继续下面的逻辑创建新会话
    }

    // 没有指定 sessionId 或 session 不存在，尝试获取用户最新的已有会话
    const userSessions = this.getUserSessions(userId)
    if (userSessions.length > 0) {
      const latestSession = userSessions[0]
      let agentLoop = this.getAgentLoop(latestSession.id)
      if (!agentLoop) {
        // 创建新的 AgentLoop 用于已有会话
        agentLoop = new AgentLoop(latestSession.id, userId, {
          model: latestSession.metadata.model,
          baseURL: process.env.LLM_BASE_URL,
          systemPrompt: undefined
        })
        // 设置消息持久化回调
        agentLoop.setOnMessageAdded((message) => {
          this.storage.saveMessage(latestSession.id, message)
        })
        this.localSessions.set(latestSession.id, agentLoop)
      }
      console.log(`[SessionManager] Reusing existing session: ${latestSession.id}`)
      return { session: latestSession, agentLoop }
    }

    // 没有已有会话，创建新会话
    const newSession = await this.createSession(userId)
    const newAgentLoop = this.getAgentLoop(newSession.id)!
    return { session: newSession, agentLoop: newAgentLoop }
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): Session | null {
    // 先从内存获取
    let session = this.sessionMetadata.get(sessionId)
    if (session) {
      return session
    }

    // 从 SQLite 加载
    session = this.storage.getSession(sessionId)
    if (session) {
      // 加载消息
      session.messages = this.storage.getSessionMessages(sessionId)
      // 同步到内存
      this.sessionMetadata.set(sessionId, session)
      return session
    }

    return null
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
    // 从 SQLite 加载会话列表
    const persistedSessions = this.storage.getUserSessions(userId)

    // 合并内存中的会话（包含 AgentLoop）
    const sessions: Session[] = []
    const sessionIds = new Set<string>()

    // 先添加持久化的会话
    for (const session of persistedSessions) {
      // 检查内存中是否有更新的数据
      const memSession = this.sessionMetadata.get(session.id)
      if (memSession) {
        sessions.push(memSession)
      } else {
        // 从 SQLite 加载消息
        session.messages = this.storage.getSessionMessages(session.id)
        sessions.push(session)
        // 同步到内存
        this.sessionMetadata.set(session.id, session)
      }
      sessionIds.add(session.id)
    }

    // 更新用户索引
    this.userSessions.set(userId, sessionIds)

    return sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }

  /**
   * 更新会话消息
   */
  async updateSessionMessages(sessionId: string, messages: Message[]): Promise<void> {
    const session = this.sessionMetadata.get(sessionId)
    if (session) {
      session.messages = messages
      session.updatedAt = new Date()

      // 保存消息到 SQLite
      for (const message of messages) {
        this.storage.saveMessage(sessionId, message)
      }
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

    // 删除持久化数据
    this.storage.deleteSession(sessionId)
    this.storage.deleteSessionMessages(sessionId)

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

  /**
   * 根据用户输入生成会话标题
   * @param userInput 用户第一条消息内容
   * @returns 生成的标题（10字以内）
   */
  async generateSessionTitle(userInput: string): Promise<string> {
    try {
      // 如果输入太短，使用默认标题
      if (!userInput || userInput.trim().length < 3) {
        return '新会话'
      }

      const messages: Message[] = [
        {
          id: this.generateId(),
          role: 'system',
          content: '你是一个会话标题生成助手。根据用户的第一条消息，生成一个简洁的会话标题（不超过10个字）。标题应该准确概括用户意图。只返回标题文本，不要有任何解释、引号或额外内容。',
          timestamp: Date.now()
        },
        {
          id: this.generateId(),
          role: 'user',
          content: userInput.substring(0, 200), // 限制输入长度，避免浪费 Token
          timestamp: Date.now()
        }
      ]

      const response = await this.llmClient.chat(messages, undefined, {
        responseFormat: 'text',
        includeTools: false // 标题生成不需要工具
      })

      // 清理标题：去除引号、换行和多余空格
      let title = (response.content || '新会话').trim()
      title = title.replace(/^["'""']|["'""']$/g, '') // 去除首尾引号
      title = title.replace(/\n/g, ' ') // 换行转空格
      title = title.replace(/\s+/g, ' ') // 多个空格合并
      title = title.substring(0, 20) // 限制长度（留一点余量）

      console.log(`[SessionManager] Generated title: "${title}" for input: "${userInput.substring(0, 50)}..."`)

      return title || '新会话'
    } catch (error) {
      console.error('[SessionManager] Failed to generate session title:', error)
      return '新会话'
    }
  }

  /**
   * 异步生成并更新会话标题
   * 在用户发送第一条消息后调用
   * @param sessionId 会话ID
   * @param userInput 用户输入内容
   * @param onTitleGenerated 标题生成后的回调（用于通知前端）
   */
  async updateSessionTitleAsync(
    sessionId: string,
    userInput: string,
    onTitleGenerated?: (sessionId: string, title: string) => void
  ): Promise<void> {
    // 检查是否已经生成过标题（从 SQLite 检查）
    if (this.storage.isTitleGenerated(sessionId)) {
      return
    }

    const session = this.sessionMetadata.get(sessionId)
    if (!session) {
      return
    }

    // 异步生成标题（不阻塞主流程）
    this.generateSessionTitle(userInput).then(title => {
      // 更新会话标题
      session.title = title
      session.updatedAt = new Date()

      // 持久化到 SQLite
      this.storage.updateSessionTitle(sessionId, title)

      console.log(`[SessionManager] Updated session ${sessionId} title to: "${title}"`)

      // 通知回调
      if (onTitleGenerated) {
        onTitleGenerated(sessionId, title)
      }
    }).catch(error => {
      console.error('[SessionManager] Failed to update session title:', error)
    })
  }

  /**
   * 检查会话标题是否为默认标题
   */
  private isDefaultTitle(sessionId: string): boolean {
    return !this.storage.isTitleGenerated(sessionId)
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}
