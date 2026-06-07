/**
 * Agent Loop 服务
 * 核心 ReAct (Reasoning + Acting) 循环实现
 */

import EventEmitter from 'events'
import type {
  AgentLoopConfig,
  LoopState,
  Message,
  ToolCall,
  ToolResult,
  LLMResponse,
  AgentError
} from '../../types/index.js'
import { LLMClient, LLMAPIError } from '../llm/client.js'
import { ShortTermMemory } from '../memory/short-term.js'
import { MCPToolBridge } from '../mcp/tool-bridge.js'
import { log } from '@auto-agent/shared-utils'

export interface AgentLoopEvents {
  'run_start': { input: string; timestamp: number }
  'run_complete': { output: string; timestamp: number }
  'run_error': { error: Error; timestamp: number }
  'run_paused': { timestamp: number }
  'iteration_start': { iteration: number; timestamp: number }
  'tool_start': { toolCall: ToolCall; timestamp: number }
  'tool_end': { toolCall: ToolCall; result: ToolResult; timestamp: number }
  'stream_chunk': { content?: string; reasoning?: string }
}

export class AgentLoop extends EventEmitter {
  private state: LoopState
  private config: AgentLoopConfig
  private toolBridge: MCPToolBridge
  private llmClient: LLMClient
  private userId: string
  private wsClient: any = null
  private shortTermMemory: ShortTermMemory

  constructor(
    sessionId: string,
    userId: string,
    config: Partial<AgentLoopConfig> = {}
  ) {
    super()
    this.userId = userId
    this.state = {
      sessionId,
      status: 'idle',
      iteration: 0,
      messages: []
    }
    this.config = {
      baseURL: config.baseURL,
      maxIterations: config.maxIterations || 10,
      model: config.model || 'gpt-4',
      systemPrompt: config.systemPrompt || this.getDefaultSystemPrompt()
    }
    this.llmClient = new LLMClient({ model: this.config.model, baseURL: config.baseURL}, undefined)
    this.toolBridge = new MCPToolBridge({ sessionId, userId })

    // 初始化短期记忆（Tier 1 + Tier 2）
    this.shortTermMemory = new ShortTermMemory({
      fullContextRounds: config.fullContextRounds ?? 5,
      maxCompressedRounds: config.maxCompressedRounds ?? 20,
      compression: config.compression ?? {
        model: process.env.COMPRESSION_MODEL ?? process.env.LLM_MODEL ?? 'gpt-4o-mini',
        baseURL: process.env.COMPRESSION_BASE_URL ?? process.env.LLM_BASE_URL ?? config.baseURL,
        apiKey: process.env.COMPRESSION_API_KEY ?? process.env.LLM_API_KEY,
        temperature: 0.3,
        timeout: 10000,
        maxRetries: 2
      },
      debug: process.env.DEBUG_MEMORY === 'true'
    })
  }

  /**
   * 核心循环：ReAct 范式
   * Observation -> Thought -> Action -> (Repeat)
   */
  async run(userInput: string): Promise<void> {
    log.info('AgentLoop', '========== 开始新任务 ==========')
    log.info('AgentLoop', `输入: ${userInput.substring(0, 100)}${userInput.length > 100 ? '...' : ''}`)
    log.info('AgentLoop', `会话ID: ${this.state.sessionId}`)
    log.info('AgentLoop', `用户ID: ${this.userId}`)
    log.info('AgentLoop', `模型: ${this.config.model}`)
    log.info('AgentLoop', `是否本地模型: ${this.llmClient.isLocal}`)

    // 初始化 MCP 连接（如果是该用户的第一个会话）
    try {
      await this.toolBridge.initialize()
    } catch (error) {
      log.error('AgentLoop', 'Failed to initialize MCP connection:', error)
      this.state.status = 'error'
      this.emit('run_error', { error: new Error('MCP 连接初始化失败'), timestamp: Date.now() })
      throw error
    }

    // 初始化
    this.state.status = 'running'
    this.state.iteration = 0
    const userMessage: Message = {
      id: this.generateId(),
      role: 'user',
      content: userInput,
      timestamp: Date.now()
    }
    this.addMessage(userMessage)

    this.emit('run_start', { input: userInput, timestamp: Date.now() })

    // 如果使用 Ollama 本地模型，先检查连接
    if (this.llmClient.isLocal) {
      const checkResult = await this.llmClient.checkOllamaConnection()
      if (!checkResult.ok) {
        this.state.status = 'error'
        const error = new LLMAPIError(checkResult.message, 503)
        this.emit('run_error', { error, timestamp: Date.now() })
        throw error
      }
      log.info('AgentLoop', checkResult.message)
    }

    try {
      // ========== LOOP START ==========
      while (this.state.iteration < this.config.maxIterations) {
        this.state.iteration++

        this.emit('iteration_start', {
          iteration: this.state.iteration,
          timestamp: Date.now()
        })

        // Step 1: Observation（构建上下文）
        const context = this.buildContext()
        log.debug('AgentLoop', `迭代 ${this.state.iteration} - 构建上下文: ${context.length} 条消息`, context)

        // Step 2: Thought（LLM 思考）
        log.info('AgentLoop', 'Calling LLM...')
        const llmResponse = await this.callLLM(context)

        // Step 3: 判断是 Action 还是 Final Answer
        if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
          // 需要执行工具（Action）
          this.state.status = 'waiting_tool'
          log.info('AgentLoop', `检测到 ${llmResponse.toolCalls.length} 个工具调用`)

          for (const toolCall of llmResponse.toolCalls) {
            log.debug('AgentLoop', `执行工具: ${toolCall.name}`, toolCall)

            // 通知前端工具开始执行
            this.emit('tool_start', {
              toolCall,
              timestamp: Date.now()
            })

            // 执行工具（可能走 WebSocket 到客户端）
            const result = await this.executeTool(toolCall)
            log.perf('AgentLoop', `工具 ${toolCall.name}`, result.executionTime || 0)

            // 添加工具结果到上下文（Observation）
            this.addToolResult(toolCall, result)

            // 通知前端工具执行完成
            this.emit('tool_end', {
              toolCall,
              result,
              timestamp: Date.now()
            })
          }

          // LOOP CONTINUE: 带着工具结果继续循环
          log.info('AgentLoop', '继续循环，等待 LLM 处理工具结果')
          continue
        } else {
          // 得到最终答案，结束循环
          log.success('AgentLoop', '得到最终答案，结束循环')
          this.state.status = 'completed'
          this.emit('run_complete', {
            output: llmResponse.content || '',
            timestamp: Date.now()
          })
          log.success('AgentLoop', '========== 任务完成 ==========')
          break
        }
      }
      // ========== LOOP END ==========

      // 超过最大迭代次数
      if (this.state.iteration >= this.config.maxIterations) {
        this.state.status = 'error'
        const error = new Error('思考次数过多，请简化问题')
        this.emit('run_error', { error, timestamp: Date.now() })
        throw error
      }
    } catch (error) {
      this.state.status = 'error'
      log.error('AgentLoop', '执行错误', error)

      // 处理 LLM API 错误，提供友好错误消息
      let friendlyError: Error
      if (error instanceof LLMAPIError) {
        friendlyError = error
      } else if (error instanceof Error) {
        // 检查是否是配额超限错误（某些情况下可能不是 LLMAPIError）
        if (error.message.includes('429') || error.message.includes('达到使用量上限')) {
          friendlyError = new LLMAPIError('API 使用量已达上限，请检查您的账户余额或联系服务提供商', 429)
        } else {
          friendlyError = error
        }
      } else {
        friendlyError = new Error(String(error))
      }

      this.emit('run_error', {
        error: friendlyError,
        timestamp: Date.now()
      })
      throw friendlyError
    }
  }

  /**
   * 暂停循环
   */
  pause(): void {
    if (this.state.status === 'running') {
      this.state.status = 'paused'
      this.emit('run_paused', { timestamp: Date.now() })
    }
  }

  /**
   * 恢复循环
   */
  resume(): void {
    if (this.state.status === 'paused') {
      this.state.status = 'running'
      // 继续执行...
      // 实际实现需要保存上下文并恢复
    }
  }

  /**
   * 停止循环
   */
  stop(): void {
    this.state.status = 'completed'
  }

  /**
   * 清理资源
   * 通知客户端清理工具，清理 pending 请求
   */
  async cleanup(): Promise<void> {
    log.info('AgentLoop', `${this.state.sessionId} - Starting cleanup...`)

    // 1. 停止循环
    this.stop()

    // 2. 清理 ToolBridge 的 pending 请求
    this.toolBridge.cleanup()

    // 3. 通知客户端清理本地工具（发送 WebSocket 消息）
    try {
      await this.notifyClientCleanup()
    } catch (error) {
      log.error('AgentLoop', `${this.state.sessionId} - Failed to notify client cleanup`, error)
    }

    // 4. 移除所有监听器
    this.removeAllListeners()

    log.success('AgentLoop', `${this.state.sessionId} - Cleanup completed`)
  }

  /**
   * 通知客户端清理本地工具资源
   */
  private async notifyClientCleanup(): Promise<void> {
    log.info('AgentLoop', `${this.state.sessionId} - Notifying client to cleanup tools`)

    if (!this.wsClient) {
      log.warn('AgentLoop', `${this.state.sessionId} - No WebSocket client bound, skipping notification`)
      return
    }

    // 发送清理命令到客户端
    const cleanupMessage = {
      type: 'tool.cleanup' as import('../../types/index.js').MessageType,
      messageId: this.generateId(),
      timestamp: Date.now(),
      sessionId: this.state.sessionId,
      payload: {
        reason: 'session_closed'
      }
    }

    try {
      this.wsClient.socket?.send(JSON.stringify(cleanupMessage))
      log.success('AgentLoop', `${this.state.sessionId} - Cleanup notification sent to client`)
    } catch (error) {
      log.error('AgentLoop', `${this.state.sessionId} - Failed to send cleanup notification`, error)
    }
  }

  /**
   * 获取当前状态
   */
  getState(): LoopState {
    return { ...this.state }
  }

  /**
   * 获取历史消息（用于外部访问，如 API）
   */
  getMessages(): Message[] {
    return this.shortTermMemory.getAllMessages()
  }

  /**
   * 清除历史消息
   */
  clearMessages(): void {
    this.shortTermMemory.clear()
    this.state.messages = []
  }

  /**
   * 获取短期记忆统计信息
   */
  getMemoryStats(): ReturnType<ShortTermMemory['getStats']> {
    return this.shortTermMemory.getStats()
  }

  /**
   * 绑定 WebSocket 客户端（用于工具调用）
   */
  bindWebSocket(wsClient: any): void {
    this.wsClient = wsClient
    // WebSocket 已在 MCPHub 中绑定，这里只需保存引用
  }

  private getDefaultSystemPrompt(): string {
    return `## 角色
你是一个智能助手，帮助用户完成各类任务。回复使用中文。

## 可用工具
- browser_ai: 浏览器自动化（导航、点击、输入、搜索等）
- bash: 执行系统命令
- file_read/file_write: 文件读写

## 核心原则：区分"询问"与"操作"

用户的请求分为两类，你的响应策略截然不同：

### 1. 信息询问（默认）
用户想要获取信息、知识、建议、解释。特征：
- 包含疑问词："什么是"、"如何"、"为什么"、"查询"、"了解"
- 寻求概念、原理、方法、分析
- 不涉及改变外部世界的状态

**策略：直接回答，不使用工具。**
- 基于你的训练知识回答
- 不需要验证最新数据
- 不需要创建文件或执行命令

### 2. 操作指令
用户想要改变外部世界的状态。特征：
- 明确的动作动词："打开"、"执行"、"创建"、"修改"、"运行"
- 目标是完成某个动作，而非获取信息
- 会产生副作用（文件被修改、浏览器跳转、命令执行）

**策略：使用工具完成操作。**

## 决策流程

面对用户输入时，按此顺序判断：

1. 用户是在问问题，还是下指令？
2. 如果是问问题 → 直接回答
3. 如果是指令 → 选择合适的工具执行

## 示例

用户："什么是二叉树" → 直接解释概念
用户："打开百度搜索二叉树" → 使用 browser_ai
用户："如何学习 Python" → 直接给出学习路径建议
用户："创建一个 Python 文件" → 使用 file_write

## 禁止事项

- 不要以"确认数据"为由使用工具回答知识性问题
- 不要主动提供超出用户请求的操作
- 不要混淆"用户想了解某事"和"用户想做某事"`
  }

  private buildContext(): Message[] {
    // 使用短期记忆构建上下文（包含 Tier 1 完整消息 + Tier 2 压缩摘要）
    return this.shortTermMemory.getContextMessages(this.config.systemPrompt)
  }

  private async callLLM(messages: Message[], useStream: boolean = true): Promise<LLMResponse> {
    log.debug('AgentLoop', `调用 LLM，消息数: ${messages.length}`, { totalMessages: messages.length, useStream })

    // 获取可用工具列表（从 MCP ToolBridge - 异步）
    const tools = await this.toolBridge.getAvailableTools()
    log.debug('AgentLoop', `可用工具: ${tools.length} 个`, tools.map(t => t.name))

    let response: LLMResponse

    if (useStream) {
      // SSE 流式模式 - 逐字实时推送到前端
      let fullContent = ''
      let fullReasoningContent = ''
      let accumulatedToolCalls: any[] = []

      response = await this.llmClient.streamChat(
        messages,
        (chunk, toolCallDelta) => {
          // 实时发送 SSE 格式 chunk 到前端
          if (chunk) {
            fullContent += chunk
            this.emit('stream_chunk', {
              type: 'sse',
              event: 'content',
              data: chunk,
              sessionId: this.state.sessionId
            })
          }
          // 累积 tool_calls（流式结束后统一处理）
          if (toolCallDelta) {
            accumulatedToolCalls.push(toolCallDelta)
          }
        },
        this.userId,
        tools
      )

      // 发送 SSE 结束标记
      this.emit('stream_chunk', {
        type: 'sse',
        event: 'done',
        data: '[DONE]',
        sessionId: this.state.sessionId
      })

      // 使用流式返回的完整内容
      response = {
        content: response.content || fullContent,
        reasoningContent: response.reasoningContent || fullReasoningContent,
        toolCalls: response.toolCalls,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      }
    } else {
      // 非流式模式 - 一次性获取完整响应
      response = await this.llmClient.chat(messages, this.userId, { tools })
    }

    // 添加助手消息到历史
    if (response.content || response.toolCalls) {
      this.addMessage({
        id: this.generateId(),
        role: 'assistant',
        content: response.content || '',
        reasoningContent: response.reasoningContent,
        toolCalls: response.toolCalls,
        timestamp: Date.now()
      })

      // 非流式模式下，发送 SSE 格式消息
      if (!useStream && response.content) {
        this.emit('stream_chunk', {
          type: 'sse',
          event: 'content',
          data: response.content,
          sessionId: this.state.sessionId
        })
        this.emit('stream_chunk', {
          type: 'sse',
          event: 'done',
          data: '[DONE]',
          sessionId: this.state.sessionId
        })
      }
    }

    return response
  }

  private async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    return this.toolBridge.execute(toolCall)
  }

  private addMessage(message: Message): void {
    // 添加到短期记忆（包含压缩逻辑）
    this.shortTermMemory.addMessage(message)
    // 同步到 state 保持兼容性
    this.state.messages.push(message)

    // 打印短期记忆统计
    const stats = this.shortTermMemory.getStats()
    log.debug('AgentLoop', '短期记忆状态', stats)
  }

  private addToolResult(toolCall: ToolCall, result: ToolResult): void {
    const toolMessage: Message = {
      id: this.generateId(),
      role: 'tool',
      content: result.success
        ? JSON.stringify(result.data)
        : `Error: ${result.error}`,
      toolResults: [result],
      timestamp: Date.now()
    }
    // 添加到短期记忆
    this.shortTermMemory.addMessage(toolMessage)
    // 同步到 state
    this.state.messages.push(toolMessage)
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}
