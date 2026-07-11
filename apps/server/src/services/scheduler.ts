/**
 * Scheduler - 定时任务调度器
 *
 * 每分钟检查一次，触发到达执行时间的定时任务。
 * 不依赖第三方 cron 库，实现简化版 cron 解析。
 */

import { scheduleStorage } from './schedule-storage.js'
import type { Schedule } from '../types/index.js'
import type { SessionManager } from './agent/session.js'

type SchedulerDeps = {
  sessionManager: SessionManager
  wsGateway: any  // WebSocketGateway，用于绑定会话
  /** 通知客户端定时任务已执行 */
  onScheduleExecuted?: (schedule: Schedule, sessionId: string) => void
}

class Scheduler {
  private deps: SchedulerDeps | null = null
  private intervalId: ReturnType<typeof setInterval> | null = null
  private running = false

  /** 启动调度器 */
  start(deps: SchedulerDeps): void {
    this.deps = deps
    this.running = true
    console.log('[Scheduler] Started, checking every 60s')

    // 立即检查一次
    this.checkAndExecute().catch(err => {
      console.error('[Scheduler] Initial check failed:', err)
    })

    // 每分钟检查
    this.intervalId = setInterval(() => {
      this.checkAndExecute().catch(err => {
        console.error('[Scheduler] Check failed:', err)
      })
    }, 60_000)
  }

  /** 停止调度器 */
  stop(): void {
    this.running = false
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    console.log('[Scheduler] Stopped')
  }

  /** 重新加载（定时任务配置变更后调用） */
  reload(): void {
    console.log('[Scheduler] Reload triggered')
  }

  /** 核心：检查并执行到期任务 */
  private async checkAndExecute(): Promise<void> {
    if (!this.deps) return

    const schedules = scheduleStorage.getAllEnabledSchedules()
    if (schedules.length === 0) return

    const now = Date.now()
    let executedCount = 0

    for (const schedule of schedules) {
      if (schedule.nextRunAt <= now) {
        try {
          await this.executeSchedule(schedule)
          executedCount++
        } catch (err) {
          console.error(`[Scheduler] Failed to execute schedule ${schedule.name}:`, err)
        }
      }
    }

    if (executedCount > 0) {
      console.log(`[Scheduler] Executed ${executedCount} schedules`)
    }
  }

  /** 执行单个定时任务 */
  private async executeSchedule(schedule: Schedule): Promise<void> {
    const { sessionManager, wsGateway, onScheduleExecuted } = this.deps!
    const now = Date.now()

    console.log(`[Scheduler] Executing: ${schedule.name} (${schedule.instruction.slice(0, 50)}...)`)

    // 1. 创建会话
    const session = await sessionManager.createSession(schedule.userId, schedule.name)

    // 2. 获取 AgentLoop
    const agentLoop = sessionManager.getAgentLoop(session.id)
    if (!agentLoop) {
      throw new Error(`Failed to get AgentLoop for session ${session.id}`)
    }

    // 3. 绑定用户的 WebSocket 连接（AgentLoop 需要 WS 才能初始化 MCP 工具）
    const bound = wsGateway.bindSessionForScheduler(session.id, schedule.userId, agentLoop)
    if (!bound) {
      console.warn(`[Scheduler] No active WebSocket for user ${schedule.userId}, agent will run without tools`)
    }

    // 4. 计算下次执行时间
    const nextRunAt = calcNextRunAt(schedule.cronExpr, now)

    // 5. 更新执行记录
    scheduleStorage.recordRun(schedule.id, now, nextRunAt, session.id)

    // 6. 启动 Agent Loop (异步，不阻塞)
    agentLoop.run(schedule.instruction).catch(err => {
      console.error(`[Scheduler] Agent execution failed for schedule ${schedule.name}:`, err)
    })

    // 7. 通知客户端
    if (onScheduleExecuted) {
      onScheduleExecuted(schedule, session.id)
    }

    console.log(`[Scheduler] Task "${schedule.name}" started, session=${session.id}, next=${new Date(nextRunAt).toLocaleString()}`)
  }
}

// ==================== Cron 表达式解析 ====================

/**
 * 根据 cron 表达式和当前时间计算下次执行时间
 * 支持 5 段式: 分 时 日 月 周 (0-6, 0=周日)
 */
export function calcNextRunAt(cronExpr: string, fromTime: number = Date.now()): number {
  const parts = cronExpr.trim().split(/\s+/)
  if (parts.length !== 5) {
    // 无效 cron 表达式，默认明天同一时间
    const t = new Date(fromTime)
    t.setDate(t.getDate() + 1)
    return t.getTime()
  }

  const [minStr, hourStr, dayStr, monthStr, weekStr] = parts
  const now = new Date(fromTime)

  // 从当前分钟+1开始尝试，最多尝试 366 天（涵盖闰年）
  const startMinute = now.getMinutes() + 1
  const startHour = now.getHours()
  const startDay = now.getDate()
  const startMonth = now.getMonth() + 1 // JS month: 0-11
  const startYear = now.getFullYear()

  for (let offset = 0; offset < 366 * 24 * 60; offset++) {
    const totalMinutes = startMinute + startHour * 60 + startDay * 1440 + offset
    const candidateMinute = totalMinutes % 60
    const candidateHour = Math.floor(totalMinutes / 60) % 24
    // ... approximate day/month

    // 简化: 用 Date 递增
    const candidate = new Date(fromTime)
    candidate.setSeconds(0, 0)
    candidate.setMinutes(candidate.getMinutes() + offset + 1)

    const min = candidate.getMinutes()
    const hour = candidate.getHours()
    const day = candidate.getDate()
    const month = candidate.getMonth() + 1
    const week = candidate.getDay()

    if (matchField(minStr, min, 0, 59) &&
        matchField(hourStr, hour, 0, 23) &&
        matchField(dayStr, day, 1, 31) &&
        matchField(monthStr, month, 1, 12) &&
        matchField(weekStr, week, 0, 6)) {
      return candidate.getTime()
    }
  }

  // Fallback: 24小时后
  return fromTime + 24 * 60 * 60 * 1000
}

function matchField(expr: string, value: number, _min: number, _max: number): boolean {
  if (expr === '*') return true

  // 逗号分隔: "1,3,5"
  if (expr.includes(',')) {
    return expr.split(',').some(e => matchField(e.trim(), value, _min, _max))
  }

  // 范围: "1-5"
  if (expr.includes('-')) {
    const [lo, hi] = expr.split('-').map(Number)
    return value >= lo && value <= hi
  }

  // 步长: "*/15"
  if (expr.startsWith('*/')) {
    const step = parseInt(expr.slice(2))
    return value % step === 0
  }

  // 精确值
  return parseInt(expr) === value
}

/**
 * Cron 表达式转人类可读描述
 */
export function describeCron(cronExpr: string): string {
  const parts = cronExpr.trim().split(/\s+/)
  if (parts.length !== 5) return cronExpr

  const [min, hour, day, month, week] = parts

  // 每天固定时间
  if (month === '*' && week === '*') {
    if (day === '*') return `每天 ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
    if (day !== '*') return `每月 ${day} 日 ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
  }

  // 每周
  if (day === '*' && month === '*') {
    const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    if (week !== '*') {
      const w = Array.isArray(week) ? parseInt(week[0]) : parseInt(week)
      if (!isNaN(w)) return `每${weekNames[w]} ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
    }
  }

  // 每小时
  if (day === '*' && month === '*' && week === '*' && hour === '*') {
    if (min.startsWith('*/')) return `每 ${min.slice(2)} 分钟`
    return `每小时 ${min.padStart(2, '0')} 分`
  }

  return cronExpr
}

export const scheduler = new Scheduler()
