/**
 * MCP 工具注册表
 * 统一管理内置工具和 MCP 工具
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { log } from '@auto-agent/shared-utils'
import type { ToolCall, ToolResult } from '../../types/index.js'

// 内置工具返回的结果（不含 toolCallId 和 executionTime，由调用方添加）
export interface BuiltinToolResult {
  success: boolean
  data?: any
  error?: string
  metadata?: {
    screenshot?: string
    logs?: string[]
  }
}

// 内置工具的执行函数类型
export type BuiltinToolExecutor = (
  args: Record<string, unknown>,
  context: ToolExecutionContext
) => Promise<BuiltinToolResult>

export interface ToolExecutionContext {
  sessionId: string
  userId: string
  wsClient?: {
    isAlive: boolean
    socket: WebSocket
  }
}

// 统一的工具定义
export interface RegisteredTool {
  // 工具来源
  source: 'builtin' | 'mcp'
  // MCP 工具信息
  serverName?: string
  // 工具定义
  definition: Tool
  // 内置工具的执行函数
  executor?: BuiltinToolExecutor
}

// 参数定义的 Zod 到 JSON Schema 转换
export function zodToJsonSchema(zodSchema: z.ZodType): Record<string, unknown> {
  // 简化实现，将 Zod 类型转换为 JSON Schema
  const def: Record<string, unknown> = {
    type: 'object',
    properties: {},
    required: []
  }

  if (zodSchema instanceof z.ZodObject) {
    const shape = zodSchema.shape as Record<string, z.ZodType>
    for (const [key, value] of Object.entries(shape)) {
      def.properties![key] = zodTypeToJsonSchema(value)
      if (!(value instanceof z.ZodOptional)) {
        (def.required as string[]).push(key)
      }
    }
  }

  return def
}

function zodTypeToJsonSchema(zodType: z.ZodType): Record<string, unknown> {
  if (zodType instanceof z.ZodString) {
    return { type: 'string' }
  }
  if (zodType instanceof z.ZodNumber) {
    return { type: 'number' }
  }
  if (zodType instanceof z.ZodBoolean) {
    return { type: 'boolean' }
  }
  if (zodType instanceof z.ZodArray) {
    return {
      type: 'array',
      items: zodTypeToJsonSchema(zodType.element)
    }
  }
  if (zodType instanceof z.ZodOptional) {
    return zodTypeToJsonSchema(zodType.unwrap())
  }
  if (zodType instanceof z.ZodObject) {
    return zodToJsonSchema(zodType)
  }
  if (zodType instanceof z.ZodEnum) {
    return {
      type: 'string',
      enum: zodType.options
    }
  }

  return { type: 'string' }
}

export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map()

  /**
   * 注册内置工具
   */
  registerBuiltin(
    name: string,
    description: string,
    parameters: z.ZodType,
    executor: BuiltinToolExecutor
  ): void {
    if (this.tools.has(name)) {
      log.warn('ToolRegistry', `Tool ${name} already registered, overwriting`)
    }

    const tool: RegisteredTool = {
      source: 'builtin',
      definition: {
        name,
        description,
        inputSchema: zodToJsonSchema(parameters)
      },
      executor
    }

    this.tools.set(name, tool)
    log.info('ToolRegistry', `Registered builtin tool: ${name}`)
  }

  /**
   * 注册 MCP 工具
   */
  registerMCP(serverName: string, tool: Tool): void {
    const fullName = `${serverName}.${tool.name}`

    if (this.tools.has(fullName)) {
      log.warn('ToolRegistry', `Tool ${fullName} already registered, overwriting`)
    }

    const registeredTool: RegisteredTool = {
      source: 'mcp',
      serverName,
      definition: {
        name: fullName,  // 使用 server.tool 格式避免冲突
        description: `[${serverName}] ${tool.description}`,
        inputSchema: tool.inputSchema
      }
    }

    this.tools.set(fullName, registeredTool)
    log.info('ToolRegistry', `Registered MCP tool: ${fullName}`)
  }

  /**
   * 移除 MCP Server 的所有工具
   */
  unregisterMCPServer(serverName: string): void {
    const prefix = `${serverName}.`
    for (const name of this.tools.keys()) {
      if (name.startsWith(prefix)) {
        this.tools.delete(name)
        log.info('ToolRegistry', `Unregistered MCP tool: ${name}`)
      }
    }
  }

  /**
   * 获取工具
   */
  getTool(name: string): RegisteredTool | undefined {
    return this.tools.get(name)
  }

  /**
   * 获取所有工具定义 (用于发送给 LLM)
   */
  getAllTools(): Tool[] {
    return Array.from(this.tools.values()).map(t => t.definition)
  }

  /**
   * 检查工具是否存在
   */
  hasTool(name: string): boolean {
    return this.tools.has(name)
  }

  /**
   * 获取工具数量统计
   */
  getStats(): { builtin: number; mcp: number } {
    let builtin = 0
    let mcp = 0

    for (const tool of this.tools.values()) {
      if (tool.source === 'builtin') builtin++
      else mcp++
    }

    return { builtin, mcp }
  }
}

// 全局单例
export const toolRegistry = new ToolRegistry()
