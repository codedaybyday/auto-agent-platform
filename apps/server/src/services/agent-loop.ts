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
} from '../types/index.js'
import { ToolBridge } from './tool-bridge.js'
import { LLMClient, LLMAPIError } from './llm-client.js'

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
  private toolBridge: ToolBridge
  private llmClient: LLMClient
  private userId: string

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
      maxIterations: config.maxIterations || 50,
      model: config.model || 'gpt-4',
      systemPrompt: config.systemPrompt || this.getDefaultSystemPrompt()
    }
    this.toolBridge = new ToolBridge(sessionId, userId)
    this.llmClient = new LLMClient({ model: this.config.model, baseURL: config.baseURL})
  }

  /**
   * 核心循环：ReAct 范式
   * Observation -> Thought -> Action -> (Repeat)
   */
  async run(userInput: string): Promise<void> {
    console.log(`[AgentLoop] ========== 开始新任务 ==========`)
    console.log(`[AgentLoop] 输入: ${userInput.substring(0, 100)}${userInput.length > 100 ? '...' : ''}`)
    console.log(`[AgentLoop] 会话ID: ${this.state.sessionId}`)
    console.log(`[AgentLoop] 模型: ${this.config.model}`)
    console.log(`[AgentLoop] 是否本地模型: ${this.llmClient.isLocal}`)

    // 初始化
    this.state.status = 'running'
    this.state.iteration = 0
    this.addMessage({
      id: this.generateId(),
      role: 'user',
      content: userInput,
      timestamp: Date.now()
    })

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
      console.log(`[AgentLoop] ${checkResult.message}`)
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
        console.log(`[AgentLoop] 迭代 ${this.state.iteration} - 构建上下文: ${context.length} 条消息`)

        // Step 2: Thought（LLM 思考）
        console.log(`[AgentLoop] 调用 LLM...`)
        const llmResponse = await this.callLLM(context)
        console.log(`[AgentLoop] LLM 响应:`, {
          contentLength: llmResponse.content?.length || 0,
          toolCallsCount: llmResponse.toolCalls?.length || 0,
          hasToolCalls: !!llmResponse.toolCalls && llmResponse.toolCalls.length > 0
        })

        // Step 3: 判断是 Action 还是 Final Answer
        if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
          // 需要执行工具（Action）
          this.state.status = 'waiting_tool'
          console.log(`[AgentLoop] 检测到 ${llmResponse.toolCalls.length} 个工具调用`)

          for (const toolCall of llmResponse.toolCalls) {
            console.log('[AgentLoop] 工具信息:', toolCall)
            console.log(`[AgentLoop] 执行工具: ${toolCall.name}`, {
              arguments: JSON.stringify(toolCall.arguments).substring(0, 200)
            })

            // 通知前端工具开始执行
            this.emit('tool_start', {
              toolCall,
              timestamp: Date.now()
            })

            // 执行工具（可能走 WebSocket 到客户端）
            const result = await this.executeTool(toolCall)
            console.log(`[AgentLoop] 工具执行结果:`, {
              success: result.success,
              hasData: !!result.data,
              hasError: !!result.error,
              executionTime: result.executionTime
            })

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
          console.log(`[AgentLoop] 继续循环，等待 LLM 处理工具结果`)
          continue
        } else {
          // 得到最终答案，结束循环
          console.log(`[AgentLoop] 得到最终答案，结束循环`)
          this.state.status = 'completed'
          this.emit('run_complete', {
            output: llmResponse.content || '',
            timestamp: Date.now()
          })
          console.log(`[AgentLoop] ========== 任务完成 ==========`)
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
      console.error(`[AgentLoop] 错误:`, error)

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
   * 获取当前状态
   */
  getState(): LoopState {
    return { ...this.state }
  }

  /**
   * 获取历史消息
   */
  getMessages(): Message[] {
    return [...this.state.messages]
  }

  /**
   * 清除历史消息
   */
  clearMessages(): void {
    this.state.messages = []
  }

  /**
   * 绑定 WebSocket 客户端（用于工具调用）
   */
  bindWebSocket(wsClient: any): void {
    this.toolBridge.bindWebSocket(wsClient)
  }

  private getDefaultSystemPrompt(): string {
    return `你是一个智能助手，可以帮助用户完成各种任务。
你可以使用以下工具：
- browser: 控制浏览器访问网页、点击元素、输入文字、截图等
- bash: 执行系统命令
- file_read/file_write: 读写本地文件

请根据用户的需求决定是否需要使用工具。
如果需要使用工具，请明确调用；如果可以直接回答，请直接回答。回复尽量用中文`
  }

  private buildContext(): Message[] {
    const systemMessage: Message = {
      id: 'system',
      role: 'system',
      content: this.config.systemPrompt,
      timestamp: Date.now()
    }
    return [systemMessage, ...this.state.messages]
  }

  private async callLLM(messages: Message[]): Promise<LLMResponse> {
    console.log(`[AgentLoop] 调用 LLM，消息数: ${messages.length}`)

    // 调用 LLM
    const response = await this.llmClient.chat(messages)

    console.log(`[AgentLoop] LLM 返回:`, {
      contentPreview: response.content?.substring(0, 100) || '(空)',
      toolCallsCount: response.toolCalls?.length || 0
    })

    // 添加助手消息到历史
    if (response.content || response.toolCalls) {
      this.addMessage({
        id: this.generateId(),
        role: 'assistant',
        content: response.content || '',
        toolCalls: response.toolCalls,
        timestamp: Date.now()
      })

      // 流式输出
      if (response.content) {
        this.emit('stream_chunk', { content: response.content })
      }
    }

    return response
  }

  private async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    return this.toolBridge.execute(toolCall)
  }

  private addMessage(message: Message): void {
    this.state.messages.push(message)
  }

  private addToolResult(toolCall: ToolCall, result: ToolResult): void {
    this.state.messages.push({
      id: this.generateId(),
      role: 'tool',
      content: result.success
        ? JSON.stringify(result.data)
        : `Error: ${result.error}`,
      toolResults: [result],
      timestamp: Date.now()
    })
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}
