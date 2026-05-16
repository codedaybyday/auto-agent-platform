/**
 * Shell Session Manager
 * 管理持久化的 bash 会话，支持 cd 和环境变量
 */

import { spawn, type ChildProcess } from 'child_process'
import { BashOutput, ShellSessionState } from './types.js'

export class ShellSessionManager {
  private sessions = new Map<string, ShellSessionState>()
  private outputBuffer = new Map<string, { stdout: string; stderr: string }>()

  /**
   * 获取或创建会话
   */
  getOrCreate(sessionId: string, restart = false): ShellSessionState {
    if (restart && this.sessions.has(sessionId)) {
      this.destroy(sessionId)
    }

    if (!this.sessions.has(sessionId)) {
      const session = this.createSession(sessionId)
      this.sessions.set(sessionId, session)
    }

    const session = this.sessions.get(sessionId)!
    session.lastActivity = Date.now()
    return session
  }

  /**
   * 创建新的 shell 会话
   */
  private createSession(sessionId: string): ShellSessionState {
    const shell = spawn('bash', ['-i'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'xterm-256color' }
    })

    const state: ShellSessionState = {
      id: sessionId,
      process: shell,
      currentDir: process.cwd(),
      env: Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => v !== undefined)
      ) as Record<string, string>,
      startTime: Date.now(),
      lastActivity: Date.now()
    }

    // 初始化输出缓冲区
    this.outputBuffer.set(sessionId, { stdout: '', stderr: '' })

    // 持续收集输出
    shell.stdout?.on('data', (data) => {
      const buffer = this.outputBuffer.get(sessionId)
      if (buffer) {
        buffer.stdout += data.toString()
      }
    })

    shell.stderr?.on('data', (data) => {
      const buffer = this.outputBuffer.get(sessionId)
      if (buffer) {
        buffer.stderr += data.toString()
      }
    })

    // 处理进程错误
    shell.on('error', (err) => {
      console.error(`[ShellSession ${sessionId}] Process error:`, err)
    })

    // 进程退出时清理
    shell.on('exit', (code) => {
      console.log(`[ShellSession ${sessionId}] Process exited with code ${code}`)
      this.sessions.delete(sessionId)
      this.outputBuffer.delete(sessionId)
    })

    return state
  }

  /**
   * 执行命令
   */
  async execute(
    sessionId: string,
    command: string,
    options: { timeout?: number; workingDir?: string } = {}
  ): Promise<BashOutput> {
    const session = this.getOrCreate(sessionId)
    const startTime = Date.now()

    // 清空之前的输出缓冲区
    this.outputBuffer.set(sessionId, { stdout: '', stderr: '' })

    return new Promise((resolve) => {
      const timeout = options.timeout || 60000
      const marker = `__CMD_END_${Date.now()}_${Math.random().toString(36).substr(2, 9)}__`

      let stdout = ''
      let stderr = ''
      let markerFound = false

      // 创建一次性数据处理器
      const stdoutHandler = (data: Buffer) => {
        const chunk = data.toString()
        if (chunk.includes(marker)) {
          const parts = chunk.split(marker)
          stdout += parts[0]
          markerFound = true
          cleanup()
          resolve(this.buildResult(session, stdout, stderr, 0, startTime))
        } else {
          stdout += chunk
        }
      }

      const stderrHandler = (data: Buffer) => {
        stderr += data.toString()
      }

      // 临时替换处理器
      session.process.stdout?.removeAllListeners('data')
      session.process.stderr?.removeAllListeners('data')
      session.process.stdout?.on('data', stdoutHandler)
      session.process.stderr?.on('data', stderrHandler)

      // 清理函数
      const cleanup = () => {
        clearTimeout(timeoutId)
        session.process.stdout?.removeListener('data', stdoutHandler)
        session.process.stderr?.removeListener('data', stderrHandler)
        // 恢复原来的处理器
        session.process.stdout?.on('data', (data) => {
          const buffer = this.outputBuffer.get(sessionId)
          if (buffer) buffer.stdout += data.toString()
        })
        session.process.stderr?.on('data', (data) => {
          const buffer = this.outputBuffer.get(sessionId)
          if (buffer) buffer.stderr += data.toString()
        })
      }

      // 超时处理
      const timeoutId = setTimeout(() => {
        if (!markerFound) {
          // 终止进程
          session.process.kill('SIGTERM')
          cleanup()
          resolve(this.buildResult(
            session,
            stdout,
            stderr + '\n[Timeout: command execution exceeded ' + timeout + 'ms]',
            -1,
            startTime
          ))
        }
      }, timeout)

      // 发送命令
      // 如果指定了工作目录，先切换
      const cmds: string[] = []
      if (options.workingDir && options.workingDir !== session.currentDir) {
        cmds.push(`cd "${options.workingDir}"`)
      }
      cmds.push(command)
      cmds.push(`echo "${marker}"`)

      session.process.stdin?.write(cmds.join(' && ') + '\n')

      // 更新当前目录（如果命令中有 cd）
      this.updateCurrentDir(session, command)

      session.lastActivity = Date.now()
    })
  }

  /**
   * 更新会话当前目录
   */
  private updateCurrentDir(session: ShellSessionState, command: string): void {
    // 简单解析 cd 命令
    const cdMatch = command.match(/^cd\s+(.+)$/)
    if (cdMatch) {
      const targetDir = cdMatch[1].trim().replace(/^["']|["']$/g, '')
      if (targetDir.startsWith('/')) {
        session.currentDir = targetDir
      } else if (targetDir === '~' || targetDir === '$HOME') {
        session.currentDir = process.env.HOME || session.currentDir
      } else {
        session.currentDir = `${session.currentDir}/${targetDir}`.replace(/\/+/g, '/')
      }
    }
  }

  /**
   * 构建执行结果
   */
  private buildResult(
    session: ShellSessionState,
    stdout: string,
    stderr: string,
    exitCode: number,
    startTime: number
  ): BashOutput {
    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exit_code: exitCode,
      execution_time: Date.now() - startTime,
      current_dir: session.currentDir
    }
  }

  /**
   * 获取会话当前目录
   */
  getCurrentDir(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.currentDir
  }

  /**
   * 设置环境变量
   */
  setEnv(sessionId: string, key: string, value: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.env[key] = value
      session.process.stdin?.write(`export ${key}="${value}"\n`)
      session.lastActivity = Date.now()
    }
  }

  /**
   * 销毁会话
   */
  destroy(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.process.kill('SIGTERM')
      this.sessions.delete(sessionId)
      this.outputBuffer.delete(sessionId)
    }
  }

  /**
   * 销毁所有会话
   */
  destroyAll(): void {
    for (const [sessionId] of this.sessions) {
      this.destroy(sessionId)
    }
  }

  /**
   * 清理不活跃的会话
   */
  cleanupInactive(maxInactiveTime: number): void {
    const now = Date.now()
    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity > maxInactiveTime) {
        console.log(`[ShellSessionManager] Cleaning up inactive session: ${sessionId}`)
        this.destroy(sessionId)
      }
    }
  }

  /**
   * 获取会话列表
   */
  listSessions(): Array<{ id: string; currentDir: string; startTime: number; lastActivity: number }> {
    return Array.from(this.sessions.entries()).map(([id, session]) => ({
      id,
      currentDir: session.currentDir,
      startTime: session.startTime,
      lastActivity: session.lastActivity
    }))
  }
}

// 单例实例
export const sessionManager = new ShellSessionManager()
