import { spawn } from 'child_process'
import { BashResult } from '../agent/types'

export class BashTool {
  name = 'bash'
  description = 'Execute bash commands on the local system. Use this to run shell commands, navigate directories, check files, and perform system operations.'

  input_schema = {
    type: 'object' as const,
    properties: {
      command: {
        type: 'string',
        description: 'The bash command to execute'
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
        default: 30000
      },
      working_dir: {
        type: 'string',
        description: 'Working directory for the command (default: current directory)'
      }
    },
    required: ['command']
  }

  async execute(args: { command: string; timeout?: number; working_dir?: string }): Promise<BashResult> {
    const { command, timeout = 30000, working_dir } = args

    return new Promise((resolve) => {
      const options = working_dir ? { cwd: working_dir } : {}

      const child = spawn('bash', ['-c', command], {
        ...options,
        shell: false
      })

      let stdout = ''
      let stderr = ''

      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM')
        resolve({
          stdout,
          stderr: stderr || 'Command timed out',
          exitCode: -1
        })
      }, timeout)

      child.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      child.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      child.on('close', (code) => {
        clearTimeout(timeoutId)
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code ?? 0
        })
      })

      child.on('error', (error) => {
        clearTimeout(timeoutId)
        resolve({
          stdout: '',
          stderr: error.message,
          exitCode: -1
        })
      })
    })
  }

  formatResult(result: BashResult): string {
    let output = ''
    if (result.stdout) {
      output += `STDOUT:\n${result.stdout}\n`
    }
    if (result.stderr) {
      output += `STDERR:\n${result.stderr}\n`
    }
    output += `Exit Code: ${result.exitCode}`
    return output.trim()
  }
}

export const bashTool = new BashTool()
