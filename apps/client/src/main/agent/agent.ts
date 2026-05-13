import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import { AgentState, Message, ToolCall, ToolResult } from './types'
import { bashTool } from '../tools/bash'
import { browserTool } from '../tools/browser'
import { createLLMClient, LLMClient, ToolDefinition } from '../llm/client'

/**
 * 系统提示词
 * 定义了 AI 助手的角色、可用工具和响应方式
 */
const SYSTEM_PROMPT = `You are a helpful AI assistant that can use tools to help users accomplish your tasks.

You have access to the following tools:

1. **bash**: Execute bash commands on the local system. Use this to run shell commands, navigate directories, check files, and perform system operations.
2. **browser**: Control a web browser to navigate websites, interact with web pages, and extract information.

When you need to use a tool, use the tool_use block format. The system will execute the tool and return the result to you.

Be helpful, concise, and proactive. If a task requires multiple steps, break it down and execute them one by one.`

/**
 * Agent 配置接口
 */
export interface AgentConfig {
  /** API 密钥 */
  apiKey: string
  /** 模型名称 */
  model: string
  /** API 基础 URL（可选，默认使用 Anthropic） */
  baseURL?: string
  /** API 协议类型（可选，默认自动判断） */
  protocol?: 'anthropic-messages' | 'openai-chat-completion'
}

/**
 * Agent 类
 * 实现 AI Agent Loop 的核心逻辑
 *
 * Agent Loop 工作流程：
 * 1. 用户发送消息 → 添加到对话历史
 * 2. 调用 LLM 获取响应
 * 3. 如果响应包含工具调用请求 → 执行工具 → 将结果返回给 LLM → 回到步骤 2
 * 4. 如果响应是纯文本 → 结束循环，返回给用户
 */
export class Agent extends EventEmitter {
  private llmClient: LLMClient
  private state: AgentState
  private tools: ToolDefinition[]
  private toolExecutors: Map<string, (args: Record<string, unknown>) => Promise<unknown>>
  private config: AgentConfig

  constructor(config: AgentConfig) {
    super()
    this.config = config

    // 创建 LLM 客户端，根据配置自动选择合适的协议实现
    this.llmClient = createLLMClient(
      {
        id: 'default',
        name: 'Default',
        model: config.model,
        baseURL: config.baseURL || 'https://api.anthropic.com',
        protocol: config.protocol || 'anthropic-messages'
      },
      config.apiKey
    )

    // 初始化对话状态
    this.state = {
      messages: [],
      isProcessing: false,
      systemPrompt: SYSTEM_PROMPT
    }

    // 注册可用工具
    this.tools = [
      {
        name: bashTool.name,
        description: bashTool.description,
        parameters: bashTool.input_schema
      },
      {
        name: browserTool.name,
        description: browserTool.description,
        parameters: browserTool.input_schema
      }
    ]

    // 注册工具执行器
    this.toolExecutors = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>([
      [bashTool.name, (args) => bashTool.execute(args as { command: string; timeout?: number; working_dir?: string })],
      [browserTool.name, (args) => browserTool.execute(args as { action: string; url?: string; selector?: string; text?: string; direction?: 'up' | 'down'; amount?: number; wait_for?: 'load' | 'networkidle' | 'domcontentloaded' })]
    ])
  }

  /**
   * 发送用户消息并启动 Agent Loop
   * @param content - 用户消息内容
   */
  async sendMessage(content: string): Promise<void> {
    const userMessage: Message = {
      id: randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now()
    }

    this.state.messages.push(userMessage)
    this.emit('message', userMessage)

    await this.processLoop()
  }

  /**
   * Agent Loop 主循环
   * 控制多轮对话的执行流程
   */
  private async processLoop(): Promise<void> {
    if (this.state.isProcessing) return
    this.state.isProcessing = true
    this.emit('processing', true)

    try {
      let continueLoop = true

      // 持续循环直到模型不再请求工具调用
      while (continueLoop) {
        continueLoop = await this.processSingleTurn()
      }
    } finally {
      this.state.isProcessing = false
      this.emit('processing', false)
    }
  }

  /**
   * 单次对话回合处理
   * @returns 是否继续循环（true=模型请求了工具调用，需要继续）
   */
  private async processSingleTurn(): Promise<boolean> {
    // 将内部消息格式转换为 LLM 客户端格式
    const llmMessages = this.state.messages.map((msg) => {
      if (msg.tool_results) {
        // 工具执行结果转换为 tool 角色消息
        return msg.tool_results.map((tr) => ({
          role: 'tool' as const,
          tool_call_id: tr.tool_use_id,
          content: tr.content
        }))
      }
      return {
        role: msg.role,
        content: msg.content
      }
    }).flat()

    // 调用 LLM
    const response = await this.llmClient.chat(
      llmMessages,
      this.tools,
      this.state.systemPrompt
    )

    // 解析工具调用
    const toolCalls: ToolCall[] = response.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.name,
      input: JSON.parse(tc.arguments)
    })) || []

    // 创建助手消息
    const assistantMessage: Message = {
      id: randomUUID(),
      role: 'assistant',
      content: response.content,
      timestamp: Date.now(),
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined
    }

    this.state.messages.push(assistantMessage)
    this.emit('message', assistantMessage)

    // 如果没有工具调用，结束循环
    if (toolCalls.length === 0) {
      return false
    }

    // 执行工具调用
    const toolResults: ToolResult[] = []

    for (const toolCall of toolCalls) {
      this.emit('tool_start', { toolCall })

      try {
        const executor = this.toolExecutors.get(toolCall.name)
        if (!executor) {
          throw new Error(`Unknown tool: ${toolCall.name}`)
        }

        // 执行工具
        const result = await executor(toolCall.input)
        const formattedResult = this.formatToolResult(toolCall.name, result)

        const toolResult: ToolResult = {
          tool_use_id: toolCall.id,
          content: formattedResult,
          is_error: false
        }

        toolResults.push(toolResult)
        this.emit('tool_result', { toolCall, result: toolResult })
      } catch (error) {
        // 工具执行出错
        const toolResult: ToolResult = {
          tool_use_id: toolCall.id,
          content: `Error: ${error instanceof Error ? error.message : String(error)}`,
          is_error: true
        }

        toolResults.push(toolResult)
        this.emit('tool_result', { toolCall, result: toolResult })
      }
    }

    // 将工具结果添加到对话历史
    const toolResultsMessage: Message = {
      id: randomUUID(),
      role: 'user',
      content: this.formatToolResultsForAI(toolResults),
      timestamp: Date.now(),
      tool_results: toolResults
    }

    this.state.messages.push(toolResultsMessage)
    this.emit('tool_results', toolResultsMessage)

    // 需要继续循环，让 LLM 根据工具结果继续响应
    return true
  }

  /**
   * 格式化工具执行结果
   * @param toolName - 工具名称
   * @param result - 原始执行结果
   * @returns 格式化后的字符串
   */
  private formatToolResult(toolName: string, result: unknown): string {
    if (toolName === 'bash' && typeof result === 'object' && result !== null) {
      const bashResult = result as { stdout: string; stderr: string; exitCode: number }
      let output = ''
      if (bashResult.stdout) output += `STDOUT:\n${bashResult.stdout}\n`
      if (bashResult.stderr) output += `STDERR:\n${bashResult.stderr}\n`
      output += `Exit Code: ${bashResult.exitCode}`
      return output.trim()
    }

    if (typeof result === 'string') {
      return result
    }

    return JSON.stringify(result, null, 2)
  }

  /**
   * 格式化工具结果供 AI 阅读
   * 使用 XML 标签包裹，便于 Claude 等模型理解
   * @param toolResults - 工具结果列表
   * @returns 格式化后的字符串
   */
  private formatToolResultsForAI(toolResults: ToolResult[]): string {
    return toolResults
      .map(
        (tr) =>
          `<tool_result tool_use_id="${tr.tool_use_id}"${tr.is_error ? ' is_error="true"' : ''}>\n${tr.content}\n</tool_result>`
      )
      .join('\n\n')
  }

  /**
   * 获取所有对话消息
   * @returns 消息列表的副本
   */
  getMessages(): Message[] {
    return [...this.state.messages]
  }

  /**
   * 清空对话历史
   */
  clearHistory(): void {
    this.state.messages = []
    this.emit('history_cleared')
  }

  /**
   * 清理资源
   * 关闭浏览器等资源
   */
  async cleanup(): Promise<void> {
    await browserTool.close()
  }
}
