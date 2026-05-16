/**
 * Bash 工具类型定义
 */

export interface BashInput {
  /** 要执行的命令 */
  command: string
  /** 工作目录（可选，默认继承 session 当前目录） */
  working_dir?: string
  /** 超时（毫秒，默认 60000） */
  timeout?: number
  /** 环境变量 */
  env?: Record<string, string>
  /** 是否重启会话（清除所有状态） */
  restart?: boolean
}

export interface BashOutput {
  /** 标准输出 */
  stdout: string
  /** 标准错误 */
  stderr: string
  /** 退出码 */
  exit_code: number
  /** 执行时长（毫秒） */
  execution_time: number
  /** 当前工作目录 */
  current_dir?: string
  /** 是否被截断 */
  truncated?: boolean
}

export interface ShellSessionState {
  id: string
  process: import('child_process').ChildProcess
  currentDir: string
  env: Record<string, string>
  startTime: number
  lastActivity: number
}

export interface SecurityPolicy {
  /** 危险命令黑名单（正则表达式列表） */
  blockedPatterns: RegExp[]
  /** 允许的路径前缀 */
  allowedPaths: string[]
  /** 最大执行时间（毫秒） */
  maxExecutionTime: number
  /** 最大输出长度 */
  maxOutputSize: number
  /** 是否需要用户确认 */
  requireConfirmation: boolean
  /** 需要确认的命令模式 */
  confirmationPatterns: RegExp[]
}

export interface ProcessInfo {
  id: string
  sessionId: string
  command: string
  startTime: number
  status: 'running' | 'completed' | 'failed'
  exitCode?: number
  stdout: string[]
  stderr: string[]
}

export type UserConfirmationCallback = (
  command: string,
  riskLevel: 'low' | 'medium' | 'high'
) => Promise<boolean>
