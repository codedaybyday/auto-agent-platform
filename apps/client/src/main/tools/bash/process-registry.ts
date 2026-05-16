/**
 * Process Registry
 * 管理后台进程，支持进程清理和状态查询
 */

import { ChildProcess } from 'child_process'
import { ProcessInfo } from './types.js'

export class ProcessRegistry {
  private processes = new Map<string, ProcessInfo>()
  private cleanupInterval?: NodeJS.Timeout

  constructor() {
    // 启动定期清理
    this.startCleanupTimer()
  }

  /**
   * 注册进程
   */
  register(
    processId: string,
    sessionId: string,
    command: string,
    childProcess: ChildProcess
  ): ProcessInfo {
    const info: ProcessInfo = {
      id: processId,
      sessionId,
      command,
      startTime: Date.now(),
      status: 'running',
      stdout: [],
      stderr: []
    }

    this.processes.set(processId, info)

    // 收集输出
    childProcess.stdout?.on('data', (data: Buffer) => {
      info.stdout.push(data.toString())
      // 限制缓冲区大小
      if (info.stdout.length > 1000) {
        info.stdout = info.stdout.slice(-500)
      }
    })

    childProcess.stderr?.on('data', (data: Buffer) => {
      info.stderr.push(data.toString())
      if (info.stderr.length > 1000) {
        info.stderr = info.stderr.slice(-500)
      }
    })

    // 进程结束
    childProcess.on('exit', (code) => {
      info.status = code === 0 ? 'completed' : 'failed'
      info.exitCode = code ?? undefined
    })

    childProcess.on('error', () => {
      info.status = 'failed'
      info.exitCode = -1
    })

    return info
  }

  /**
   * 获取进程信息
   */
  get(processId: string): ProcessInfo | undefined {
    return this.processes.get(processId)
  }

  /**
   * 获取会话的所有进程
   */
  getBySession(sessionId: string): ProcessInfo[] {
    return Array.from(this.processes.values()).filter(p => p.sessionId === sessionId)
  }

  /**
   * 列出所有进程
   */
  list(): ProcessInfo[] {
    return Array.from(this.processes.values())
  }

  /**
   * 列出运行中的进程
   */
  listRunning(): ProcessInfo[] {
    return Array.from(this.processes.values()).filter(p => p.status === 'running')
  }

  /**
   * 终止进程
   */
  async kill(processId: string, signal: NodeJS.Signals = 'SIGTERM'): Promise<boolean> {
    const info = this.processes.get(processId)
    if (!info || info.status !== 'running') {
      return false
    }

    // 这里需要通过 session manager 获取实际进程
    // 简化版：标记为已终止，实际清理在 session manager 中处理
    info.status = 'failed'
    info.exitCode = -1

    return true
  }

  /**
   * 移除进程记录
   */
  remove(processId: string): boolean {
    return this.processes.delete(processId)
  }

  /**
   * 清理会话的所有进程
   */
  cleanupSession(sessionId: string): void {
    const processes = this.getBySession(sessionId)
    for (const proc of processes) {
      this.remove(proc.id)
    }
  }

  /**
   * 清理已完成的进程（保留最近 100 个）
   */
  private cleanup(): void {
    const completed = Array.from(this.processes.entries())
      .filter(([, p]) => p.status !== 'running')
      .sort((a, b) => b[1].startTime - a[1].startTime)

    // 保留最近 100 个已完成的进程
    if (completed.length > 100) {
      for (const [id] of completed.slice(100)) {
        this.processes.delete(id)
      }
    }
  }

  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, 5 * 60 * 1000) // 每 5 分钟清理一次
  }

  /**
   * 停止清理定时器
   */
  stopCleanupTimer(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): { total: number; running: number; completed: number; failed: number } {
    const all = Array.from(this.processes.values())
    return {
      total: all.length,
      running: all.filter(p => p.status === 'running').length,
      completed: all.filter(p => p.status === 'completed').length,
      failed: all.filter(p => p.status === 'failed').length
    }
  }
}

// 单例实例
export const processRegistry = new ProcessRegistry()
