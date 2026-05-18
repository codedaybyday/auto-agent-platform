/**
 * 短期记忆管理器（滑动窗口）
 *
 * 功能：
 * 1. 保留最近 N 轮对话的完整内容
 * 2. 对历史消息进行智能压缩
 * 3. 控制发送给 LLM 的上下文长度
 */

import type { Message } from '../types/index.js'

export interface ShortTermMemoryConfig {
  /** 完整保留的最近轮数（一轮 = user + assistant） */
  fullContextRounds: number
  /** 压缩策略 */
  compressionStrategy: 'summary' | 'keypoints' | 'hierarchical'
  /** 最大上下文 token 数（估算） */
  maxTokens?: number
}

export interface CompressedMessage {
  id: string
  /** 原始消息角色 */
  originalRole: 'user' | 'assistant' | 'tool'
  /** 压缩后的摘要 */
  summary: string
  /** 关键信息 */
  keyInfo: KeyInfo[]
  /** 是否包含工具调用 */
  hasToolCalls: boolean
  /** 工具调用结果（仅保留成功且重要的） */
  toolResults?: string[]
  /** 原始时间戳 */
  timestamp: number
  /** 原始轮次 */
  round: number
}

export interface KeyInfo {
  type: 'intent' | 'action' | 'result' | 'error' | 'fact'
  content: string
  importance: number // 0-1
}

export class ShortTermMemory {
  private config: ShortTermMemoryConfig
  private messages: Message[] = []
  private compressedMessages: Map<string, CompressedMessage> = new Map()
  private currentRound = 0

  constructor(config: Partial<ShortTermMemoryConfig> = {}) {
    this.config = {
      fullContextRounds: config.fullContextRounds ?? 5,
      compressionStrategy: config.compressionStrategy ?? 'summary',
      maxTokens: config.maxTokens ?? 8000
    }
  }

  /**
   * 添加消息到短期记忆
   */
  addMessage(message: Message): void {
    // 统计轮次：user 消息开始新一轮
    if (message.role === 'user') {
      this.currentRound++
    }

    // 添加到消息列表
    this.messages.push({
      ...message,
      // 添加轮次标记
      // @ts-ignore - 扩展字段
      _round: this.currentRound
    })

    // 检查是否需要压缩
    this.checkAndCompress()
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
   */
  getContextMessages(): Message[] {
    const result: Message[] = []
    const cutoffRound = Math.max(0, this.currentRound - this.config.fullContextRounds)

    // 第一轮：添加压缩后的历史消息（作为系统上下文）
    if (cutoffRound > 0) {
      const compressedContext = this.buildCompressedContext(1, cutoffRound)
      if (compressedContext) {
        result.push({
          id: 'compressed-history',
          role: 'system',
          content: compressedContext,
          timestamp: Date.now()
        })
      }
    }

    // 第二轮：添加最近 N 轮的完整消息
    for (const msg of this.messages) {
      // @ts-ignore
      const msgRound = msg._round as number
      if (msgRound > cutoffRound) {
        // 移除内部字段后添加
        const { _round, ...cleanMsg } = msg as any
        result.push(cleanMsg)
      }
    }

    return result
  }

  /**
   * 获取所有原始消息（用于反思）
   */
  getAllMessages(): Message[] {
    return [...this.messages]
  }

  /**
   * 清空记忆
   */
  clear(): void {
    this.messages = []
    this.compressedMessages.clear()
    this.currentRound = 0
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalMessages: number
    currentRound: number
    compressedCount: number
    estimatedTokens: number
  } {
    return {
      totalMessages: this.messages.length,
      currentRound: this.currentRound,
      compressedCount: this.compressedMessages.size,
      estimatedTokens: this.estimateTokens()
    }
  }

  /**
   * 检查并压缩过期消息
   */
  private checkAndCompress(): void {
    const cutoffRound = this.currentRound - this.config.fullContextRounds

    if (cutoffRound < 1) return

    // 找出需要压缩的消息
    const toCompress: Message[] = []
    for (const msg of this.messages) {
      // @ts-ignore
      const msgRound = msg._round as number
      if (msgRound <= cutoffRound && !this.compressedMessages.has(msg.id)) {
        toCompress.push(msg)
      }
    }

    // 按轮次分组压缩
    const groupedByRound = this.groupByRound(toCompress)
    Array.from(groupedByRound.entries()).forEach(([round, msgs]) => {
      if (parseInt(round) <= cutoffRound) {
        this.compressRound(parseInt(round), msgs)
      }
    })

    // 清理已压缩的原始消息（释放内存）
    this.messages = this.messages.filter(msg => {
      // @ts-ignore
      const msgRound = msg._round as number
      return msgRound > cutoffRound - 2 // 保留一点缓冲
    })
  }

  /**
   * 按轮次分组消息
   */
  private groupByRound(messages: Message[]): Map<string, Message[]> {
    const grouped = new Map<string, Message[]>()
    for (const msg of messages) {
      // @ts-ignore
      const round = String(msg._round ?? 0)
      if (!grouped.has(round)) {
        grouped.set(round, [])
      }
      grouped.get(round)!.push(msg)
    }
    return grouped
  }

  /**
   * 压缩一轮对话
   */
  private compressRound(round: number, messages: Message[]): void {
    const userMsg = messages.find(m => m.role === 'user')
    const assistantMsg = messages.find(m => m.role === 'assistant')
    const toolMsgs = messages.filter(m => m.role === 'tool')

    if (!userMsg) return

    // 提取关键信息
    const keyInfo: KeyInfo[] = []

    // 用户意图
    keyInfo.push({
      type: 'intent',
      content: this.extractIntent(userMsg.content),
      importance: 1.0
    })

    // 助手行动
    if (assistantMsg) {
      if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
        for (const toolCall of assistantMsg.toolCalls) {
          keyInfo.push({
            type: 'action',
            content: `${toolCall.name}: ${JSON.stringify(toolCall.arguments).substring(0, 100)}`,
            importance: 0.9
          })
        }
      }

      // 助手回复摘要（如果没有工具调用）
      if (!assistantMsg.toolCalls || assistantMsg.toolCalls.length === 0) {
        keyInfo.push({
          type: 'result',
          content: this.summarizeContent(assistantMsg.content, 200),
          importance: 0.8
        })
      }
    }

    // 工具结果
    const importantResults: string[] = []
    for (const toolMsg of toolMsgs) {
      const result = this.extractImportantToolResult(toolMsg)
      if (result) {
        importantResults.push(result)
        keyInfo.push({
          type: 'result',
          content: result.substring(0, 150),
          importance: 0.7
        })
      }
    }

    // 创建压缩消息
    const compressed: CompressedMessage = {
      id: `compressed-round-${round}`,
      originalRole: 'assistant',
      summary: this.buildRoundSummary(round, userMsg, assistantMsg, keyInfo),
      keyInfo: keyInfo.slice(0, 5), // 限制关键信息数量
      hasToolCalls: !!(assistantMsg?.toolCalls && assistantMsg.toolCalls.length > 0),
      toolResults: importantResults.slice(0, 3), // 限制结果数量
      timestamp: userMsg.timestamp,
      round
    }

    // 保存压缩结果
    for (const msg of messages) {
      this.compressedMessages.set(msg.id, compressed)
    }

    console.log(`[ShortTermMemory] Compressed round ${round}: ${messages.length} messages -> 1 summary`)
  }

  /**
   * 构建压缩后的上下文描述
   */
  private buildCompressedContext(fromRound: number, toRound: number): string {
    const summaries: string[] = []

    summaries.push(`【历史对话摘要（第 ${fromRound}-${toRound} 轮）】`)

    // 收集所有压缩信息
    const seenRounds = new Set<number>()
    Array.from(this.compressedMessages.values()).forEach((compressed) => {
      if (!seenRounds.has(compressed.round) &&
          compressed.round >= fromRound &&
          compressed.round <= toRound) {
        seenRounds.add(compressed.round)
        summaries.push(`\n[第 ${compressed.round} 轮] ${compressed.summary}`)
      }
    })

    if (summaries.length === 1) return '' // 只有标题，没有内容

    summaries.push('\n【以上为历史摘要，以下是最近对话】')

    return summaries.join('\n')
  }

  /**
   * 构建单轮摘要
   */
  private buildRoundSummary(
    round: number,
    userMsg: Message,
    assistantMsg: Message | undefined,
    keyInfo: KeyInfo[]
  ): string {
    const parts: string[] = []

    // 用户意图
    parts.push(`用户意图: ${this.extractIntent(userMsg.content)}`)

    // 行动和结果
    if (keyInfo.length > 1) {
      const actions = keyInfo.filter(k => k.type === 'action')
      const results = keyInfo.filter(k => k.type === 'result')

      if (actions.length > 0) {
        parts.push(`执行: ${actions.map(a => a.content).join(', ')}`)
      }

      if (results.length > 0) {
        parts.push(`结果: ${results.map(r => r.content).join('; ').substring(0, 200)}`)
      }
    }

    return parts.join(' | ')
  }

  /**
   * 提取用户意图
   */
  private extractIntent(content: string): string {
    // 简单的意图提取：取前 100 个字符或第一句
    const firstSentence = content.split(/[。！？.!?]/)[0]
    return firstSentence.substring(0, 100) || content.substring(0, 100)
  }

  /**
   * 摘要内容
   */
  private summarizeContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content
    return content.substring(0, maxLength) + '...'
  }

  /**
   * 提取重要的工具结果
   */
  private extractImportantToolResult(toolMsg: Message): string | null {
    if (!toolMsg.content) return null

    // 跳过错误信息
    if (toolMsg.content.startsWith('Error:')) return null

    // 提取关键信息
    const content = toolMsg.content

    // 如果是 JSON，尝试提取关键字段
    if (content.startsWith('{') || content.startsWith('[')) {
      try {
        const parsed = JSON.parse(content)
        if (parsed.url) return `访问: ${parsed.url}`
        if (parsed.result) return String(parsed.result).substring(0, 150)
        if (parsed.data) return JSON.stringify(parsed.data).substring(0, 150)
      } catch {
        // 解析失败，使用原文
      }
    }

    // 截图结果保留标记
    if (content.includes('Screenshot captured')) {
      return '[截图已保存]'
    }

    // 其他结果截取前 150 字符
    return content.substring(0, 150)
  }

  /**
   * 估算当前上下文的 token 数（粗略估计）
   */
  private estimateTokens(): number {
    let total = 0

    // 估算完整消息
    for (const msg of this.messages) {
      total += this.estimateMessageTokens(msg)
    }

    // 估算压缩消息
    Array.from(this.compressedMessages.values()).forEach((compressed) => {
      total += compressed.summary.length / 4 // 粗略：4 字符 ≈ 1 token
    })

    return Math.floor(total)
  }

  /**
   * 估算单条消息的 token 数
   */
  private estimateMessageTokens(msg: Message): number {
    const content = msg.content || ''
    // 粗略估计：英文 4 字符 = 1 token，中文 1 字符 ≈ 1.5 token
    // 简化处理：平均 3 字符 = 1 token
    return Math.floor(content.length / 3) + 10 // +10 用于消息结构开销
  }
}
