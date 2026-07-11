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
import { LoopGuard } from './loop-guard.js'

export interface AgentLoopEvents {
  'run_start': { input: string; timestamp: number }
  'run_complete': { output: string; timestamp: number }
  'run_error': { error: Error; timestamp: number }
  'run_paused': { timestamp: number }
  'iteration_start': { iteration: number; timestamp: number }
  'tool_start': { toolCall: ToolCall; timestamp: number; stepIndex?: number; description?: string }
  'tool_end': { toolCall: ToolCall; result: ToolResult; timestamp: number; stepIndex?: number }
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
  private abortController?: AbortController
  private onMessageAdded?: (message: Message) => void
  private loopGuard: LoopGuard

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
      maxIterations: config.maxIterations || 15,
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

    // 初始化循环检测器（防止 LLM 陷入重复工具调用）
    this.loopGuard = new LoopGuard({
      warnThreshold: 2,
      blockThreshold: 4,
      debug: process.env.DEBUG_LOOP_GUARD === 'true'
    })
  }

  /**
   * 设置消息添加回调（用于持久化）
   */
  setOnMessageAdded(callback: (message: Message) => void): void {
    this.onMessageAdded = callback
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

    // 获取可用工具列表并生成动态系统提示词
    const tools = await this.toolBridge.getAvailableTools()
    this.config.systemPrompt = this.getDefaultSystemPrompt(tools)
    log.info('AgentLoop', `已加载 ${tools.length} 个工具`, tools.map(t => t.function?.name))

    // 初始化
    this.state.status = 'running'
    this.state.iteration = 0
    this.loopGuard.reset()
    this.loopGuard.setTaskContext(userInput)
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

        // 注入循环检测警告（如果检测到重复调用模式）
        const loopWarning = this.loopGuard.shouldWarn()
        if (loopWarning) {
          log.warn('AgentLoop', `LoopGuard ${loopWarning.level}: ${loopWarning.toolName} x${loopWarning.repeatCount}`)
          context.push({
            id: this.generateId(),
            role: 'system',
            content: loopWarning.message,
            timestamp: Date.now()
          })
        }

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

            // 自动修复常见 LLM 参数错误（不消耗轮次）
            const correctedCall = autoCorrectToolArgs(toolCall)
            if (correctedCall !== toolCall) {
              log.info('AgentLoop', `🔧 自动修正 ${toolCall.name} 参数: ${JSON.stringify(toolCall.arguments)} → ${JSON.stringify(correctedCall.arguments)}`)
            }

            // 通知前端工具开始执行
            this.emit('tool_start', {
              toolCall: correctedCall,
              timestamp: Date.now(),
              stepIndex: this.state.iteration,
              description: buildToolStepDescription(correctedCall.name, correctedCall.arguments)
            })

            // 执行工具（可能走 WebSocket 到客户端）
            const result = await this.executeTool(correctedCall)
            log.perf('AgentLoop', `工具 ${correctedCall.name}`, result.executionTime || 0)

            // 添加工具结果到上下文（Observation）
            this.addToolResult(correctedCall, result)

            // 记录到循环检测器
            this.loopGuard.recordCall(correctedCall, result)

            // 通知前端工具执行完成
            this.emit('tool_end', {
              toolCall: correctedCall,
              result,
              timestamp: Date.now(),
              stepIndex: this.state.iteration
            })
          }

          // 检查循环检测器：是否达到强制终止阈值
          if (this.loopGuard.shouldTerminate()) {
            log.error('AgentLoop', 'LoopGuard: 检测到工具循环调用，强制终止')
            this.state.status = 'error'
            const error = new Error('检测到工具循环调用，任务已自动终止。请用更具体的指令重试。')
            this.emit('run_error', { error, timestamp: Date.now() })
            throw error
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
    } catch (error: any) {
      // 检查是否是用户主动停止
      // 根因：error 可能不是 Error 实例（如抛出的是字符串或对象），直接访问 .name 会报错
      // 修复：使用可选链操作符 ?. 安全访问 name 属性
      if (error?.name === 'AbortError' || this.state.status === 'completed') {
        log.info('AgentLoop', 'Agent loop stopped by user')
        this.state.status = 'completed'
        this.emit('run_stopped', {
          timestamp: Date.now(),
          reason: 'user_requested'
        })
        return
      }

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
    log.info('AgentLoop', 'Stopping agent loop...')
    this.state.status = 'completed'

    // 中止 LLM 请求
    // 根因：直接使用 this.abortController 存在竞态条件
    // 修复：使用本地变量引用，避免在 abort 后 this.abortController 被其他代码修改
    const controller = this.abortController
    if (controller) {
      this.abortController = undefined  // 先清空，避免重复 abort
      controller.abort()
    }

    // 中止 LLMClient 中的请求
    this.llmClient.abort()

    // 发送停止事件到前端
    this.emit('run_stopped', {
      timestamp: Date.now(),
      reason: 'user_requested'
    })
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

  private getDefaultSystemPrompt(tools: any[] = []): string {
    // 生成动态工具列表（处理 OpenAI 格式：{type, function: {name, description, parameters}}）
    const toolsList = tools.map(t => {
      const name = t.function?.name || t.name || 'unknown'
      const desc = t.function?.description || t.description || ''
      const shortDesc = desc ? ` — ${desc.split('。')[0]}` : ''
      return `- ${name}${shortDesc}`
    }).join('\n')

    return `## 角色
你是一个智能助手，帮助用户完成各类任务。回复使用中文。

## 可用工具
${toolsList || '- 当前没有可用工具'}

## 工具调用规范

### JSON 格式
参数必须是可以被 JSON.parse() 直接解析的有效 JSON：
- 字符串必须用双引号包裹，且必须闭合：{"url": "https://...", "text": "内容"}
- 数字和布尔值不加引号：{"ref": 0, "submit": true}
- 每对 key:value 之间用英文逗号隔开

**自查清单（每次生成 JSON 前默念）**：
1. 最后一个字符串的引号闭合了吗？ {"url": "https://..."}  ← 注意末尾的 "}
2. key 和 value 之间有冒号吗？
3. 最外层有花括号 {} 吗？

### URL 规范
**核心原则：只使用确定存在的 URL**。
- 优先使用当前页面上下文中的链接，或知名域名（baidu.com、google.com 等）
- 不要拼接或猜测域名，拼错会导致导航失败并浪费轮次
- 当你需要搜索时：https://www.baidu.com/s?wd=关键词 ✓
- 不确定的路径宁可不用，先用 browser_get_context 从页面中获取

### 工具执行失败处理
工具返回 error 时：
- 仔细阅读 error 中的具体原因
- 仅修正 error 指出的具体问题，保留其他参数不变
- 示例：error 说 "Unterminated string in JSON" → 检查字符串引号是否闭合
- 示例：error 说 "ERR_NAME_NOT_RESOLVED" → 检查域名是否拼写正确，不要重复尝试同一个错误 URL

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

## 核心原则

**默认直接回答。只有用户明确要求操作外部系统时才使用工具。**

询问（直接回答）：
- "什么是XXX"、"如何实现XXX"、"写个XXX的代码" → 直接回复

操作（使用工具）：
- "创建文件"、"保存到文件"、"执行命令" → 使用对应工具

## 禁止事项

- 不要以"确认数据"为由使用工具回答知识性问题
- 不要主动提供超出用户请求的操作
- 工具参数必须严格遵守 JSON 格式规范`
  }

  private buildContext(): Message[] {
    // 使用短期记忆构建上下文（包含 Tier 1 完整消息 + Tier 2 压缩摘要）
    return this.shortTermMemory.getContextMessages(this.config.systemPrompt)
  }

  private async callLLM(messages: Message[], useStream: boolean = true): Promise<LLMResponse> {
    log.debug('AgentLoop', `调用 LLM，消息数: ${messages.length}`, { totalMessages: messages.length, useStream })

    // 获取可用工具列表（从 MCP ToolBridge - 异步）
    const tools = await this.toolBridge.getAvailableTools()
    log.debug('AgentLoop', `可用工具: ${tools.length} 个`, tools.map(t => t.function?.name))

    // 创建新的 AbortController 用于此次请求
    this.abortController = new AbortController()

    let response: LLMResponse

    if (useStream) {
      // SSE 流式模式 - 逐字实时推送到前端
      // 策略：先缓冲所有内容，流结束后判断是否有 toolCalls
      //   - 有 toolCalls → 这是中间规划步骤，content 不发送给前端（仅在步骤面板中展示）
      //   - 无 toolCalls → 这是最终答案，发送完整内容到前端
      let fullContent = ''
      let fullReasoningContent = ''
      let accumulatedToolCalls: any[] = []

      try {
        response = await this.llmClient.streamChat(
          messages,
          (chunk, toolCallDelta) => {
            if (chunk) {
              fullContent += chunk
            }
            // 累积 tool_calls（流式结束后统一处理）
            if (toolCallDelta) {
              accumulatedToolCalls.push(toolCallDelta)
            }
          },
          this.userId,
          tools,
          this.abortController.signal
        )
      } finally {
        this.abortController = undefined
      }

      // 构建响应（合并流式累积的 toolCalls 和已解析的 toolCalls）
      const mergedToolCalls = response.toolCalls || (accumulatedToolCalls.length > 0
        ? [accumulatedToolCalls.reduce((merged, delta) => ({ ...merged, ...delta }), {})]
        : undefined)
      response = {
        content: response.content || fullContent,
        reasoningContent: response.reasoningContent || fullReasoningContent,
        toolCalls: mergedToolCalls,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      }

      const hasToolCalls = response.toolCalls && response.toolCalls.length > 0

      if (hasToolCalls) {
        // 中间规划步骤：不发送流式内容到前端，避免暴露内部计划文本
        // content 仅保存在后端消息历史中
        this.emit('stream_chunk', {
          type: 'sse',
          event: 'done',
          data: '[DONE]',
          sessionId: this.state.sessionId
        })
      } else {
        // 最终答案：发送完整内容到前端
        this.emit('stream_chunk', {
          type: 'sse',
          event: 'content',
          data: response.content || '',
          sessionId: this.state.sessionId
        })
        this.emit('stream_chunk', {
          type: 'sse',
          event: 'done',
          data: '[DONE]',
          sessionId: this.state.sessionId
        })
      }
    } else {
      // 非流式模式 - 一次性获取完整响应
      response = await this.llmClient.chat(messages, this.userId, { tools })
    }

    // 添加助手消息到历史
    if (response.content || response.toolCalls) {
      const hasToolCalls = response.toolCalls && response.toolCalls.length > 0
      this.addMessage({
        id: this.generateId(),
        role: 'assistant',
        content: response.content || '',
        reasoningContent: response.reasoningContent,
        toolCalls: response.toolCalls,
        timestamp: Date.now(),
        metadata: hasToolCalls ? {
          messageType: 'planning',
          stepDescription: extractStepDescription(response.content || ''),
          stepIndex: this.state.iteration,
          toolName: response.toolCalls?.[0]?.name
        } : {
          messageType: 'answer'
        }
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
    // 根因：工具参数解析错误时，返回错误结果而不是尝试执行
    // 修复：检查参数中是否有解析错误标记
    if (toolCall.arguments && typeof toolCall.arguments === 'object' && '_parseError' in toolCall.arguments) {
      const errorMsg = (toolCall.arguments as any)._parseError
      const rawArgs = (toolCall.arguments as any)._raw || (toolCall.arguments as any)._rawArguments || ''
      log.error('AgentLoop', `Tool call arguments parse error for ${toolCall.name}: ${errorMsg}`)
      return {
        toolCallId: toolCall.id,
        success: false,
        error: `JSON参数格式错误。原始参数: ${rawArgs}\n错误: ${errorMsg}\n请修正 JSON 格式后重试：确保每个 key 后用英文冒号 : 分隔 value。正确示例: {"key": "value", "num": 123}`,
        executionTime: 0
      }
    }

    // 自动修复常见 URL 错误（DeepSeek 模型容易产生残缺URL）
    if (toolCall.name === 'browser_navigate' && toolCall.arguments?.url) {
      const url = toolCall.arguments.url as string
      const fixed = autoFixUrl(url)
      if (fixed !== url) {
        log.warn('AgentLoop', `🔧 Auto-fixed URL: ${url} → ${fixed}`)
        toolCall.arguments.url = fixed
      }
    }

    return this.toolBridge.execute(toolCall)
  }

  private addMessage(message: Message): void {
    // 添加到短期记忆（包含压缩逻辑）
    this.shortTermMemory.addMessage(message)
    // 同步到 state 保持兼容性
    this.state.messages.push(message)

    // 持久化到 SQLite
    if (this.onMessageAdded) {
      this.onMessageAdded(message)
    }

    // 打印短期记忆统计
    const stats = this.shortTermMemory.getStats()
    log.debug('AgentLoop', '短期记忆状态', stats)
  }

  private addToolResult(toolCall: ToolCall, result: ToolResult): void {
    let content: string

    if (result.success) {
      // 成功结果也限制大小
      const dataStr = JSON.stringify(result.data)
      content = dataStr.length > 2000
        ? dataStr.slice(0, 2000) + `\n[... ${dataStr.length - 2000} chars truncated]`
        : dataStr
    } else {
      // 错误消息智能截断：保留关键信息，去除堆栈
      const errorMsg = result.error || 'Unknown error'
      content = this.truncateErrorMessage(errorMsg)
    }

    const toolMessage: Message = {
      id: this.generateId(),
      role: 'tool',
      content,
      toolResults: [result],
      timestamp: Date.now()
    }
    // 添加到短期记忆
    this.shortTermMemory.addMessage(toolMessage)
    // 同步到 state
    this.state.messages.push(toolMessage)
  }

  /**
   * 智能截断错误消息
   * 保留：错误类型 + 简短描述 + 第一行堆栈
   * 去除：后续堆栈跟踪
   */
  private truncateErrorMessage(error: string): string {
    const MAX_LENGTH = 800

    if (error.length <= MAX_LENGTH) {
      return `Error: ${error}`
    }

    // 尝试提取错误类型和主要信息
    const lines = error.split('\n')
    const firstLine = lines[0] || ''

    // 查找堆栈开始的位置（通常是 "    at " 行）
    const stackStartIndex = lines.findIndex(line => line.trim().startsWith('at '))

    if (stackStartIndex > 0) {
      // 有堆栈跟踪，保留错误信息和第一行堆栈
      const errorDesc = lines.slice(0, stackStartIndex).join('\n')
      const firstStackLine = lines[stackStartIndex] || ''
      const truncated = `${errorDesc}\n${firstStackLine}\n    [... stack trace truncated]`
      return `Error: ${truncated}`
    }

    // 没有明显堆栈，直接截断
    return `Error: ${firstLine.slice(0, MAX_LENGTH)}\n[... ${error.length - MAX_LENGTH} chars truncated]`
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}

/**
 * 自动修复 LLM 生成的残缺 URL
 */
function autoFixUrl(url: string): string {
  // baidu → baidu.com (缺少顶级域名)
  const baiduFix = url.match(/^(https?:\/\/www\.baidu)(\/.*)?$/)
  if (baiduFix && !url.includes('.com')) {
    return `${baiduFix[1]}.com${baiduFix[2] || ''}`
  }
  // google → google.com
  const googleFix = url.match(/^(https?:\/\/www\.google)(\/.*)?$/)
  if (googleFix && !url.includes('.com')) {
    return `${googleFix[1]}.com${googleFix[2] || ''}`
  }
  return url
}

/**
 * 从中间消息文本中提取简短步骤描述
 */
function extractStepDescription(content: string): string {
  if (!content) return '执行操作'
  const firstSentence = content.split(/[。！，,\n]/)[0].trim()
  return firstSentence.length > 30
    ? firstSentence.slice(0, 30) + '...'
    : firstSentence
}

/**
 * 根据工具名和参数构建步骤描述
 */
/**
 * 自动修正 LLM 常见参数错误（URL 拼写、缺失参数等）
 * 不消耗 Agent Loop 轮次，直接修正后执行
 */
function autoCorrectToolArgs(toolCall: import('../../types/index.js').ToolCall): import('../../types/index.js').ToolCall {
  const args = { ...toolCall.arguments }
  let changed = false

  // 浏览器导航：修复常见 URL 错误
  if (toolCall.name === 'browser_navigate' && typeof args.url === 'string') {
    let url = args.url

    // 修复1: 缺失协议 → 补充 https://
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url
      changed = true
    }

    // 修复2: 常见域名拼写错误
    url = url.replace(/baidu\.comboard/gi, 'baidu.com/board')
    url = url.replace(/top\.ba\.com/gi, 'top.baidu.com')
    url = url.replace(/top\.baidu\b(?!\.com)/gi, 'top.baidu.com') // top.baidu → top.baidu.com
    url = url.replace(/wwwidu\.com/gi, 'baidu.com') // wwwidu.com → baidu.com

    if (url !== args.url) {
      args.url = url
      changed = true
    }
  }

  // bash: 修复常见命令错误
  if (toolCall.name === 'bash' && typeof args.command === 'string') {
    // 修复: -la ~/ → ls -la ~/ （缺少 ls）
    const cmd = args.command.trim()
    if (/^-la\b/.test(cmd) && !cmd.startsWith('ls')) {
      args.command = 'ls ' + cmd
      changed = true
    }
  }

  return changed ? { ...toolCall, arguments: args } : toolCall
}

function buildToolStepDescription(toolName: string, args?: Record<string, any>): string {
  const actionMap: Record<string, string> = {
    'browser_navigate': '正在打开网页',
    'browser_click': '正在点击元素',
    'browser_type': '正在输入文本',
    'browser_get_context': '正在获取页面内容',
    'browser_screenshot': '正在截图',
    'bash_exec': '正在执行命令',
    'bash': '正在执行命令',
    'web_search': '正在搜索',
    'fetch_url': '正在获取页面',
    'web_fetch': '正在获取内容',
    'file_read': '正在读取文件',
    'file_write': '正在写入文件',
    'file_list': '正在列出文件',
    'file_delete': '正在删除文件',
    'file_stats': '正在获取文件信息',
    'workspace_stats': '正在获取工作区信息',
  }

  const action = actionMap[toolName] || `正在执行 ${toolName}`

  if (args?.url) return `${action}: ${args.url}`
  if (args?.query) return `${action}: ${args.query}`
  if (args?.command) return `${action}: ${args.command}`

  return action
}
