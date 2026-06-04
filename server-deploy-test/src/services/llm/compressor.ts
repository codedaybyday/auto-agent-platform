/**
 * LLM 智能压缩器
 *
 * 使用 LLM 对历史对话进行语义压缩，提取关键信息
 * 特点：
 * 1. 异步压缩，不阻塞主流程
 * 2. 压缩质量高，保留语义关键信息
 * 3. 失败时自动回退到规则压缩
 */

import type { Message } from '../../types/index.js'
import { LLMClient, LLMAPIError } from './client.js'

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
  /** 是否使用 LLM 压缩（false 表示回退到规则压缩） */
  isLLMCompressed: boolean
  /** 消耗的 token 数 */
  tokensUsed?: number
}

export interface LLMCompressorConfig {
  /** 用于压缩的 LLM 客户端 */
  llmClient?: LLMClient
  /** 压缩模型的配置（如果没有提供 llmClient） */
  modelConfig?: {
    model: string
    baseURL: string
    apiKey?: string
  }
  /** 压缩温度（低温度确保结果稳定） */
  temperature?: number
  /** 最大重试次数 */
  maxRetries?: number
  /** 压缩超时时间（毫秒） */
  timeout?: number
  /** 是否启用调试日志 */
  debug?: boolean
}

/**
 * LLM 压缩器
 */
export class LLMCompressor {
  private llmClient: LLMClient
  private config: Required<Pick<LLMCompressorConfig, 'temperature' | 'maxRetries' | 'timeout' | 'debug'>>
  private compressionQueue: Map<string, Promise<CompressionResult>> = new Map()

  constructor(config: LLMCompressorConfig = {}) {
    // 初始化 LLM 客户端
    if (config.llmClient) {
      this.llmClient = config.llmClient
    } else if (config.modelConfig) {
      this.llmClient = new LLMClient({
        model: config.modelConfig.model,
        baseURL: config.modelConfig.baseURL,
        apiKey: config.modelConfig.apiKey || process.env.LLM_API_KEY,
        temperature: config.temperature || 0.3,
        maxTokens: 2048
      })
    } else {
      // 使用环境变量创建默认客户端
      this.llmClient = new LLMClient({
        model: process.env.LLM_MODEL || 'gpt-4o-mini',
        baseURL: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
        apiKey: process.env.LLM_API_KEY,
        temperature: 0.3,
        maxTokens: 2048
      })
    }

    this.config = {
      temperature: config.temperature ?? 0.3,
      maxRetries: config.maxRetries ?? 2,
      timeout: config.timeout ?? 10000,
      debug: config.debug ?? false
    }
  }

  /**
   * 压缩一轮对话
   * @param round 轮次编号
   * @param messages 该轮的所有消息
   * @returns 压缩结果
   */
  async compressRound(round: number, messages: Message[]): Promise<CompressionResult> {
    const cacheKey = `round-${round}-${messages[0]?.id || Date.now()}`

    // 检查是否已有进行中的压缩任务
    if (this.compressionQueue.has(cacheKey)) {
      return this.compressionQueue.get(cacheKey)!
    }

    // 创建新的压缩任务
    const compressionTask = this.doCompress(round, messages)
    this.compressionQueue.set(cacheKey, compressionTask)

    try {
      const result = await compressionTask
      return result
    } finally {
      // 清理队列
      this.compressionQueue.delete(cacheKey)
    }
  }

  /**
   * 批量压缩多轮对话
   */
  async compressRounds(
    rounds: Array<{ round: number; messages: Message[] }>
  ): Promise<Map<number, CompressionResult>> {
    const results = new Map<number, CompressionResult>()

    // 并行压缩所有轮次
    const promises = rounds.map(async ({ round, messages }) => {
      const result = await this.compressRound(round, messages)
      results.set(round, result)
    })

    await Promise.all(promises)
    return results
  }

  /**
   * 执行压缩（带重试）
   */
  private async doCompress(round: number, messages: Message[]): Promise<CompressionResult> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        return await this.compressWithTimeout(round, messages)
      } catch (error) {
        lastError = error as Error
        this.log('warn', `压缩失败（尝试 ${attempt + 1}/${this.config.maxRetries}）:`, error)

        // 指数退避
        if (attempt < this.config.maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000
          await this.sleep(delay)
        }
      }
    }

    // 所有重试失败，回退到规则压缩
    this.log('warn', `LLM 压缩失败，回退到规则压缩:`, lastError)
    return this.fallbackCompression(round, messages)
  }

  /**
   * 带超时的压缩
   */
  private async compressWithTimeout(
    round: number,
    messages: Message[]
  ): Promise<CompressionResult> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`压缩超时（${this.config.timeout}ms）`))
      }, this.config.timeout)

      this.compressWithLLM(round, messages)
        .then(result => {
          clearTimeout(timeoutId)
          resolve(result)
        })
        .catch(error => {
          clearTimeout(timeoutId)
          reject(error)
        })
    })
  }

  /**
   * 使用 LLM 进行压缩
   */
  private async compressWithLLM(
    round: number,
    messages: Message[]
  ): Promise<CompressionResult> {
    const prompt = this.buildCompressionPrompt(round, messages)

    const response = await this.llmClient.chat([
      { id: 'system', role: 'system', content: this.getSystemPrompt(), timestamp: Date.now() },
      { id: 'user', role: 'user', content: prompt, timestamp: Date.now() }
    ])

    // 解析 LLM 返回的 JSON
    const parsed = this.parseCompressionResult(response.content ?? '')

    return {
      ...parsed,
      isLLMCompressed: true,
      tokensUsed: response.usage?.totalTokens
    }
  }

  /**
   * 压缩的系统 Prompt
   */
  private getSystemPrompt(): string {
    return `你是一个对话压缩助手。你的任务是将一轮对话（包含用户请求、助手回复、工具调用结果）压缩成结构化的摘要。

压缩原则：
1. 保留用户的核心意图和需求
2. 记录助手执行的关键行动
3. 保留重要的执行结果和发现
4. 去除冗余的交互细节和临时内容
5. 如果包含文件操作，保留文件路径和关键变更

输出必须是有效的 JSON 格式，包含以下字段：
- summary: 一句话总结这轮对话（50字以内）
- keyPoints: 关键信息点数组（3-5条）
- userIntent: 用户的明确意图（30字以内）
- actions: 执行的行动列表（工具调用等）
- results: 重要的执行结果`;
  }

  /**
   * 构建压缩 Prompt
   */
  private buildCompressionPrompt(round: number, messages: Message[]): string {
    const userMsg = messages.find(m => m.role === 'user')
    const assistantMsg = messages.find(m => m.role === 'assistant')
    const toolMsgs = messages.filter(m => m.role === 'tool')

    let prompt = `【第 ${round} 轮对话压缩】\n\n`

    // 用户输入
    if (userMsg) {
      prompt += `【用户输入】\n${userMsg.content}\n\n`
    }

    // 助手回复
    if (assistantMsg) {
      prompt += `【助手回复】\n${assistantMsg.content}\n`

      // 工具调用
      if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
        prompt += `\n【工具调用】\n`
        for (const tool of assistantMsg.toolCalls) {
          prompt += `- ${tool.name}: ${JSON.stringify(tool.arguments)}\n`
        }
      }
      prompt += `\n`
    }

    // 工具结果
    if (toolMsgs.length > 0) {
      prompt += `【工具结果】\n`
      for (const toolMsg of toolMsgs) {
        // 截断过长的结果
        const content = toolMsg.content?.length > 500
          ? toolMsg.content.substring(0, 500) + '...'
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
  private parseCompressionResult(content: string): Omit<CompressionResult, 'isLLMCompressed' | 'tokensUsed'> {
    try {
      // 尝试直接解析
      const parsed = JSON.parse(content)

      return {
        summary: String(parsed.summary || parsed.总结 || '').substring(0, 200),
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.slice(0, 5).map(String) :
                   Array.isArray(parsed.key_points) ? parsed.key_points.slice(0, 5).map(String) :
                   Array.isArray(parsed.关键点) ? parsed.关键点.slice(0, 5).map(String) : [],
        userIntent: String(parsed.userIntent || parsed.user_intent || parsed.用户意图 || '').substring(0, 100),
        actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 5).map(String) :
                 Array.isArray(parsed.行动) ? parsed.行动.slice(0, 5).map(String) : [],
        results: Array.isArray(parsed.results) ? parsed.results.slice(0, 5).map(String) :
                 Array.isArray(parsed.结果) ? parsed.结果.slice(0, 5).map(String) : []
      }
    } catch {
      // JSON 解析失败，尝试从文本中提取
      return this.extractFromText(content)
    }
  }

  /**
   * 从文本中提取信息（回退方案）
   */
  private extractFromText(content: string): Omit<CompressionResult, 'isLLMCompressed' | 'tokensUsed'> {
    const lines = content.split('\n').filter(l => l.trim())

    return {
      summary: lines[0]?.substring(0, 200) || '压缩失败',
      keyPoints: lines.slice(1, 6),
      userIntent: lines[0]?.substring(0, 100) || '',
      actions: lines.filter(l => l.includes('执行') || l.includes('调用') || l.includes('工具')),
      results: lines.filter(l => l.includes('结果') || l.includes('完成') || l.includes('成功'))
    }
  }

  /**
   * 规则压缩（LLM 失败时的回退方案）
   */
  private fallbackCompression(round: number, messages: Message[]): CompressionResult {
    const userMsg = messages.find(m => m.role === 'user')
    const assistantMsg = messages.find(m => m.role === 'assistant')
    const toolMsgs = messages.filter(m => m.role === 'tool')

    // 提取用户意图
    const userIntent = userMsg
      ? (userMsg.content.split(/[。！？.!?]/)[0] || userMsg.content).substring(0, 100)
      : '未知意图'

    // 提取行动
    const actions: string[] = []
    if (assistantMsg?.toolCalls) {
      for (const tool of assistantMsg.toolCalls) {
        actions.push(`${tool.name}: ${JSON.stringify(tool.arguments).substring(0, 100)}`)
      }
    }

    // 提取结果
    const results: string[] = []
    for (const toolMsg of toolMsgs) {
      if (toolMsg.content && !toolMsg.content.startsWith('Error:')) {
        const result = toolMsg.content.length > 150
          ? toolMsg.content.substring(0, 150) + '...'
          : toolMsg.content
        results.push(result)
      }
    }

    // 构建摘要
    const summaryParts: string[] = []
    summaryParts.push(`用户意图: ${userIntent}`)
    if (actions.length > 0) {
      summaryParts.push(`执行: ${actions.join(', ').substring(0, 150)}`)
    }
    if (results.length > 0) {
      summaryParts.push(`结果: ${results.join('; ').substring(0, 200)}`)
    }

    return {
      summary: summaryParts.join(' | '),
      keyPoints: [userIntent, ...actions, ...results].slice(0, 5),
      userIntent,
      actions: actions.slice(0, 3),
      results: results.slice(0, 3),
      isLLMCompressed: false
    }
  }

  /**
   * 构建压缩后的上下文描述（用于系统提示）
   */
  buildCompressedContext(
    roundResults: Map<number, CompressionResult>,
    fromRound: number,
    toRound: number
  ): string {
    const summaries: string[] = []
    summaries.push(`【历史对话摘要（第 ${fromRound}-${toRound} 轮）】`)

    for (let round = fromRound; round <= toRound; round++) {
      const result = roundResults.get(round)
      if (result) {
        summaries.push(`\n[第 ${round} 轮] ${result.summary}`)

        // 添加关键信息点（可选，根据压缩策略）
        if (result.keyPoints.length > 0) {
          summaries.push(`  关键点: ${result.keyPoints.join('; ').substring(0, 200)}`)
        }
      }
    }

    if (summaries.length === 1) {
      return '' // 只有标题，没有内容
    }

    summaries.push('\n【以上为历史摘要，以下是最近对话】')
    return summaries.join('\n')
  }

  private log(level: 'log' | 'warn' | 'error', ...args: any[]) {
    if (!this.config.debug && level === 'log') return
    console[level](`[LLMCompressor]`, ...args)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
