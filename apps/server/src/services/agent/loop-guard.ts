/**
 * Loop Guard — 工具循环调用检测 + 任务进度引导
 *
 * 结合 ZeptoClaw v2 的结果感知哈希和 OpenChrome 的进度语义，
 * 检测 LLM 陷入重复工具调用的模式，并通过**任务感知的上下文注入**
 * 引导 LLM 自行调整，而非简单的「停止」指令。
 *
 * 三层递进响应:
 *   WARN (2次无进展) → 注入任务进度 + 行动建议
 *   CRITICAL (3次无进展) → 注入强制指令 + 具体下一步操作
 *   TERMINATE (4次无进展) → 抛错强制终止
 *
 * 核心改进: 警告不是「停下」而是「推你一把」。
 */

import { log } from '@auto-agent/shared-utils'
import type { ToolCall, ToolResult } from '../../types/index.js'

// ==================== 类型定义 ====================

export interface LoopGuardConfig {
  /** 温和警告阈值（连续相同结果次数），默认 2 */
  warnThreshold?: number
  /** 强制终止阈值，默认 4 */
  blockThreshold?: number
  /** 滑动窗口大小，默认 8 */
  maxWindowSize?: number
  /** 调试模式 */
  debug?: boolean
}

export interface TaskContext {
  /** 用户原始任务 */
  task: string
  /** 当前页面 URL（浏览器场景） */
  currentUrl?: string
  /** 已完成的步骤描述（由调用方手动添加） */
  completedSteps: string[]
}

export interface LoopGuardWarning {
  level: 'warn' | 'critical'
  toolName: string
  repeatCount: number
  /** 给 LLM 的上下文注入消息 */
  message: string
}

interface LoopGuardEntry {
  /** 结果指纹: hash(toolName + stableArgs + resultPrefix) */
  fingerprint: string
  toolName: string
  /** 该工具调用的人类可读描述 */
  stepDescription: string
  timestamp: number
}

// ==================== 工具分类 ====================

/**
 * Poll 工具：通常是状态查询类工具，重复调用是正常的。
 * 阈值放宽为标准工具的 3 倍。
 */
const POLL_TOOLS = new Set([
  'browser_get_context',
  'browser_screenshot',
  'browser_get_current_url',
  'wait',
  'status',
])

/**
 * 浏览器 AI 工具：最容易陷入循环的工具类型。
 * 阈值收紧为标准工具的 0.7 倍。
 */
const BROWSER_AI_TOOLS = new Set([
  'browser_ai',
  'browser_ai_execute',
])

/**
 * 导航类工具：导航成功后，之前的循环计数应该重置。
 */
const NAVIGATION_TOOLS = new Set([
  'browser_navigate',
  'navigate',
])

/**
 * 操作类工具：能推动任务前进的动作。
 */
const ACTION_TOOLS = new Set([
  'browser_ai_execute',
  'browser_navigate',
  'bash',
  'file_write',
  'file_read',
])

// ==================== LoopGuard ====================

export class LoopGuard {
  private config: Required<LoopGuardConfig>
  private callHistory: LoopGuardEntry[] = []
  private consecutiveSameResult = 0
  private lastFingerprint: string | null = null
  private taskContext: TaskContext = { task: '', completedSteps: [] }

  /**
   * 循环倾向：每次检测到循环并发出警告后 +1。
   * 倾向越高，阈值越低 — 对「惯犯」越来越严厉。
   * 导航会重置此计数。
   */
  private loopTendency = 0

  constructor(config: LoopGuardConfig = {}) {
    this.config = {
      warnThreshold: config.warnThreshold ?? 2,
      blockThreshold: config.blockThreshold ?? 4,
      maxWindowSize: config.maxWindowSize ?? 8,
      debug: config.debug ?? process.env.DEBUG_LOOP_GUARD === 'true',
    }
  }

  /**
   * 设置任务上下文。
   * 在每次新任务开始时调用。
   */
  setTaskContext(task: string, currentUrl?: string): void {
    this.taskContext = {
      task,
      currentUrl,
      completedSteps: [],
    }
    log.info('LoopGuard', `🎯 新任务: "${task.substring(0, 80)}"`)
  }

  /**
   * 更新当前页面 URL。
   * 在导航或获取页面上下文后调用。
   */
  updateUrl(url: string): void {
    if (url && url !== this.taskContext.currentUrl) {
      this.log('info', `URL updated: ${this.taskContext.currentUrl || '(none)'} → ${url}`)
      this.taskContext.currentUrl = url
    }
  }

  /**
   * 添加一个已完成的步骤描述。
   * 在工具执行成功后调用。
   */
  addCompletedStep(description: string): void {
    // 去重：相同步骤不重复添加
    const lastStep = this.taskContext.completedSteps[this.taskContext.completedSteps.length - 1]
    if (lastStep === description) return

    this.taskContext.completedSteps.push(description)
    // 限制最多保留 10 个步骤
    if (this.taskContext.completedSteps.length > 10) {
      this.taskContext.completedSteps.shift()
    }
  }

  /**
   * 记录一次工具调用及其结果。
   * 在每次 executeTool 之后调用。
   */
  recordCall(toolCall: ToolCall, result: ToolResult): void {
    const fingerprint = this.computeFingerprint(toolCall, result)
    const toolName = toolCall.name
    const stepDescription = this.describeToolCall(toolCall, result)

    // 导航类工具执行成功后，重置循环检测（页面状态已改变）
    if (NAVIGATION_TOOLS.has(toolName) && result.success) {
      this.log('info', `Navigation detected (${toolName}), resetting loop guard`)

      // 从导航结果中提取 URL
      const url = this.extractUrlFromResult(toolCall, result)
      if (url) this.updateUrl(url)

      // 导航视为重大进展
      this.addCompletedStep(stepDescription)

      // 重置指纹但保留完成步骤
      this.callHistory = []
      this.consecutiveSameResult = 0
      this.lastFingerprint = null
      this.pushEntry({ fingerprint, toolName, stepDescription, timestamp: Date.now() })
      return
    }

    // 操作类工具执行成功，记录为已完成步骤
    if (ACTION_TOOLS.has(toolName) && result.success) {
      this.addCompletedStep(stepDescription)
    }

    // 从 context 获取结果中提取 URL
    if (toolName === 'browser_get_context' && result.success) {
      const url = this.extractUrlFromResult(toolCall, result)
      if (url) this.updateUrl(url)
    }

    // 检查是否与上一次指纹相同
    if (this.lastFingerprint !== null && fingerprint === this.lastFingerprint) {
      this.consecutiveSameResult++
      this.log('warn', `Same result detected (${this.consecutiveSameResult} consecutive): ${toolName}`)
    } else {
      // 指纹变化：衰减而非完全复位
      // 防止「被警告 → 做一个操作 → 又回去分析」的振荡模式
      if (this.consecutiveSameResult > 0) {
        const before = this.consecutiveSameResult
        this.consecutiveSameResult = Math.max(0, this.consecutiveSameResult - 2)
        this.log('info', `Result changed, decayed counter: ${before} → ${this.consecutiveSameResult}`)
      }
      if (this.consecutiveSameResult === 0) {
        this.consecutiveSameResult = 1
      }
      this.lastFingerprint = fingerprint
    }

    this.pushEntry({ fingerprint, toolName, stepDescription, timestamp: Date.now() })
  }

  /**
   * 检查是否应该发出警告。
   * 在 buildContext 之前调用，返回要注入的警告消息。
   *
   * 核心：警告消息不仅告诉 LLM「停下」，还告诉它
   * 「你原来要干什么、你现在在哪、接下来该干什么」。
   */
  shouldWarn(): LoopGuardWarning | null {
    if (this.consecutiveSameResult === 0) return null

    // 循环倾向调整阈值：惯犯的阈值更低
    // 第1次循环: warnThreshold=2, blockThreshold=4
    // 第2次循环: warnThreshold=1, blockThreshold=3
    // 第3次循环: warnThreshold=1, blockThreshold=2 (几乎立刻终止)
    const adjustedWarn = Math.max(1, this.config.warnThreshold - this.loopTendency)
    const adjustedBlock = Math.max(2, this.config.blockThreshold - this.loopTendency)

    const effectiveThreshold = Math.min(
      adjustedWarn,
      this.getEffectiveThreshold(this.lastToolName())
    )

    if (this.consecutiveSameResult < effectiveThreshold) return null

    const toolName = this.lastToolName() || 'unknown'
    const count = this.consecutiveSameResult

    // 构建任务进度上下文
    const progressContext = this.buildProgressContext()
    const tendencyHint = this.loopTendency > 0
      ? `\n⚠️ 这是本任务第 ${this.loopTendency + 1} 次检测到循环倾向，请彻底改变策略。`
      : ''

    if (count >= adjustedBlock) {
      // 递增循环倾向
      this.loopTendency++
      return {
        level: 'critical',
        toolName,
        repeatCount: count,
        message: [
          progressContext,
          `⏳ 连续 ${count} 次调用 ${toolName} 且返回相同结果，任务无任何进展。${tendencyHint}`,
          '你必须立即做出决策：',
          '1) 如果任务已经可以完成，基于已有信息给出最终结论',
          '2) 如果还需要操作，换一个与之前完全不同的具体动作（不要再分析/查看页面）',
          `3) 如果页面缺少必要元素（如搜索框），直接告诉用户当前页面缺少什么`,
        ].join('\n')
      }
    }

    if (count >= effectiveThreshold) {
      // 递增循环倾向
      this.loopTendency++
      const guidance = this.generateGuidance(toolName)

      return {
        level: 'warn',
        toolName,
        repeatCount: count,
        message: [
          progressContext,
          `⚠️ 连续 ${count} 次调用 ${toolName} 未取得新进展，页面状态未改变。${tendencyHint}`,
          guidance,
        ].join('\n')
      }
    }

    return null
  }

  /**
   * 检查是否应该强制终止。
   */
  shouldTerminate(): boolean {
    if (this.consecutiveSameResult === 0) return false
    const adjustedBlock = Math.max(2, this.config.blockThreshold - this.loopTendency)
    return this.consecutiveSameResult >= adjustedBlock
  }

  /**
   * 获取最近一次工具调用的名称。
   */
  lastToolName(): string | null {
    if (this.callHistory.length === 0) return null
    return this.callHistory[this.callHistory.length - 1].toolName
  }

  /**
   * 重置循环检测状态（导航后、新任务开始时调用）。
   */
  reset(): void {
    this.callHistory = []
    this.consecutiveSameResult = 0
    this.lastFingerprint = null
    this.loopTendency = 0
    this.taskContext = { task: '', completedSteps: [] }
    this.log('info', 'LoopGuard reset')
  }

  /**
   * 获取最近的调用历史摘要（用于调试）。
   */
  getHistory(): Array<{ toolName: string; fingerprint: string; step: string }> {
    return this.callHistory.map(e => ({
      toolName: e.toolName,
      fingerprint: e.fingerprint.slice(0, 16),
      step: e.stepDescription,
    }))
  }

  /**
   * 获取统计信息。
   */
  getStats(): {
    historySize: number
    consecutiveSame: number
    lastTool: string | null
    completedSteps: string[]
    currentUrl: string | undefined
  } {
    return {
      historySize: this.callHistory.length,
      consecutiveSame: this.consecutiveSameResult,
      lastTool: this.lastToolName(),
      completedSteps: [...this.taskContext.completedSteps],
      currentUrl: this.taskContext.currentUrl,
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 构建任务进度上下文文本。
   * 这是增强消息的核心 — 告诉 LLM 它在哪里、做过什么。
   */
  private buildProgressContext(): string {
    const parts: string[] = []

    parts.push('【任务进度提示】')

    if (this.taskContext.task) {
      parts.push(`原始任务: ${this.taskContext.task}`)
    }

    if (this.taskContext.currentUrl) {
      parts.push(`当前页面: ${this.taskContext.currentUrl}`)
    }

    if (this.taskContext.completedSteps.length > 0) {
      const steps = this.taskContext.completedSteps
      parts.push(`已完成步骤: ${steps.map((s, i) => `${i + 1}. ${s}`).join(' → ')}`)
    } else {
      parts.push('已完成步骤: (尚无进展)')
    }

    return parts.join('\n')
  }

  /**
   * 根据工具类型生成操作引导。
   *
   * 关键设计：不是泛泛地说「不要再重复」，
   * 而是根据用户原始任务，告诉 LLM 下一步该做什么类型的操作。
   */
  private generateGuidance(toolName: string): string {
    // 分析类工具（browser_ai, browser_get_context）→ 引导执行操作
    if (toolName === 'browser_ai' || toolName === 'browser_get_context') {
      return [
        '页面已充分分析，请不要再查看页面内容。',
        '如果你知道下一步该做什么操作，直接执行它（如点击、输入）。',
        '如果你不确定元素位置，用 browser_ai 直接描述你想要执行的动作（而不是「分析页面」）。',
        '如果任务已经完成，请直接给出结论。',
      ].join('\n')
    }

    // 截图工具 → 引导做决策
    if (toolName === 'browser_screenshot') {
      return [
        '截图已足够，请基于截图内容做出决策。',
        '要么执行下一步操作，要么给出最终结论。',
      ].join('\n')
    }

    // 通用引导
    return [
      '请基于已有信息继续推进任务。',
      `不要再重复 ${toolName}，除非有明确的理由认为这次结果会不同。`,
      '如果任务已完成，直接给出结论。如果遇到障碍，说明具体问题。',
    ].join('\n')
  }

  /**
   * 描述一次工具调用（人类可读，用于步骤追踪）。
   */
  private describeToolCall(toolCall: ToolCall, result: ToolResult): string {
    const name = toolCall.name
    const args = toolCall.arguments || {}

    switch (name) {
      case 'browser_navigate':
      case 'navigate':
        return `导航到 ${args.url || '新页面'}`
      case 'browser_ai': {
        const instruction = (args.instruction as string) || ''
        if (instruction.includes('点击') || instruction.includes('click')) return `点击页面元素`
        if (instruction.includes('输入') || instruction.includes('type') || instruction.includes('搜索')) return `输入内容`
        if (instruction.includes('滚动') || instruction.includes('scroll')) return `滚动页面`
        if (instruction.includes('打开') || instruction.includes('go to')) return `打开页面`
        return instruction ? instruction.slice(0, 30) : '浏览器操作'
      }
      case 'browser_ai_execute': {
        const action = args.action as Record<string, any> | undefined
        if (!action) return '执行浏览器动作'
        switch (action.type) {
          case 'click': return `点击元素 ref=${action.ref ?? '?'}`
          case 'type': return `输入 "${String(action.text || '').slice(0, 20)}"`
          case 'navigate': return `导航到 ${action.url || '新页面'}`
          case 'scroll': return `滚动页面`
          case 'back': return `返回上一页`
          case 'wait': return `等待 ${action.timeout || 1000}ms`
          default: return `${action.type} 操作`
        }
      }
      case 'browser_get_context':
        return '获取页面结构'
      case 'browser_screenshot':
        return '截图'
      case 'bash':
        return `执行命令: ${String(args.command || '').slice(0, 40)}`
      case 'file_read':
        return `读取文件: ${String(args.path || '').slice(0, 40)}`
      case 'file_write':
        return `写入文件: ${String(args.path || '').slice(0, 40)}`
      default:
        return `${name}`
    }
  }

  /**
   * 从工具调用结果中提取 URL。
   */
  private extractUrlFromResult(toolCall: ToolCall, result: ToolResult): string | null {
    if (!result.success || !result.data) return null

    const data = result.data

    // 直接有 url 字段
    if (typeof data.url === 'string' && data.url) return data.url

    // browser_get_context 返回的 context 中有 url
    if (typeof data.context === 'object' && data.context?.url) {
      return data.context.url
    }

    // browser_navigate 的参数
    if (toolCall.name === 'browser_navigate' || toolCall.name === 'navigate') {
      const args = toolCall.arguments as Record<string, any> | undefined
      if (args?.url) return String(args.url)
    }

    return null
  }

  /**
   * 计算一次工具调用的结果指纹。
   */
  private computeFingerprint(toolCall: ToolCall, result: ToolResult): string {
    const toolName = toolCall.name
    const stableArgs = this.extractStableArgs(toolCall.arguments)
    const resultPrefix = this.extractResultPrefix(result)
    const raw = `${toolName}::${stableArgs}::${resultPrefix}`
    return this.simpleHash(raw)
  }

  /**
   * 提取稳定参数：只保留关键字段，去除时间戳、随机 ID 等。
   */
  private extractStableArgs(args: Record<string, any>): string {
    if (!args || Object.keys(args).length === 0) return '{}'

    const stable: Record<string, any> = {}

    if (typeof args.instruction === 'string') {
      stable.instruction = args.instruction.slice(0, 100)
    }

    if (typeof args.ref === 'number' || typeof args.ref === 'string') {
      stable.ref = String(args.ref)
    }

    if (args.action && typeof args.action === 'object') {
      const action = args.action as Record<string, any>
      stable.actionType = action.type || 'unknown'
      if (typeof action.ref === 'number') stable.actionRef = String(action.ref)
      if (typeof action.text === 'string') stable.actionText = action.text.slice(0, 50)
      if (typeof action.url === 'string') stable.actionUrl = action.url
    }

    const stableKeys = ['url', 'path', 'query', 'method']
    for (const key of stableKeys) {
      if (typeof args[key] === 'string') {
        stable[key] = args[key].slice(0, 200)
      } else if (args[key] !== undefined) {
        stable[key] = args[key]
      }
    }

    return JSON.stringify(stable, Object.keys(stable).sort())
  }

  /**
   * 提取结果前缀：取结果数据的前 500 字符。
   */
  private extractResultPrefix(result: ToolResult): string {
    if (result.success && result.data) {
      const dataStr = typeof result.data === 'string'
        ? result.data
        : JSON.stringify(result.data)
      return dataStr.slice(0, 500)
    }

    if (!result.success && result.error) {
      return `ERROR:${result.error.slice(0, 300)}`
    }

    return 'EMPTY_RESULT'
  }

  /**
   * FNV-1a 字符串哈希（32位）。
   */
  private simpleHash(input: string): string {
    let hash = 2166136261
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
      hash = (hash >>> 0)
    }
    return hash.toString(16).padStart(8, '0')
  }

  /**
   * 根据工具类型获取有效阈值。
   */
  private getEffectiveThreshold(toolName: string | null): number {
    if (!toolName) return this.config.warnThreshold
    if (POLL_TOOLS.has(toolName)) return Math.ceil(this.config.warnThreshold * 3)
    if (BROWSER_AI_TOOLS.has(toolName)) return Math.max(1, Math.ceil(this.config.warnThreshold * 0.7))
    return this.config.warnThreshold
  }

  /**
   * 往滑动窗口添加一条记录。
   */
  private pushEntry(entry: LoopGuardEntry): void {
    this.callHistory.push(entry)
    while (this.callHistory.length > this.config.maxWindowSize) {
      this.callHistory.shift()
    }
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    if (!this.config.debug && level === 'info') return
    log[level]('LoopGuard', message)
  }
}
