/**
 * 会话持久化存储服务 - SQLite 实现
 *
 * 特性：
 * - SQLite 数据库存储
 * - 自动迁移
 * - 支持会话标题、消息历史、元数据
 * - 定期清理过期会话
 */

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'node:fs'
import type { Session, Message } from '../types/index.js'

export interface SessionStorageConfig {
  /** 数据库文件路径 */
  dbPath: string
  /** 会话最大保存时间（毫秒），默认 30 天 */
  maxSessionAge: number
  /** 是否启用 WAL 模式 */
  walMode: boolean
}

export class SessionStorage {
  private db: Database.Database | null = null
  private config: SessionStorageConfig
  private initialized = false

  constructor(config: Partial<SessionStorageConfig> = {}) {
    this.config = {
      dbPath: config.dbPath || path.join(process.cwd(), 'data', 'sessions.db'),
      maxSessionAge: config.maxSessionAge || 30 * 24 * 60 * 60 * 1000, // 30天
      walMode: config.walMode !== false // 默认启用 WAL 模式
    }
  }

  /**
   * 初始化数据库
   */
  init(): void {
    if (this.initialized) return

    try {
      // 确保目录存在
      const dir = path.dirname(this.config.dbPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      // 打开数据库
      this.db = new Database(this.config.dbPath)
      console.log(`[SessionStorage] Database opened: ${this.config.dbPath}`)

      // 启用 WAL 模式（提高并发性能）
      if (this.config.walMode) {
        this.db.pragma('journal_mode = WAL')
        this.db.pragma('synchronous = NORMAL')
      }

      // 创建表
      this.createTables()

      // 启动定期清理
      this.startCleanupInterval()

      this.initialized = true
      console.log(`[SessionStorage] Initialized successfully`)
    } catch (error) {
      console.error('[SessionStorage] Failed to initialize:', error)
      throw error
    }
  }

  /**
   * 创建数据库表
   */
  private createTables(): void {
    if (!this.db) return

    // 会话表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '新会话',
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        model TEXT,
        total_tokens INTEGER DEFAULT 0,
        tool_usage_count INTEGER DEFAULT 0,
        title_generated INTEGER DEFAULT 0
      )
    `)

    // 消息表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        tool_calls TEXT, -- JSON string
        tool_results TEXT, -- JSON string
        reasoning_content TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `)

    // 创建索引
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at)`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)`)

    console.log('[SessionStorage] Database tables created')
  }

  /**
   * 保存会话
   */
  saveSession(session: Session, titleGenerated: boolean = false): void {
    if (!this.db) return

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, user_id, title, status, created_at, updated_at, model, total_tokens, tool_usage_count, title_generated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        status = excluded.status,
        updated_at = excluded.updated_at,
        model = excluded.model,
        total_tokens = excluded.total_tokens,
        tool_usage_count = excluded.tool_usage_count,
        title_generated = excluded.title_generated
    `)

    stmt.run(
      session.id,
      session.userId,
      session.title,
      session.status,
      session.createdAt.getTime(),
      session.updatedAt.getTime(),
      session.metadata.model,
      session.metadata.totalTokens,
      session.metadata.toolUsageCount,
      titleGenerated ? 1 : 0
    )
  }

  /**
   * 获取单个会话
   */
  getSession(sessionId: string): Session | null {
    if (!this.db) return null

    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as any
    if (!row) return null

    return this.rowToSession(row)
  }

  /**
   * 获取用户的所有会话
   */
  getUserSessions(userId: string): Session[] {
    if (!this.db) return []

    const rows = this.db.prepare(
      'SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC'
    ).all(userId) as any[]

    return rows.map(row => this.rowToSession(row))
  }

  /**
   * 检查标题是否已生成
   */
  isTitleGenerated(sessionId: string): boolean {
    if (!this.db) return false

    const row = this.db.prepare(
      'SELECT title_generated FROM sessions WHERE id = ?'
    ).get(sessionId) as any

    return row?.title_generated === 1
  }

  /**
   * 更新会话标题
   */
  updateSessionTitle(sessionId: string, title: string): boolean {
    if (!this.db) return false

    const result = this.db.prepare(`
      UPDATE sessions SET title = ?, updated_at = ?, title_generated = 1 WHERE id = ?
    `).run(title, Date.now(), sessionId)

    return result.changes > 0
  }

  /**
   * 删除会话
   */
  deleteSession(sessionId: string): boolean {
    if (!this.db) return false

    const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
    return result.changes > 0
  }

  /**
   * 清理过期会话
   */
  cleanup(): number {
    if (!this.db) return 0

    const cutoff = Date.now() - this.config.maxSessionAge
    const result = this.db.prepare('DELETE FROM sessions WHERE updated_at < ?').run(cutoff)

    if (result.changes > 0) {
      console.log(`[SessionStorage] Cleaned up ${result.changes} expired sessions`)
    }

    return result.changes
  }

  /**
   * 保存消息
   */
  saveMessage(sessionId: string, message: Message): void {
    if (!this.db) return

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO messages (id, session_id, role, content, timestamp, tool_calls, tool_results, reasoning_content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      message.id,
      sessionId,
      message.role,
      message.content,
      message.timestamp,
      message.toolCalls ? JSON.stringify(message.toolCalls) : null,
      message.toolResults ? JSON.stringify(message.toolResults) : null,
      message.reasoningContent || null
    )

    // 更新会话的 updated_at
    this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), sessionId)
  }

  /**
   * 获取会话的所有消息
   */
  getSessionMessages(sessionId: string): Message[] {
    if (!this.db) return []

    const rows = this.db.prepare(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC'
    ).all(sessionId) as any[]

    return rows.map(row => this.rowToMessage(row))
  }

  /**
   * 删除会话的所有消息
   */
  deleteSessionMessages(sessionId: string): void {
    if (!this.db) return

    this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId)
  }

  /**
   * 获取统计信息
   */
  getStats(): { totalSessions: number; totalMessages: number } {
    if (!this.db) return { totalSessions: 0, totalMessages: 0 }

    const sessionCount = (this.db.prepare('SELECT COUNT(*) as count FROM sessions').get() as any).count
    const messageCount = (this.db.prepare('SELECT COUNT(*) as count FROM messages').get() as any).count

    return { totalSessions: sessionCount, totalMessages: messageCount }
  }

  /**
   * 将数据库行转换为 Session 对象
   */
  private rowToSession(row: any): Session {
    return {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      status: row.status,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      messages: [], // 消息单独加载
      metadata: {
        model: row.model || 'unknown',
        totalTokens: row.total_tokens || 0,
        toolUsageCount: row.tool_usage_count || 0
      }
    }
  }

  /**
   * 将数据库行转换为 Message 对象
   */
  private rowToMessage(row: any): Message {
    return {
      id: row.id,
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
      toolResults: row.tool_results ? JSON.parse(row.tool_results) : undefined,
      reasoningContent: row.reasoning_content || undefined
    }
  }

  /**
   * 启动定期清理
   */
  private startCleanupInterval(): void {
    // 每小时清理一次过期会话
    setInterval(() => {
      this.cleanup()
    }, 60 * 60 * 1000)
  }

  /**
   * 关闭数据库
   */
  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      this.initialized = false
      console.log('[SessionStorage] Database closed')
    }
  }
}

// 导出全局单例
export const sessionStorage = new SessionStorage()
