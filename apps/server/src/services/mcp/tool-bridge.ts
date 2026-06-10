/**
 * MCP Tool Bridge
 * 基于 MCP 协议的工具执行桥接层（WebSocket 桥接版）
 *
 * 架构：
 * - Server (MCP Client) <--WebSocket--> Client (本地 MCP Server) <--stdio--> Tools
 * - 每个会话有独立的工具调用通道
 */

import type { ToolCall, ToolResult } from '../../types/index.js'
import { toolRegistry } from './registry.js'
import { mcpHub } from './hub.js'
import { log } from '@auto-agent/shared-utils'

export interface ToolBridgeConfig {
  sessionId: string
  userId: string
}

export class MCPToolBridge {
  private sessionId: string
  private userId: string

  constructor(config: ToolBridgeConfig) {
    this.sessionId = config.sessionId
    this.userId = config.userId
  }

  /**
   * 执行工具
   * 优先检查内置工具，否则通过 WebSocket 桥接到客户端
   */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const startTime = Date.now()
    const toolName = toolCall.name

    log.info('MCPToolBridge', `Executing tool: ${toolName}`, {
      sessionId: this.sessionId,
      userId: this.userId,
      args: toolCall.arguments
    })

    // 首先检查是否是内置工具（直接执行）
    const tool = toolRegistry.getTool(toolName)
    if (tool?.source === 'builtin' && tool.executor) {
      log.info('MCPToolBridge', `Executing builtin tool: ${toolName}`)
      try {
        const result = await tool.executor(
          toolCall.arguments as Record<string, unknown>,
          {
            sessionId: this.sessionId,
            userId: this.userId
          }
        )
        return {
          toolCallId: toolCall.id,
          success: result.success,
          data: result.data,
          error: result.error,
          metadata: result.metadata,
          executionTime: Date.now() - startTime
        }
      } catch (error) {
        log.error('MCPToolBridge', `Builtin tool execution failed: ${toolName}`, error)
        return {
          toolCallId: toolCall.id,
          success: false,
          error: error instanceof Error ? error.message : 'Tool execution failed',
          executionTime: Date.now() - startTime
        }
      }
    }

    // 非内置工具，通过 MCPHub 调用（WebSocket 桥接）
    try {
      const result = await mcpHub.callTool(
        this.sessionId,
        this.userId,
        toolName,
        toolCall.arguments as Record<string, unknown>
      )

      // 转换结果为 ToolResult
      const content = result.content?.[0]
      const textContent = content && 'text' in content ? content.text : JSON.stringify(result.content)

      return {
        toolCallId: toolCall.id,
        success: !result.isError,
        data: result.isError ? undefined : textContent,
        error: result.isError ? textContent : undefined,
        executionTime: Date.now() - startTime
      }
    } catch (error) {
      log.error('MCPToolBridge', `Tool execution failed: ${toolName}`, error)
      return {
        toolCallId: toolCall.id,
        success: false,
        error: error instanceof Error ? error.message : 'Tool execution failed',
        executionTime: Date.now() - startTime
      }
    }
  }

  /**
   * 获取可用工具列表（用于发送给 LLM）
   * 合并内置工具和 MCP 工具，转换为 OpenAI 工具格式
   */
  async getAvailableTools() {
    const allTools: any[] = []

    // 1. 获取内置工具
    const builtinTools = toolRegistry.getAllTools()
      .filter(tool => tool.name && !tool.name.includes('.')) // 内置工具名不含点号
      .map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description || '',
          parameters: tool.inputSchema || { type: 'object', properties: {} }
        }
      }))
    allTools.push(...builtinTools)

    // 2. 从 MCPHub 获取客户端工具（MCP 格式）
    try {
      const mcpTools = await mcpHub.listTools(this.sessionId, this.userId)
      const formattedMcpTools = mcpTools
        .filter((tool: any) => tool && tool.name)
        .map((tool: any) => {
          // 工具名格式: sessionId.local-tools.sessionId.toolName
          // 需要去掉前缀，只保留最后的 toolName
          let cleanName = tool.name
          // 去掉 sessionId.local-tools. 前缀
          cleanName = cleanName.replace(new RegExp(`^${this.sessionId}\.local-tools\.`), '')
          // 再去掉可能残留的 sessionId. 前缀
          cleanName = cleanName.replace(new RegExp(`^${this.sessionId}\.`), '')
          return {
            type: 'function',
            function: {
              name: cleanName,
              description: tool.description || '',
              parameters: tool.inputSchema || { type: 'object', properties: {} }
            }
          }
        })
      allTools.push(...formattedMcpTools)
    } catch (error) {
      log.warn('MCPToolBridge', `Failed to get MCP tools`, error)
    }

    return allTools
  }

  /**
   * 初始化会话的 MCP 连接
   */
  async initialize(): Promise<void> {
    log.info('MCPToolBridge', `Initializing MCP for session: ${this.sessionId}`)
    await mcpHub.initializeForSession(this.sessionId, this.userId)
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    log.info('MCPToolBridge', `Cleaning up session: ${this.sessionId}`)
    mcpHub.cleanupSession(this.sessionId).catch(err => {
      log.warn('MCPToolBridge', `Failed to cleanup session ${this.sessionId}`, err)
    })
  }
}
