/**
 * MCP Server - Client 端工具暴露
 *
 * 支持：
 * 1. 内置工具（browser, bash, file）
 * 2. 用户自定义工具（通过配置文件）
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  TextContent
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { browserController } from '../../tools/browser-use/index.js'
import { createBashTool } from '../../tools/bash/index.js'
import {
  fileReadTool,
  fileWriteTool,
  fileListTool,
  fileDeleteTool,
  fileStatsTool,
  workspaceStatsTool,
  setCurrentUser
} from '../../workspace/index.js'
import { loadMCPConfig, UserTool } from './config.js'
import { spawn } from 'child_process'
import { join } from 'path'

// ============ 内置工具 Schema ============
const BrowserNavigateSchema = z.object({
  url: z.string().describe('要导航到的 URL')
})

const BrowserClickSchema = z.object({
  ref: z.number().describe('元素引用 ID'),
  x: z.number().optional().describe('点击 X 坐标'),
  y: z.number().optional().describe('点击 Y 坐标')
})

const BrowserTypeSchema = z.object({
  ref: z.number().describe('元素引用 ID'),
  text: z.string().describe('要输入的文本'),
  submit: z.boolean().optional().describe('是否提交')
})

const BrowserScrollSchema = z.object({
  direction: z.enum(['up', 'down', 'left', 'right']).describe('滚动方向'),
  amount: z.number().optional().describe('滚动像素数，默认 300')
})

const BrowserScreenshotSchema = z.object({
  fullPage: z.boolean().optional().describe('是否截取全页面')
})

const BashSchema = z.object({
  command: z.string().describe('要执行的命令'),
  timeout: z.number().optional().describe('超时时间（毫秒），默认 30000'),
  workingDir: z.string().optional().describe('工作目录')
})

// 沙盒路径说明（用于工具描述）
const SANDBOX_PATH_DESC = '相对于沙盒根目录的路径，如 "projects/demo.py"，禁止使用绝对路径如 "/Users/xxx/file.py"'

const FileReadSchema = z.object({
  path: z.string().describe(SANDBOX_PATH_DESC),
  encoding: z.enum(['utf8', 'base64']).optional().describe('编码方式')
})

const FileWriteSchema = z.object({
  path: z.string().describe(SANDBOX_PATH_DESC),
  content: z.string().describe('文件内容'),
  encoding: z.enum(['utf8', 'base64']).optional().describe('编码方式'),
  append: z.boolean().optional().describe('是否追加模式')
})

const FileListSchema = z.object({
  path: z.string().optional().describe(SANDBOX_PATH_DESC + '，留空表示根目录')
})

const FileDeleteSchema = z.object({
  path: z.string().describe(SANDBOX_PATH_DESC)
})

const FileStatsSchema = z.object({
  path: z.string().describe(SANDBOX_PATH_DESC)
})

const WorkspaceStatsSchema = z.object({})

// 用户自定义工具的参数Schema（开放任意参数）
const UserToolSchema = z.object({}).passthrough()

// ============ Zod 转 JSON Schema ============
function zodToJsonSchema(zodType: z.ZodType): { type: 'object'; properties?: Record<string, object>; required?: string[]; [key: string]: unknown } {
  if (zodType instanceof z.ZodObject) {
    const shape = zodType.shape as Record<string, z.ZodType>
    const properties: Record<string, object> = {}
    const required: string[] = []

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = convertZodType(value)
      if (!(value instanceof z.ZodOptional)) {
        required.push(key)
      }
    }

    return {
      type: 'object',
      properties,
      required
    }
  }
  if (zodType instanceof z.ZodUnknown) {
    // 用户自定义工具：开放任意参数
    return {
      type: 'object',
      properties: {},
      required: []
    }
  }
  return { type: 'object' }
}

function convertZodType(zodType: z.ZodType): Record<string, unknown> {
  if (zodType instanceof z.ZodString) {
    return { type: 'string' }
  }
  if (zodType instanceof z.ZodNumber) {
    return { type: 'number' }
  }
  if (zodType instanceof z.ZodBoolean) {
    return { type: 'boolean' }
  }
  if (zodType instanceof z.ZodEnum) {
    return {
      type: 'string',
      enum: (zodType as unknown as { options: string[] }).options
    }
  }
  if (zodType instanceof z.ZodOptional) {
    return convertZodType((zodType as unknown as { unwrap: () => z.ZodType }).unwrap())
  }
  return { type: 'string' }
}

// ============ 工具注册表 ============
interface ToolResult {
  text: string
  isError?: boolean
}

type ToolHandler = (args: Record<string, unknown>) => Promise<string | ToolResult>

interface ToolRegistry {
  tools: Tool[]
  handlers: Map<string, ToolHandler>
}

const registry: ToolRegistry = {
  tools: [],
  handlers: new Map()
}

function registerTool(name: string, description: string, schema: z.ZodType, handler: ToolHandler): void {
  registry.tools.push({
    name,
    description,
    inputSchema: zodToJsonSchema(schema)
  })
  registry.handlers.set(name, handler)
}

// ============ 注册内置工具 ============
function registerBuiltInTools(config: { browser: boolean; bash: boolean; file: boolean }): void {
  const DEFAULT_SESSION_ID = 'mcp-default-session'

  if (config.browser) {
    registerTool('browser_navigate', '导航浏览器到指定 URL', BrowserNavigateSchema, async (args) => {
      const { url } = BrowserNavigateSchema.parse(args)
      const result = await browserController.executeAction(DEFAULT_SESSION_ID, { type: 'navigate', url })
      return result.message
    })

    registerTool('browser_click', '点击页面上的元素', BrowserClickSchema, async (args) => {
      const { ref } = BrowserClickSchema.parse(args)
      const result = await browserController.executeAction(DEFAULT_SESSION_ID, { type: 'click', index: ref })
      return result.message
    })

    registerTool('browser_type', '在输入框中输入文本', BrowserTypeSchema, async (args) => {
      const { ref, text } = BrowserTypeSchema.parse(args)
      const result = await browserController.executeAction(DEFAULT_SESSION_ID, { type: 'type', index: ref, text })
      return result.message
    })

    registerTool('browser_scroll', '滚动页面', BrowserScrollSchema, async (args) => {
      const { direction, amount } = BrowserScrollSchema.parse(args)
      const result = await browserController.executeAction(DEFAULT_SESSION_ID, { type: 'scroll', direction, amount })
      return result.message
    })

    registerTool('browser_screenshot', '截取页面截图', BrowserScreenshotSchema, async (args) => {
      const { fullPage } = BrowserScreenshotSchema.parse(args)
      const result = await browserController.executeAction(DEFAULT_SESSION_ID, { type: 'screenshot', fullPage })
      return result.message
    })

    registerTool('browser_get_context', '获取页面 DOM 上下文信息', z.object({}), async () => {
      const domState = await browserController.getPageState(DEFAULT_SESSION_ID)
      return JSON.stringify(domState, null, 2)
    })
  }

  if (config.bash) {
    registerTool('bash', '执行系统命令', BashSchema, async (args) => {
      const { command, timeout, workingDir } = BashSchema.parse(args)
      const bashTool = createBashTool(DEFAULT_SESSION_ID, async () => true)
      const result = await bashTool.execute({
        command,
        timeout,
        working_dir: workingDir
      })
      return result.exit_code === 0
        ? `执行成功:\n${result.stdout}`
        : `执行失败:\n${result.stderr || result.stdout}`
    })
  }

  if (config.file) {
    registerTool('file_read', '读取沙盒内文件内容', FileReadSchema, async (args) => {
      const { path, encoding } = FileReadSchema.parse(args)
      const result = await fileReadTool({ path, encoding })
      return result.success
        ? `文件内容:\n${result.content}`
        : { text: `读取失败: ${result.error}`, isError: true }
    })

    registerTool('file_write', '写入内容到沙盒内文件（自动创建目录）', FileWriteSchema, async (args) => {
      const { path, content, encoding, append } = FileWriteSchema.parse(args)
      const result = await fileWriteTool({ path, content, encoding, append })
      return result.success
        ? `写入成功: ${path}`
        : { text: `写入失败: ${result.error}`, isError: true }
    })

    registerTool('file_list', '列出沙盒内指定目录的文件和子目录', FileListSchema, async (args) => {
      const { path } = FileListSchema.parse(args)
      const result = await fileListTool({ path })
      if (!result.success) {
        return { text: `列出目录失败: ${result.error}`, isError: true }
      }
      const filesList = result.files?.map(f => `${f.type === 'directory' ? '📁' : '📄'} ${f.name}`).join('\n')
      return `目录内容 (${path || '根目录'}):\n${filesList || '(空目录)'}`
    })

    registerTool('file_delete', '删除沙盒内的文件或目录', FileDeleteSchema, async (args) => {
      const { path } = FileDeleteSchema.parse(args)
      const result = await fileDeleteTool({ path })
      return result.success
        ? `删除成功: ${path}`
        : { text: `删除失败: ${result.error}`, isError: true }
    })

    registerTool('file_stats', '获取沙盒内文件或目录的详细信息', FileStatsSchema, async (args) => {
      const { path } = FileStatsSchema.parse(args)
      const result = await fileStatsTool({ path })
      if (!result.success) {
        return { text: `获取信息失败: ${result.error}`, isError: true }
      }
      const s = result.stats!
      return `文件信息:\n- 路径: ${s.path}\n- 类型: ${s.type}\n- 大小: ${s.size} bytes\n- 创建: ${s.created}\n- 修改: ${s.modified}`
    })

    registerTool('workspace_stats', '获取用户工作空间的统计信息（容量使用情况）', WorkspaceStatsSchema, async () => {
      const result = await workspaceStatsTool()
      if (!result.success) {
        return { text: `获取统计失败: ${result.error}`, isError: true }
      }
      const d = result.data!
      return `工作空间统计:\n- 用户: ${d.userId}\n- 路径: ${d.sandboxPath}\n- 使用: ${(d.size / 1024 / 1024).toFixed(2)} MB / ${(d.maxSize / 1024 / 1024).toFixed(0)} MB (${d.usagePercent}%)\n- 文件数: ${d.fileCount} / ${d.maxFiles}`
    })
  }
}

// ============ 注册用户自定义工具 ============
function registerUserTools(userTools: UserTool[]): void {
  for (const userTool of userTools) {
    registerTool(
      userTool.name,
      userTool.description,
      UserToolSchema,
      createUserToolHandler(userTool)
    )
  }
}

function createUserToolHandler(userTool: UserTool): ToolHandler {
  return async (args: Record<string, unknown>): Promise<string> => {
    // JS 模块方式
    if (userTool.script) {
      try {
        const modulePath = join(process.cwd(), userTool.script)
        const module = await import(modulePath)
        const fn = userTool.function ? module[userTool.function] : module.default
        if (typeof fn !== 'function') {
          throw new Error(`Function ${userTool.function || 'default'} not found in ${userTool.script}`)
        }
        return await fn(args)
      } catch (error) {
        throw new Error(`User tool execution failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // 命令行方式
    if (userTool.command) {
      return new Promise((resolve, reject) => {
        const child = spawn(userTool.command!, userTool.args || [], {
          cwd: userTool.workingDir,
          env: { ...process.env, ...userTool.env },
          shell: true
        })

        let stdout = ''
        let stderr = ''

        child.stdout?.on('data', (data) => {
          stdout += data.toString()
        })

        child.stderr?.on('data', (data) => {
          stderr += data.toString()
        })

        child.on('close', (code) => {
          if (code === 0) {
            resolve(stdout || '执行成功')
          } else {
            reject(new Error(stderr || `Exit code: ${code}`))
          }
        })

        child.on('error', (error) => {
          reject(new Error(`Spawn error: ${error.message}`))
        })
      })
    }

    throw new Error(`User tool ${userTool.name} has no command or script defined`)
  }
}

// ============ 启动 MCP Server ============
export async function startMCPServer(): Promise<void> {
  console.error('[MCP Server] Starting Auto Agent Client MCP Server...')

  // 设置当前用户（从环境变量获取，默认 'default'）
  const userId = process.env.AUTOAGENT_USER_ID || 'default'
  setCurrentUser(userId)
  console.error('[MCP Server] User set:', userId)

  // 加载配置
  const config = loadMCPConfig()
  console.error('[MCP Server] Config loaded:', {
    builtIn: config.builtInTools,
    userTools: config.userTools.length
  })

  // 注册工具
  registerBuiltInTools(config.builtInTools)
  registerUserTools(config.userTools)

  console.error('[MCP Server] Tools registered:', registry.tools.map(t => t.name).join(', '))
  console.error('[MCP Server] Workspace path:', process.env.AUTOAGENT_WORKSPACE_PATH || '(default: ~/AutoAgentWorkspace)')

  // 创建 MCP Server
  const server = new Server(
    {
      name: 'auto-agent-client-mcp-server',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  )

  // 处理工具列表请求
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    console.error('[MCP Server] ListTools called, returning', registry.tools.length, 'tools')
    return { tools: registry.tools }
  })

  // 处理工具调用请求
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    console.error('[MCP Server] CallTool:', name, args)

    const handler = registry.handlers.get(name)
    if (!handler) {
      const content: TextContent[] = [{
        type: 'text',
        text: `Unknown tool: ${name}`
      }]
      return { content, isError: true }
    }

    try {
      const result = await handler(args as Record<string, unknown>)

      // 支持返回字符串或 ToolResult 对象
      const text = typeof result === 'string' ? result : result.text
      const isError = typeof result === 'string' ? false : result.isError

      const content: TextContent[] = [{
        type: 'text',
        text
      }]
      return isError ? { content, isError: true } : { content }
    } catch (error) {
      console.error('[MCP Server] Tool execution error:', error)
      const content: TextContent[] = [{
        type: 'text',
        text: `错误: ${error instanceof Error ? error.message : String(error)}`
      }]
      return { content, isError: true }
    }
  })

  // 启动 stdio 传输
  const transport = new StdioServerTransport()
  await server.connect(transport)

  console.error('[MCP Server] MCP Server running on stdio')
}

// 如果是直接运行此文件，则启动服务器
if (import.meta.url === `file://${process.argv[1]}`) {
  startMCPServer().catch((error) => {
    console.error('[MCP Server] Fatal error:', error)
    process.exit(1)
  })

  // 优雅退出
  process.on('SIGINT', async () => {
    console.error('[MCP Server] Received SIGINT, shutting down...')
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    console.error('[MCP Server] Received SIGTERM, shutting down...')
    process.exit(0)
  })
}
