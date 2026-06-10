/**
 * 短期记忆管理器（分层存储 + LLM 智能压缩）
 *
 * 架构：
 * Tier 1: 最近 N 轮 - 完整消息保留（内存）
 * Tier 2: 中间 M 轮 - LLM 智能压缩（异步）
 * Tier 3: 早期轮次 - 暂不考虑
 *
 * 特性：
 * 1. 异步压缩，不阻塞主流程
 * 2. LLM 失败时自动回退到规则压缩
 * 3. 支持轻量级模型（gpt-4o-mini、qwen-turbo）
 */

import type { Message } from '../../types/index.js'
import { LLMClient } from '../llm/client.js'

export interface ShortTermMemoryConfig {
  /** Tier 1: 完整保留的最近轮数 */
  fullContextRounds: number
  /** Tier 2: 最大保留的压缩轮数 */
  maxCompressedRounds?: number
  /** LLM 压缩配置 */
  compression?: {
    model?: string
    baseURL?: string
    apiKey?: string
    temperature?: number
    timeout?: number
    maxRetries?: number
  }
  /** 调试模式 */
  debug?: boolean
}

export interface CompressionResult {
  /** 压缩后的摘要 */
  summary: string
  /** 关键信息点 */
  keyPoints: string[]
  /** 用户意图 */
  userIntent: string
  /** 执行的行动 */
  actions: string[]
  /** 重要结果 */
  results: string[]
  /** 是否使用 LLM 压缩 */
  isLLMCompressed: boolean
  /** 消耗的 token 数 */
  tokensUsed?: number
  /** 压缩时间戳 */
  compressedAt: number
}

export class ShortTermMemory {
  private config: Required<ShortTermMemoryConfig>

  // Tier 1: 完整消息（内存数组）
  private messages: Message[] = []

  // Tier 2: 压缩结果（按轮次存储）
  private compressedRounds: Map<number, CompressionResult> = new Map()

  // 压缩任务队列（防止重复压缩同一轮）
  private compressionQueue: Map<number, Promise<CompressionResult>> = new Map()

  // LLM 客户端（用于压缩）
  private llmClient?: LLMClient

  // 当前轮次
  private currentRound = 0

  constructor(config: Partial<ShortTermMemoryConfig> = {}) {
    this.config = {
      fullContextRounds: config.fullContextRounds ?? 5,
      maxCompressedRounds: config.maxCompressedRounds ?? 20,
      compression: {
        model: config.compression?.model ?? process.env.COMPRESSION_MODEL ?? process.env.LLM_MODEL ?? 'gpt-4o-mini',
        baseURL: config.compression?.baseURL ?? process.env.COMPRESSION_BASE_URL ?? process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
        apiKey: config.compression?.apiKey ?? process.env.COMPRESSION_API_KEY ?? process.env.LLM_API_KEY ?? '',
        temperature: config.compression?.temperature ?? 0.3,
        timeout: config.compression?.timeout ?? 10000,
        maxRetries: config.compression?.maxRetries ?? 2
      },
      debug: config.debug ?? false
    }

    // 初始化 LLM 客户端（如果配置了 API Key）
    if (this.config.compression.apiKey) {
      this.llmClient = new LLMClient({
        model: this.config.compression.model,
        baseURL: this.config.compression.baseURL,
        apiKey: this.config.compression.apiKey,
        temperature: this.config.compression.temperature,
        maxTokens: 2048
      })
    }

    this.log('info', 'ShortTermMemory initialized', {
      fullContextRounds: this.config.fullContextRounds,
      maxCompressedRounds: this.config.maxCompressedRounds,
      compressionModel: this.config.compression.model,
      hasLLMClient: !!this.llmClient
    })
  }

  /**
   * 添加消息到短期记忆
   */
  addMessage(message: Message): void {
    // 统计轮次：user 消息开始新一轮
    if (message.role === 'user') {
      this.currentRound++
    }

    // 预截断：防止超长消息直接进入内存
    const MAX_MSG_LENGTH = 10000
    let processedMessage = message
    if (message.content && message.content.length > MAX_MSG_LENGTH) {
      const originalLength = message.content.length
      processedMessage = {
        ...message,
        content: message.content.slice(0, MAX_MSG_LENGTH) +
          `\n[... message truncated, original: ${originalLength} chars]`
      }
      this.log('warn', `Message truncated from ${originalLength} to ${MAX_MSG_LENGTH} chars`)
    }

    // 添加到消息列表
    this.messages.push({
      ...processedMessage,
      // @ts-ignore - 扩展字段标记轮次
      _round: this.currentRound
    })

    // 触发异步压缩检查
    this.triggerCompression()
  }

  /**
   * 添加多条消息
   */
  addMessages(messages: Message[]): void {
    for (const msg of messages) {
      this.addMessage(msg)
    }
  }

  /**
   * 获取构建上下文的消息列表
   * 包含：系统消息 + 压缩历史 + 最近完整消息
   */
  getContextMessages(systemPrompt: string): Message[] {
    const result: Message[] = []

    // 1. 系统消息
    const systemMessage: Message = {
      id: 'system',
      role: 'system',
      content: systemPrompt,
      timestamp: Date.now()
    }

    // 2. Tier 2: 压缩的历史摘要
    const compressedContext = this.buildCompressedContext()
    if (compressedContext) {
      // 将压缩历史追加到系统消息
      systemMessage.content += '\n\n' + compressedContext
    }

    result.push(systemMessage)

    // 3. Tier 1: 最近的完整消息
    const recentMessages = this.getRecentMessages()
    result.push(...recentMessages)

    return result
  }

  /**
   * 获取所有原始消息（用于调试或导出）
   */
  getAllMessages(): Message[] {
    return [...this.messages]
  }

  /**
   * 获取压缩结果（用于调试）
   */
  getCompressedRounds(): Map<number, CompressionResult> {
    return new Map(this.compressedRounds)
  }

  /**
   * 清空记忆
   */
  clear(): void {
    this.messages = []
    this.compressedRounds.clear()
    this.compressionQueue.clear()
    this.currentRound = 0
    this.log('info', 'Memory cleared')
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalMessages: number
    currentRound: number
    compressedRounds: number
    pendingCompressions: number
    estimatedTokens: number
  } {
    return {
      totalMessages: this.messages.length,
      currentRound: this.currentRound,
      compressedRounds: this.compressedRounds.size,
      pendingCompressions: this.compressionQueue.size,
      estimatedTokens: this.estimateTokens()
    }
  }

  /**
   * 触发压缩检查
   * 异步执行，不阻塞
   */
  private triggerCompression(): void {
    const estimatedTokens = this.estimateTokens()

    // 🚨 紧急截断：当 token 数超过危险阈值时，强制截断长消息
    const DANGER_THRESHOLD = 80000
    const MAX_THRESHOLD = 100000

    if (estimatedTokens > MAX_THRESHOLD) {
      this.log('warn', `🚨 Token count (${estimatedTokens}) exceeds MAX threshold (${MAX_THRESHOLD}), forcing emergency truncation`)
      this.emergencyTruncate()
    } else if (estimatedTokens > DANGER_THRESHOLD) {
      this.log('warn', `⚠️ Token count (${estimatedTokens}) exceeds danger threshold (${DANGER_THRESHOLD}), consider starting new session`)
    }

    // 计算需要压缩的轮次
    const compressibleRounds = this.getCompressibleRounds()

    for (const round of compressibleRounds) {
      // 检查是否已经在压缩中
      if (this.compressionQueue.has(round) || this.compressedRounds.has(round)) {
        continue
      }

      // 异步执行压缩
      this.compressRoundAsync(round)
    }

    // 清理超出 maxCompressedRounds 的早期压缩
    this.cleanupOldCompressions()
  }

  /**
   * 🚨 紧急截断：当 token 数爆炸时强制截断长消息
   * 保留最近 3 轮，截断其他消息
   */
  private emergencyTruncate(): void {
    const cutoffRound = Math.max(0, this.currentRound - 3)
    let truncatedCount = 0

    for (let i = 0; i < this.messages.length; i++) {
      const msg = this.messages[i]
      // @ts-ignore
      const msgRound = msg._round as number

      // 只截断旧轮次的非系统消息
      if (msgRound <= cutoffRound && msg.role !== 'system') {
        const originalLength = msg.content?.length || 0
        if (originalLength > 500) {
          // 截断到 500 字符并添加标记
          const truncated = msg.content!.slice(0, 500)
          msg.content = truncated + `\n[... truncated ${originalLength - 500} chars]`
          truncatedCount++
        }
      }
    }

    this.log('warn', `Emergency truncation completed: ${truncatedCount} messages truncated`)
  }

  /**
   * 获取需要压缩的轮次
   */
  private getCompressibleRounds(): number[] {
    const cutoffRound = Math.max(0, this.currentRound - this.config.fullContextRounds)
    const rounds: number[] = []

    // 获取有消息的轮次
    const roundSet = new Set<number>()
    for (const msg of this.messages) {
      // @ts-ignore
      const round = msg._round as number
      if (round <= cutoffRound && round > 0) {
        roundSet.add(round)
      }
    }

    return Array.from(roundSet).sort((a, b) => a - b)
  }

  /**
   * 异步压缩单轮对话
   */
  private async compressRoundAsync(round: number): Promise<void> {
    // 获取该轮的所有消息
    const roundMessages = this.messages.filter(msg => {
      // @ts-ignore
      return msg._round === round
    })

    if (roundMessages.length === 0) return

    // 创建压缩任务
    const compressionPromise = this.doCompress(round, roundMessages)
    this.compressionQueue.set(round, compressionPromise)

    try {
      const result = await compressionPromise
      this.compressedRounds.set(round, result)
      this.log('info', `Round ${round} compressed`, {
        isLLM: result.isLLMCompressed,
        summary: result.summary.slice(0, 50)
      })
    } catch (error) {
      this.log('error', `Failed to compress round ${round}`, error)
    } finally {
      this.compressionQueue.delete(round)
    }
  }

  /**
   * 执行压缩（带重试和回退）
   */
  private async doCompress(
    round: number,
    messages: Message[]
  ): Promise<CompressionResult> {
    // 尝试 LLM 压缩
    if (this.llmClient) {
      for (let attempt = 0; attempt < (this.config.compression?.maxRetries ?? 2); attempt++) {
        try {
          return await this.compressWithLLM(round, messages)
        } catch (error) {
          this.log('warn', `LLM compression failed (attempt ${attempt + 1})`, error)
          if (attempt < (this.config.compression?.maxRetries ?? 2) - 1) {
            await this.sleep(Math.pow(2, attempt) * 1000)
          }
        }
      }
    }

    // 回退到规则压缩
    this.log('info', `Using fallback compression for round ${round}`)
    return this.fallbackCompression(round, messages)
  }

  /**
   * 使用 LLM 进行压缩
   */
  private async compressWithLLM(
    round: number,
    messages: Message[]
  ): Promise<CompressionResult> {
    if (!this.llmClient) {
      throw new Error('LLM client not available')
    }

    const prompt = this.buildCompressionPrompt(round, messages)

    const response = await Promise.race([
      this.llmClient.chat([
        {
          id: 'system',
          role: 'system',
          content: this.getCompressionSystemPrompt(),
          timestamp: Date.now()
        },
        {
          id: 'user',
          role: 'user',
          content: prompt,
          timestamp: Date.now()
        }
      ]),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Compression timeout (${this.config.compression.timeout}ms)`)),
          this.config.compression.timeout
        )
      )
    ])

    const parsed = this.parseCompressionResult((response as any).content)

    return {
      ...parsed,
      isLLMCompressed: true,
      tokensUsed: (response as any).usage?.totalTokens,
      compressedAt: Date.now()
    }
  }

  /**
   * 规则压缩（兜底方案）
   */
  private fallbackCompression(
    round: number,
    messages: Message[]
  ): CompressionResult {
    const userMsg = messages.find(m => m.role === 'user')
    const assistantMsg = messages.find(m => m.role === 'assistant')
    const toolMsgs = messages.filter(m => m.role === 'tool')

    // 提取用户意图
    const userIntent = this.extractIntent(userMsg?.content || '')

    // 提取行动
    const actions: string[] = []
    if (assistantMsg?.toolCalls) {
      for (const tool of assistantMsg.toolCalls) {
        actions.push(`${tool.name}: ${JSON.stringify(tool.arguments).slice(0, 100)}`)
      }
    }

    // 提取结果
    const results: string[] = []
    for (const toolMsg of toolMsgs) {
      if (toolMsg.content && !toolMsg.content.startsWith('Error:')) {
        const result = toolMsg.content.length > 150
          ? toolMsg.content.slice(0, 150) + '...'
          : toolMsg.content
        results.push(result)
      }
    }

    // 构建摘要
    const summaryParts: string[] = []
    summaryParts.push(`用户意图: ${userIntent}`)
    if (actions.length > 0) {
      summaryParts.push(`执行: ${actions.join(', ').slice(0, 150)}`)
    }
    if (results.length > 0) {
      summaryParts.push(`结果: ${results.join('; ').slice(0, 200)}`)
    }

    return {
      summary: summaryParts.join(' | '),
      keyPoints: [userIntent, ...actions, ...results].slice(0, 5),
      userIntent,
      actions: actions.slice(0, 3),
      results: results.slice(0, 3),
      isLLMCompressed: false,
      compressedAt: Date.now()
    }
  }

  /**
   * 获取最近 N 轮的完整消息（Tier 1）
   */
  private getRecentMessages(): Message[] {
    const cutoffRound = Math.max(0, this.currentRound - this.config.fullContextRounds)
    const result: Message[] = []

    for (const msg of this.messages) {
      // @ts-ignore
      const msgRound = msg._round as number
      if (msgRound > cutoffRound) {
        // 移除内部字段
        const { _round, ...cleanMsg } = msg as any
        result.push(cleanMsg)
      }
    }

    return result
  }

  /**
   * 构建压缩后的上下文描述
   */
  private buildCompressedContext(): string {
    if (this.compressedRounds.size === 0) return ''

    // 获取已压缩的轮次范围
    const compressedRoundNumbers = Array.from(this.compressedRounds.keys()).sort((a, b) => a - b)
    if (compressedRoundNumbers.length === 0) return ''

    const fromRound = compressedRoundNumbers[0]
    const toRound = compressedRoundNumbers[compressedRoundNumbers.length - 1]

    const summaries: string[] = []
    summaries.push(`【历史对话摘要（第 ${fromRound}-${toRound} 轮）】`)

    for (const round of compressedRoundNumbers) {
      const result = this.compressedRounds.get(round)
      if (result) {
        summaries.push(`\n[第 ${round} 轮] ${result.summary}`)
        if (result.keyPoints.length > 0) {
          summaries.push(`  关键点: ${result.keyPoints.join('; ').slice(0, 200)}`)
        }
      }
    }

    summaries.push('\n【以上为历史摘要，以下是最近对话】')
    return summaries.join('\n')
  }

  /**
   * 清理超出范围的压缩结果
   */
  private cleanupOldCompressions(): void {
    const maxRound = this.config.maxCompressedRounds + this.config.fullContextRounds
    const roundsToDelete: number[] = []

    for (const round of this.compressedRounds.keys()) {
      if (round <= this.currentRound - maxRound) {
        roundsToDelete.push(round)
      }
    }

    for (const round of roundsToDelete) {
      this.compressedRounds.delete(round)
    }

    // 同时清理 messages 中过旧的消息（可选，用于释放内存）
    const cutoffRound = Math.max(0, this.currentRound - maxRound)
    const beforeCleanup = this.messages.length
    this.messages = this.messages.filter(msg => {
      // @ts-ignore
      const msgRound = msg._round as number
      return msgRound > cutoffRound
    })

    if (this.messages.length < beforeCleanup) {
      this.log('info', `Cleaned up ${beforeCleanup - this.messages.length} old messages`)
    }
  }

  /**
   * 压缩的系统 Prompt
   */
  private getCompressionSystemPrompt(): string {
    return `你是一个对话压缩助手。你的任务是将一轮对话压缩成结构化的摘要。

压缩原则：
1. 保留用户的核心意图和需求
2. 记录助手执行的关键行动
3. 保留重要的执行结果和发现
4. 去除冗余的交互细节和临时内容
5. 如果包含文件操作，保留文件路径和关键变更
6. 保留错误信息和解决方案

输出格式：
必须返回有效的 JSON 对象，包含以下字段：
- summary: 一句话总结这轮对话（50字以内）
- keyPoints: 关键信息点数组（3-5条，每条不超过30字）
- userIntent: 用户的明确意图（30字以内）
- actions: 执行的行动列表（工具调用等，每项不超过50字）
- results: 重要的执行结果（每项不超过50字）

注意事项：
- 只输出 JSON，不要其他解释
- 确保 JSON 格式正确，可以被解析
- 中文输出`
  }

  /**
   * 构建压缩 Prompt
   */
  private buildCompressionPrompt(round: number, messages: Message[]): string {
    const userMsg = messages.find(m => m.role === 'user')
    const assistantMsg = messages.find(m => m.role === 'assistant')
    const toolMsgs = messages.filter(m => m.role === 'tool')

    let prompt = `【第 ${round} 轮对话压缩】\n\n`

    if (userMsg) {
      prompt += `【用户输入】\n${userMsg.content}\n\n`
    }

    if (assistantMsg) {
      prompt += `【助手回复】\n${assistantMsg.content}\n`

      if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
        prompt += `\n【工具调用】\n`
        for (const tool of assistantMsg.toolCalls) {
          const args = JSON.stringify(tool.arguments)
          prompt += `- ${tool.name}: ${args.length > 200 ? args.slice(0, 200) + '...' : args}\n`
        }
      }
      prompt += `\n`
    }

    if (toolMsgs.length > 0) {
      prompt += `【工具结果】\n`
      for (const toolMsg of toolMsgs) {
        const content = toolMsg.content?.length > 500
          ? toolMsg.content.slice(0, 500) + '...'
          : toolMsg.content
        prompt += `- ${content}\n`
      }
      prompt += `\n`
    }

    prompt += `请将以上对话压缩成 JSON 格式。只输出 JSON，不要其他解释。`
    return prompt
  }

  /**
   * 解析 LLM 返回的压缩结果
   */
  private parseCompressionResult(content: string): Omit<CompressionResult, 'isLLMCompressed' | 'compressedAt' | 'tokensUsed'> {
    try {
      // 尝试提取 JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in response')
      }

      const parsed = JSON.parse(jsonMatch[0])

      return {
        summary: String(parsed.summary || parsed.总结 || '').slice(0, 200),
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.slice(0, 5).map(String) :
                   Array.isArray(parsed.key_points) ? parsed.key_points.slice(0, 5).map(String) :
                   Array.isArray(parsed.关键点) ? parsed.关键点.slice(0, 5).map(String) : [],
        userIntent: String(parsed.userIntent || parsed.user_intent || parsed.用户意图 || '').slice(0, 100),
        actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 5).map(String) :
                 Array.isArray(parsed.行动) ? parsed.行动.slice(0, 5).map(String) : [],
        results: Array.isArray(parsed.results) ? parsed.results.slice(0, 5).map(String) :
                 Array.isArray(parsed.结果) ? parsed.结果.slice(0, 5).map(String) : []
      }
    } catch {
      // JSON 解析失败，从文本提取
      const lines = content.split('\n').filter(l => l.trim())
      return {
        summary: lines[0]?.slice(0, 200) || '压缩解析失败',
        keyPoints: lines.slice(1, 6),
        userIntent: lines[0]?.slice(0, 100) || '',
        actions: lines.filter(l => l.includes('执行') || l.includes('调用')),
        results: lines.filter(l => l.includes('结果') || l.includes('完成'))
      }
    }
  }

  /**
   * 提取用户意图
   */
  private extractIntent(content: string): string {
    const firstSentence = content.split(/[。！？.!?]/)[0]
    return (firstSentence || content).slice(0, 100)
  }

  /**
   * 估算当前上下文的 token 数
   */
  private estimateTokens(): number {
    let total = 0

    // 完整消息（Tier 1）
    const recentMessages = this.getRecentMessages()
    for (const msg of recentMessages) {
      total += this.estimateMessageTokens(msg)
    }

    // 压缩结果（Tier 2）
    for (const result of this.compressedRounds.values()) {
      total += result.summary.length / 4
      total += result.keyPoints.join(' ').length / 4
    }

    return Math.floor(total)
  }

  /**
   * 估算单条消息的 token 数
   * 优化：中文字符通常 1-2 字符 = 1 token，英文 3-4 字符 = 1 token
   * 错误消息和代码通常 token 密度更高
   */
  private estimateMessageTokens(msg: Message): number {
    const content = msg.content || ''
    if (content.length === 0) return 10

    // 检测内容类型以选择更准确的估算
    const hasStackTrace = content.includes('    at ') || content.includes('Error:')
    const isMostlyChinese = (content.match(/[一-龥]/g)?.length || 0) / content.length > 0.3

    let tokens: number
    if (hasStackTrace) {
      // 代码/堆栈：约 3.5 字符/token (更多符号)
      tokens = Math.floor(content.length / 3.5)
    } else if (isMostlyChinese) {
      // 中文内容：约 2 字符/token
      tokens = Math.floor(content.length / 2)
    } else {
      // 混合或英文：约 3 字符/token
      tokens = Math.floor(content.length / 3)
    }

    // 加上消息结构的固定开销
    return tokens + 15
  }

  private log(level: 'info' | 'warn' | 'error', message: string, meta?: any): void {
    if (!this.config.debug && level === 'info') return
    const prefix = `[ShortTermMemory]`
    if (meta) {
      console[level](prefix, message, meta)
    } else {
      console[level](prefix, message)
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
