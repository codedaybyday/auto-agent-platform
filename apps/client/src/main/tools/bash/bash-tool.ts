/**
 * Bash Tool - 主工具类
 * 整合 Session Manager、Security、Process Registry
 */

import { BashInput, BashOutput, UserConfirmationCallback } from './types.js'
import { sessionManager } from './session-manager.js'
import { BashSecurity } from './security.js'
import { processRegistry } from './process-registry.js'

export interface BashToolOptions {
  /** 会话 ID */
  sessionId: string
  /** 安全策略 */
  securityPolicy?: Parameters<typeof BashSecurity.prototype.updatePolicy>[0]
  /** 用户确认回调 */
  confirmCallback?: UserConfirmationCallback
}

export class BashTool {
  name = 'bash'

  description = `Execute bash commands in a persistent shell session.

This tool runs commands in a persistent shell session, which means:
- 'cd' commands work as expected
- Environment variables persist between calls
- Background processes keep running

Capabilities:
- Run any shell command (ls, cat, grep, find, etc.)
- File operations (read, write, search)
- Process management (ps, kill)
- Package management (npm, pip, brew, etc.)
- Git operations
- Build and compilation

Security:
- Dangerous commands are blocked (rm -rf /, disk formatting, etc.)
- High-risk operations require user confirmation
- Execution timeout prevents runaway processes

Examples:
- List files: {"command": "ls -la"}
- Search code: {"command": "grep -r 'TODO' src/"}
- Check git status: {"command": "git status"}
- Install package: {"command": "npm install lodash"}
- Change directory: {"command": "cd ./subdir && pwd"}
`

  input_schema = {
    type: 'object' as const,
    properties: {
      command: {
        type: 'string',
        description: 'The bash command to execute'
      },
      working_dir: {
        type: 'string',
        description: 'Working directory (optional, defaults to current session directory)'
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 60000, max: 300000)',
        default: 60000,
        minimum: 1000,
        maximum: 300000
      },
      env: {
        type: 'object',
        description: 'Additional environment variables',
        additionalProperties: { type: 'string' }
      },
      restart: {
        type: 'boolean',
        description: 'Restart the shell session (clears all state including cd and env vars)',
        default: false
      }
    },
    required: ['command']
  }

  private security: BashSecurity
  private sessionId: string
  private confirmCallback?: UserConfirmationCallback

  constructor(options: BashToolOptions) {
    this.sessionId = options.sessionId
    this.security = new BashSecurity(options.securityPolicy)
    this.confirmCallback = options.confirmCallback
    if (options.confirmCallback) {
      this.security.setConfirmCallback(options.confirmCallback)
    }
  }

  /**
   * 执行 bash 命令
   */
  async execute(args: BashInput): Promise<BashOutput> {
    const startTime = Date.now()

    try {
      // 1. 安全检查
      const validation = await this.security.validate(args.command)
      if (!validation.safe) {
        return {
          stdout: '',
          stderr: validation.reason || 'Command blocked by security policy',
          exit_code: -1,
          execution_time: Date.now() - startTime
        }
      }

      // 2. 获取或创建会话
      if (args.restart) {
        sessionManager.destroy(this.sessionId)
      }
      const session = sessionManager.getOrCreate(this.sessionId, args.restart)

      // 3. 设置环境变量
      if (args.env) {
        for (const [key, value] of Object.entries(args.env)) {
          sessionManager.setEnv(this.sessionId, key, value)
        }
      }

      // 4. 执行命令
      const timeout = Math.min(
        args.timeout || 60000,
        this.security.getMaxExecutionTime()
      )

      const result = await sessionManager.execute(this.sessionId, args.command, {
        timeout,
        workingDir: args.working_dir
      })

      // 5. 截断输出
      const { output: truncatedStdout, truncated } = this.security.truncateOutput(result.stdout)
      if (truncated) {
        result.stdout = truncatedStdout
        result.truncated = true
      }

      return result

    } catch (error) {
      return {
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exit_code: -1,
        execution_time: Date.now() - startTime
      }
    }
  }

  /**
   * 获取当前工作目录
   */
  getCurrentDir(): string | undefined {
    return sessionManager.getCurrentDir(this.sessionId)
  }

  /**
   * 设置环境变量
   */
  setEnv(key: string, value: string): void {
    sessionManager.setEnv(this.sessionId, key, value)
  }

  /**
   * 销毁会话
   */
  destroy(): void {
    sessionManager.destroy(this.sessionId)
  }

  /**
   * 更新安全策略
   */
  updateSecurityPolicy(policy: Parameters<typeof BashSecurity.prototype.updatePolicy>[0]): void {
    this.security.updatePolicy(policy)
  }

  /**
   * 设置确认回调
   */
  setConfirmCallback(callback: UserConfirmationCallback): void {
    this.confirmCallback = callback
    this.security.setConfirmCallback(callback)
  }

  /**
   * 格式化输出结果（用于 LLM 消费）
   */
  formatResult(result: BashOutput): string {
    let output = ''

    if (result.stdout) {
      output += `STDOUT:\n${result.stdout}\n`
    }

    if (result.stderr) {
      output += `STDERR:\n${result.stderr}\n`
    }

    output += `Exit Code: ${result.exit_code}`

    if (result.execution_time) {
      output += `\nExecution Time: ${result.execution_time}ms`
    }

    if (result.current_dir) {
      output += `\nCurrent Directory: ${result.current_dir}`
    }

    if (result.truncated) {
      output += '\n[Output truncated due to length limit]'
    }

    return output.trim()
  }
}

// 导出单例工厂函数
export function createBashTool(sessionId: string, confirmCallback?: UserConfirmationCallback): BashTool {
  return new BashTool({ sessionId, confirmCallback })
}

// 导出默认实例（向后兼容）
export const bashTool = {
  name: 'bash',
  description: new BashTool({ sessionId: 'default' }).description,
  input_schema: new BashTool({ sessionId: 'default' }).input_schema,

  async execute(args: BashInput): Promise<BashOutput> {
    // 创建临时工具实例
    const tool = new BashTool({ sessionId: `temp_${Date.now()}` })
    return tool.execute(args)
  }
}
