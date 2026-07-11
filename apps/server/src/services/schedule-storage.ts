/**
 * 定时任务持久化存储 - SQLite 实现
 *
 * 复用 session-storage 的 SQLite 连接和模式
 */

import Database from 'better-sqlite3'
import { config } from '../config/index.js'
import path from 'path'
import os from 'os'
import type { Schedule } from '../types/index.js'

function getDbPath(): string {
  if (config.dataDir) {
    return path.join(config.dataDir, 'sessions.db')
  }
  const appName = config.env === 'production' ? 'auto-agent' : 'auto-agent-test'
  const platform = process.platform
  let dataDir: string
  if (platform === 'darwin') {
    dataDir = path.join(os.homedir(), 'Library', 'Application Support', appName, 'data')
  } else if (platform === 'win32') {
    dataDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName, 'data')
  } else {
    dataDir = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), appName, 'data')
  }
  return path.join(dataDir, 'sessions.db')
}

export class ScheduleStorage {
  private db: Database.Database | null = null
  private dbPath: string

  constructor() {
    this.dbPath = getDbPath()
  }

  init(): void {
    this.db = new Database(this.dbPath)
    this.db.pragma('journal_mode = WAL')
    this.createTable()
    console.log('[ScheduleStorage] Initialized, table ready')
  }

  private createTable(): void {
    if (!this.db) return
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        instruction TEXT NOT NULL,
        cron_expr TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at INTEGER,
        next_run_at INTEGER NOT NULL,
        session_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_schedules_user_id ON schedules(user_id)`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules(next_run_at)`)
    console.log('[ScheduleStorage] Table created/verified')
  }

  /** 获取用户所有定时任务 */
  getUserSchedules(userId: string): Schedule[] {
    if (!this.db) return []
    const rows = this.db.prepare(
      'SELECT * FROM schedules WHERE user_id = ? ORDER BY created_at DESC'
    ).all(userId) as any[]
    return rows.map(r => this.rowToSchedule(r))
  }

  /** 获取所有启用的定时任务（调度器用） */
  getAllEnabledSchedules(): Schedule[] {
    if (!this.db) return []
    const rows = this.db.prepare(
      'SELECT * FROM schedules WHERE enabled = 1 ORDER BY next_run_at ASC'
    ).all() as any[]
    return rows.map(r => this.rowToSchedule(r))
  }

  /** 创建定时任务 */
  createSchedule(schedule: Schedule): void {
    if (!this.db) return
    this.db.prepare(`
      INSERT INTO schedules (id, user_id, name, instruction, cron_expr, enabled, last_run_at, next_run_at, session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      schedule.id, schedule.userId, schedule.name, schedule.instruction,
      schedule.cronExpr, schedule.enabled ? 1 : 0, schedule.lastRunAt || null,
      schedule.nextRunAt, schedule.sessionId || null, schedule.createdAt, schedule.updatedAt
    )
    console.log(`[ScheduleStorage] Created schedule: ${schedule.name} (${schedule.id})`)
  }

  /** 更新定时任务 */
  updateSchedule(schedule: Schedule): void {
    if (!this.db) return
    this.db.prepare(`
      UPDATE schedules SET name=?, instruction=?, cron_expr=?, enabled=?, last_run_at=?, next_run_at=?, session_id=?, updated_at=?
      WHERE id=?
    `).run(
      schedule.name, schedule.instruction, schedule.cronExpr,
      schedule.enabled ? 1 : 0, schedule.lastRunAt || null,
      schedule.nextRunAt, schedule.sessionId || null, schedule.updatedAt, schedule.id
    )
    console.log(`[ScheduleStorage] Updated schedule: ${schedule.name} (${schedule.id})`)
  }

  /** 删除定时任务 */
  deleteSchedule(id: string): boolean {
    if (!this.db) return false
    const result = this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id)
    return result.changes > 0
  }

  /** 启用/禁用定时任务 */
  toggleSchedule(id: string, enabled: boolean): boolean {
    if (!this.db) return false
    const result = this.db.prepare(
      'UPDATE schedules SET enabled = ?, updated_at = ? WHERE id = ?'
    ).run(enabled ? 1 : 0, Date.now(), id)
    return result.changes > 0
  }

  /** 更新执行记录（调度器每次触发后调用） */
  recordRun(id: string, lastRunAt: number, nextRunAt: number, sessionId: string): void {
    if (!this.db) return
    this.db.prepare(
      'UPDATE schedules SET last_run_at = ?, next_run_at = ?, session_id = ?, updated_at = ? WHERE id = ?'
    ).run(lastRunAt, nextRunAt, sessionId, Date.now(), id)
  }

  private rowToSchedule(row: any): Schedule {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      instruction: row.instruction,
      cronExpr: row.cron_expr,
      enabled: row.enabled === 1,
      lastRunAt: row.last_run_at || undefined,
      nextRunAt: row.next_run_at,
      sessionId: row.session_id || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}

export const scheduleStorage = new ScheduleStorage()
