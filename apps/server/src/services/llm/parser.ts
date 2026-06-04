/**
 * Browser AI 语义解析器
 * 将自然语言指令解析为结构化的浏览器动作
 *
 * 支持基于页面 DOM 上下文的智能解析
 * 支持批量动作规划（一次规划多个动作）
 */

import { LLMClient } from './client.js'

export interface PageElement {
  ref: number
  tag: string
  type?: string
  name?: string
  placeholder?: string
  text?: string
  role?: string
  ariaLabel?: string
  hash?: string
  stableHash?: string
  id?: string
}

export interface PageContext {
  url: string
  title: string
  elements: PageElement[]
}

export interface ElementSemanticDescription {
  tag?: string
  role?: string
  name?: string
  text?: string
  placeholder?: string
  type?: string
  id?: string
  className?: string
  ariaLabel?: string
  hash?: string
  stableHash?: string
  bbox?: { x: number; y: number; width: number; height: number }
}

export interface SingleBrowserAction {
  type: 'navigate' | 'click' | 'type' | 'select' | 'hover' | 'scroll' | 'wait' | 'screenshot' | 'analyze' | 'back' | 'forward' | 'close'
  url?: string
  ref?: number
  description?: ElementSemanticDescription
  text?: string
  field?: ElementSemanticDescription
  direction?: 'up' | 'down'
  amount?: number
  option?: string
  timeout?: number
  fullPage?: boolean
}

export interface ParsedBrowserAction extends SingleBrowserAction {}

export interface BatchBrowserAction {
  type: 'batch'
  actions: SingleBrowserAction[]
  reasoning: string
  expectedOutcome: string
  // 批量执行停止条件
  stopConditions?: {
    onDOMChange?: boolean    // DOM 变化时停止
    onPopup?: boolean        // 出现弹窗时停止
    onNavigation?: boolean   // 页面跳转时停止
    maxActions?: number      // 最大执行动作数
  }
}

export interface ParseResult {
  success: boolean
  action?: ParsedBrowserAction
  batchAction?: BatchBrowserAction
  error?: string
  isBatch: boolean
}

export class BrowserAIParser {
  private llmClient: LLMClient

  constructor(llmClient: LLMClient) {
    this.llmClient = llmClient
  }

  /**
   * 解析自然语言指令为结构化动作
   * @param instruction 用户指令
   * @param context 可选的页面上下文（用于精确定位元素）
   */
  async parseInstruction(
    instruction: string,
    context?: PageContext
  ): Promise<ParseResult> {
    console.log(`[BrowserAIParser] parseInstruction called with: "${instruction}", hasContext: ${!!context}`)
    // 简单指令（导航、滚动、回退等）不需要上下文，直接处理
    const simpleResult = this.tryParseSimpleInstruction(instruction)
    console.log(`[BrowserAIParser] simpleResult: ${simpleResult ? 'matched' : 'null'}`)
    if (simpleResult) {
      return simpleResult
    }

    // 其他指令需要上下文才能精确定位
    if (!context) {
      return {
        success: false,
        error: '需要页面上下文来解析此指令',
        isBatch: false
      }
    }

    return this.parseWithContext(instruction, context)
  }

  /**
   * 批量规划动作
   * 基于当前 DOM 状态，规划完成任务的多个动作
   */
  async planBatchActions(
    task: string,
    context: PageContext,
    maxActions: number = 5
  ): Promise<ParseResult> {
    console.log(`[BrowserAIParser] Planning batch actions for: ${task}`)
    const elementCount = context?.elements?.length || 0
    console.log(`[BrowserAIParser] Context has ${elementCount} elements`)

    // 空白页直接返回错误，让上层处理导航
    if (elementCount === 0) {
      return {
        success: false,
        error: 'Page is blank, cannot plan actions without page elements'
      }
    }

    // 构建 DOM 描述
    const domDescription = this.buildDOMDescription(context)

    const systemPrompt = `你是一个浏览器自动化专家。基于当前页面 DOM，规划完成任务的步骤。

当前页面：
- URL: ${context.url}
- 标题: ${context.title}

页面元素列表（格式: ref | tag | role | type | placeholder | name | text）：
${domDescription}

任务: ${task}

你的目标是规划最多 ${maxActions} 个动作来完成这个任务。

重要规则：
1. 动作之间是顺序执行关系
2. 如果某个动作可能会改变页面状态（如点击后弹出弹窗、导航到新页面），应该在此动作后停止
3. 优先使用 ref 来定位元素，同时提供 stableHash 作为备用
4. 每个动作都要有完整的元素描述，用于回退定位

可用动作类型：
- navigate: 导航到 URL
- click: 点击元素
- type: 在输入框输入文本
- scroll: 滚动页面
- wait: 等待
- screenshot: 截图

重要规则：
1. 规划动作序列时，假设每个动作执行后 DOM 可能发生变化
2. 动作执行后系统会自动评估任务进度，不需要你预设复杂的停止条件
3. 只需设置 maxActions 限制最大动作数，防止无限执行

输出格式（严格 JSON）：
{
  "type": "batch",
  "reasoning": "思考过程",
  "expectedOutcome": "预期结果",
  "stopConditions": {
    "maxActions": ${maxActions}
  },
  "actions": [
    {
      "type": "navigate",
      "url": "https://example.com"
    },
    {
      "type": "click",
      "ref": 5,
      "description": {
        "tag": "button",
        "role": "button",
        "name": "Submit",
        "hash": "a1b2c3",
        "stableHash": "d4e5f6"
      }
    }
  ]
}`

    try {
      const messages = [
        { id: 'system', role: 'system' as const, content: systemPrompt, timestamp: Date.now() },
        { id: 'user', role: 'user' as const, content: `任务：${task}`, timestamp: Date.now() }
      ]

      // 优先尝试强制 JSON 输出（如果模型支持）
      let response: any
      try {
        response = await this.llmClient.chat(messages, undefined, {
          includeTools: false,
          responseFormat: 'json'
        })
      } catch (error) {
        // 如果 JSON 模式不支持，降级到普通模式
        console.log('[BrowserAIParser] JSON mode not supported, falling back to text mode')
        response = await this.llmClient.chat(messages, undefined, { includeTools: false })
      }

      // 处理方式1: LLM 返回 tool_calls（模型选择直接执行）
      if (response.toolCalls && response.toolCalls.length > 0) {
        console.log(`[BrowserAIParser] Received ${response.toolCalls.length} tool_calls`)
        const actions: SingleBrowserAction[] = []

        for (const tool of response.toolCalls) {
          // browser_ai 工具: { instruction: 'go to baidu.com' }
          if (tool.name === 'browser_ai' && tool.arguments.instruction) {
            const simpleResult = this.tryParseSimpleInstruction(tool.arguments.instruction)
            if (simpleResult) {
              actions.push(simpleResult.action)
            }
          }
        }

        if (actions.length > 0) {
          const enrichedActions = this.enrichActions(actions, context)
          return {
            success: true,
            batchAction: {
              type: 'batch',
              actions: enrichedActions,
              reasoning: response.reasoningContent || 'Converted from tool_calls',
              expectedOutcome: 'Execute browser actions',
              stopConditions: { maxActions: maxActions }
            },
            isBatch: true
          }
        }
      }

      // 处理方式2: 从 content 解析 JSON
      let content = response.content?.trim()
      if (!content) {
        return {
          success: false,
          error: 'LLM 返回空内容',
          isBatch: false
        }
      }

      // 解析 JSON（兼容多种格式）
      let parsed: any
      try {
        // 先尝试直接解析
        parsed = JSON.parse(content)
      } catch {
        // 尝试提取 markdown 代码块
        const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
        if (codeBlockMatch) {
          try {
            parsed = JSON.parse(codeBlockMatch[1].trim())
          } catch {
            // 继续尝试其他方式
          }
        }

        // 尝试查找文本中的 JSON 对象（处理 "中文前缀 + {JSON}" 的情况）
        if (!parsed) {
          const jsonObjectMatch = content.match(/\{[\s\S]*\}/)
          if (jsonObjectMatch) {
            try {
              parsed = JSON.parse(jsonObjectMatch[0])
            } catch {
              // 解析失败
            }
          }
        }
      }

      // 如果所有解析方式都失败，返回错误
      if (!parsed) {
        return {
          success: false,
          error: `无法解析 LLM 返回内容: ${content.substring(0, 100)}`,
          isBatch: false
        }
      }

      // 验证和补充动作信息
      if (parsed.type === 'batch' && Array.isArray(parsed.actions)) {
        const enrichedActions = this.enrichActions(parsed.actions, context)

        return {
          success: true,
          batchAction: {
            type: 'batch',
            actions: enrichedActions,
            reasoning: parsed.reasoning || '',
            expectedOutcome: parsed.expectedOutcome || '',
            stopConditions: parsed.stopConditions || {
              onDOMChange: true,
              onPopup: true,
              onNavigation: true,
              maxActions: maxActions
            }
          },
          isBatch: true
        }
      }

      // 如果不是批量动作，降级为单动作
      return {
        success: true,
        action: parsed,
        isBatch: false
      }

    } catch (error) {
      console.error('[BrowserAIParser] Batch planning failed:', error)
      return {
        success: false,
        error: `批量规划失败: ${error instanceof Error ? error.message : String(error)}`,
        isBatch: false
      }
    }
  }

  /**

  /**
   * 补充动作的完整元素信息
   */
  private enrichActions(actions: SingleBrowserAction[], context: PageContext): SingleBrowserAction[] {
    return actions.map(action => {
      if (action.ref !== undefined && action.ref !== null) {
        const element = context.elements.find(e => e.ref === action.ref)
        if (element) {
          // 补充完整的元素描述
          const enrichedDesc = {
            tag: element.tag,
            role: element.role,
            name: element.name,
            text: element.text,
            placeholder: element.placeholder,
            type: element.type,
            id: element.id,
            ariaLabel: element.ariaLabel,
            hash: element.hash,
            stableHash: element.stableHash
          }

          if (action.type === 'type' && action.field) {
            return { ...action, field: { ...enrichedDesc, ...action.field } }
          } else if (action.description) {
            return { ...action, description: { ...enrichedDesc, ...action.description } }
          }
        }
      }
      return action
    })
  }

  /**
   * 评估任务执行进度
   * DOM 变化后调用，让 LLM 判断任务是否完成、是否继续、或是否需要调整
   */
  async evaluateProgress(
    task: string,
    executedActions: SingleBrowserAction[],
    currentContext: PageContext,
    previousContext?: PageContext
  ): Promise<{
    status: 'completed' | 'continue' | 'retry' | 'stop'
    reasoning: string
    nextActions?: SingleBrowserAction[]
    message?: string
  }> {
    console.log(`[BrowserAIParser] Evaluating progress for task: ${task}`)
    console.log(`[BrowserAIParser] Executed ${executedActions.length} actions`)
    console.log(`[BrowserAIParser] Current page: ${currentContext.url}`)

    const domDescription = this.buildDOMDescription(currentContext)
    const executedActionsDesc = executedActions.map((a, i) =>
      `${i + 1}. ${a.type}${a.ref !== undefined ? ` [ref=${a.ref}]` : ''}${a.text ? ` "${a.text}"` : ''}`
    ).join('\n')

    const systemPrompt = `你是一个浏览器自动化执行评估专家。基于已执行的动作和当前页面状态，评估任务进度并决定下一步。

原始任务: ${task}

已执行的动作:
${executedActionsDesc}

当前页面状态:
- URL: ${currentContext.url}
- 标题: ${currentContext.title}

页面元素列表（格式: ref | tag | role | type | placeholder | name | text）:
${domDescription}

请评估当前进度，并返回决策（严格 JSON 格式）:
{
  "status": "completed/continue/retry/stop",
  "reasoning": "详细说明当前状态和判断依据",
  "message": "给用户的简要说明（可选）",
  "nextActions": [  // 仅在 status=continue 时需要，必须包含完整的动作参数
    {
      "type": "click",
      "ref": 31,
      "description": { "tag": "button", "role": "button", "name": "百度一下" }
    },
    {
      "type": "type",
      "ref": 31,
      "text": "要输入的完整文本内容",
      "description": { "tag": "textarea", "role": "textbox" }
    },
    {
      "type": "navigate",
      "url": "https://example.com"
    }
  ]
}

重要：nextActions 中的每个动作必须包含完整的参数：
- click: 需要 ref, description
- type: 需要 ref, text(必须包含要输入的完整文本), description
- navigate: 需要 url

状态说明:
- completed: 任务已完成，不需要进一步操作
- continue: 任务未完成，需要继续执行 nextActions 中指定的动作
- retry: 之前的动作可能未生效，需要重试或调整策略
- stop: 遇到无法处理的情况，停止执行并报告`

    try {
      const messages = [
        { id: 'system', role: 'system' as const, content: systemPrompt, timestamp: Date.now() },
        { id: 'user', role: 'user' as const, content: `请评估任务"${task}"的当前进度`, timestamp: Date.now() }
      ]

      const response = await this.llmClient.chat(messages)
      const content = response.content?.trim()

      if (!content) {
        return {
          status: 'stop',
          reasoning: 'LLM 返回空内容',
          message: '无法评估当前进度'
        }
      }

      // 解析 JSON（多策略回退）
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
      let jsonStr = jsonMatch ? jsonMatch[1].trim() : content

      // 清理常见 JSON 格式问题
      // 1. 移除 BOM
      jsonStr = jsonStr.replace(/^﻿/, '')
      // 2. 修复中文引号
      jsonStr = jsonStr.replace(/[""]/g, '"').replace(/['']/g, "'")

      let parsed: any
      try {
        parsed = JSON.parse(jsonStr)
      } catch (parseError) {
        // 尝试修复未转义的换行符
        const fixedStr = jsonStr.replace(/\n/g, '\\n').replace(/\r/g, '\\r')
        try {
          parsed = JSON.parse(fixedStr)
        } catch {
          // 尝试提取 JSON 对象（处理 LLM 输出多余文本的情况）
          const objectMatch = jsonStr.match(/\{[\s\S]*\}/)
          if (objectMatch) {
            parsed = JSON.parse(objectMatch[0])
          } else {
            throw parseError
          }
        }
      }

      // 验证返回结构
      const validStatuses = ['completed', 'continue', 'retry', 'stop']
      const status = validStatuses.includes(parsed.status) ? parsed.status : 'stop'

      // 如果有 nextActions，补充完整元素信息
      let nextActions: SingleBrowserAction[] | undefined
      if (parsed.nextActions && Array.isArray(parsed.nextActions)) {
        nextActions = this.enrichActions(parsed.nextActions, currentContext)
      }

      console.log(`[BrowserAIParser] Evaluation result: ${status} - ${parsed.reasoning?.substring(0, 100)}...`)

      return {
        status,
        reasoning: parsed.reasoning || '',
        message: parsed.message,
        nextActions
      }

    } catch (error) {
      console.error('[BrowserAIParser] Progress evaluation failed:', error)
      return {
        status: 'stop',
        reasoning: `评估失败: ${error instanceof Error ? error.message : String(error)}`,
        message: '评估过程出错，停止执行'
      }
    }
  }

  /**
   * 尝试解析简单指令（导航、滚动、回退等）
   */
  private tryParseSimpleInstruction(instruction: string): ParseResult | null {
    const lower = instruction.toLowerCase()
    console.log(`[BrowserAIParser] tryParseSimpleInstruction: "${instruction}"`)

    // 1. 回退指令
    const backPatterns = [
      /^(?:go back|back|return|返回|回退|上一页|后退)/i,
      /(?:go back|back|return|返回|回退)\s+(?:to|到)?\s+(?:previous|上一页|前一页)/i
    ]
    for (const pattern of backPatterns) {
      if (pattern.test(instruction)) {
        console.log(`[BrowserAIParser] Matched back pattern: ${pattern}`)
        return {
          success: true,
          action: { type: 'back' },
          isBatch: false
        }
      }
    }

    // 2. 滚动指令
    const scrollDownPatterns = [
      /(?:scroll|滚动)\s+(?:down|向下|到底部|至底部)/i,
      /^(?:scroll|滚动)\s+(?:down|向下)/i,
      /^(?:scroll|滚动)\s+to\s+(?:bottom|end)/i
    ]
    for (const pattern of scrollDownPatterns) {
      if (pattern.test(instruction)) {
        console.log(`[BrowserAIParser] Matched scroll down pattern: ${pattern}`)
        return {
          success: true,
          action: { type: 'scroll', direction: 'bottom' as const },
          isBatch: false
        }
      }
    }

    const scrollUpPatterns = [
      /(?:scroll|滚动)\s+(?:up|向上|到顶部|至顶部)/i,
      /^(?:scroll|滚动)\s+(?:up|向上)/i,
      /^(?:scroll|滚动)\s+to\s+(?:top|start)/i
    ]
    for (const pattern of scrollUpPatterns) {
      if (pattern.test(instruction)) {
        console.log(`[BrowserAIParser] Matched scroll up pattern: ${pattern}`)
        return {
          success: true,
          action: { type: 'scroll', direction: 'top' as const },
          isBatch: false
        }
      }
    }

    // 3. 截图指令
    if (/(?:screenshot|截图|截屏|拍照)/i.test(instruction)) {
      return {
        success: true,
        action: { type: 'screenshot' },
        isBatch: false
      }
    }

    // 4. 导航指令
    const navPatterns = [
      { pattern: /(?:go to|open|visit|navigate to|打开|访问)\s+(.+)/i, extract: (m: RegExpMatchArray) => m[1].trim() },
      { pattern: /^(?:去|打开)\s+(.+)/, extract: (m: RegExpMatchArray) => m[1].trim() }
    ]

    for (const { pattern, extract } of navPatterns) {
      const match = instruction.match(pattern)
      if (match) {
        const target = extract(match)
        const url = this.resolveUrl(target)
        return {
          success: true,
          action: { type: 'navigate', url },
          isBatch: false
        }
      }
    }

    // 直接包含 http 的 URL
    const urlMatch = instruction.match(/(https?:\/\/[^\s]+)/i)
    if (urlMatch) {
      console.log(`[BrowserAIParser] Matched URL pattern`)
      return {
        success: true,
        action: { type: 'navigate', url: urlMatch[1] },
        isBatch: false
      }
    }

    console.log(`[BrowserAIParser] No simple pattern matched for: "${instruction}"`)
    return null
  }

  /**
   * 基于页面上下文解析指令
   */
  private async parseWithContext(
    instruction: string,
    context: PageContext
  ): Promise<ParseResult> {
    console.log(`[BrowserAIParser] parseWithContext started`)
    console.log(`[BrowserAIParser] Instruction: "${instruction}"`)
    const elementCount = context?.elements?.length || 0
    console.log(`[BrowserAIParser] Context has ${elementCount} elements`)

    // 查找 textarea 元素
    const textareas = context?.elements?.filter(e => e.tag === 'textarea') || []
    console.log(`[BrowserAIParser] Textarea elements:`, textareas.map(e => ({ ref: e.ref, placeholder: e.placeholder, id: e.name })))

    // 构建 DOM 描述
    const domDescription = this.buildDOMDescription(context)

    const systemPrompt = `你是一个浏览器自动化指令解析专家。
你的任务是根据用户的自然语言指令和当前页面 DOM 结构，选择最合适的元素并生成结构化动作。

当前页面：
- URL: ${context.url}
- 标题: ${context.title}

页面元素列表（格式: ref | tag | role | type | placeholder | name | text）：
${domDescription}

可用动作类型：
- click: 点击元素（需要提供 ref 和 description）
- type: 在输入框输入文本（需要提供 ref、field 和 text）
- scroll: 滚动页面
- screenshot: 截图
- wait: 等待
- back: 返回上一页
- forward: 前进

重要规则：
1. 必须根据用户指令选择最合适的元素 ref
2. 必须同时返回完整的语义描述（description 或 field），包含所有可用字段用于回退定位
3. 必须包含 hash 和 stableHash（如果页面上有提供），用于元素变化后重新定位
4. 如果找不到匹配的元素，返回 type: "analyze"
5. 输入框通常是 input 或 textarea 标签，role 可能是 textbox/searchbox
6. 按钮通常是 button 或包含特定文本的元素

输出格式（严格 JSON）：
{
  "type": "click",
  "ref": 0,
  "description": {
    "tag": "button",
    "role": "button",
    "name": "百度一下",
    "text": "百度一下",
    "hash": "a1b2c3d4",
    "stableHash": "e5f6g7h8"
  }
}

{
  "type": "type",
  "ref": 1,
  "field": {
    "tag": "input",
    "role": "textbox",
    "placeholder": "搜索关键词",
    "type": "text",
    "hash": "a1b2c3d4",
    "stableHash": "e5f6g7h8"
  },
  "text": "要输入的内容"
}

现在请解析用户指令:
  "description": {              // click 操作时的目标元素描述
    "tag": "元素标签",
    "role": "ARIA role",
    "name": "aria-label 或 name",
    "text": "可见文本",
    "placeholder": "占位符"
  },
  "field": {                    // type 操作时的输入框描述
    "tag": "input",
    "role": "textbox",
    "placeholder": "占位符",
    "type": "input类型"
  },
  "text": "输入的文本（type时需要）",
  "direction": "up/down（scroll时需要）",
  "amount": 数值
}`

    try {
      const messages = [
        { id: 'system', role: 'system' as const, content: systemPrompt, timestamp: Date.now() },
        { id: 'user', role: 'user' as const, content: `指令：${instruction}`, timestamp: Date.now() }
      ]
      const response = await this.llmClient.chat(messages)

      const content = response.content?.trim()
      if (!content) {
        return { success: false, error: 'LLM 返回空内容', isBatch: false }
      }

      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : content

      const action: ParsedBrowserAction = JSON.parse(jsonStr)

      // 验证 ref 是否有效，并补齐元素信息
      if (action.ref !== undefined && action.ref !== null) {
        const element = context.elements.find(e => e.ref === action.ref)
        if (!element) {
          console.warn(`[BrowserAIParser] Selected ref ${action.ref} not found in DOM, falling back to analyze`)
          action.type = 'analyze'
          delete action.ref
        } else {
          // 补齐元素的完整信息（hash, stableHash 等）
          const enrichedDesc = {
            tag: element.tag,
            role: element.role,
            name: element.name,
            text: element.text,
            placeholder: element.placeholder,
            type: element.type,
            id: element.id,
            ariaLabel: element.ariaLabel,
            hash: element.hash,
            stableHash: element.stableHash
          }

          if (action.type === 'type' && action.field) {
            action.field = { ...enrichedDesc, ...action.field }
          } else if (action.description) {
            action.description = { ...enrichedDesc, ...action.description }
          }
        }
      }

      return { success: true, action, isBatch: false }
    } catch (error) {
      return {
        success: false,
        error: `解析失败: ${error instanceof Error ? error.message : String(error)}`,
        isBatch: false
      }
    }
  }

  /**
   * 构建 DOM 描述文本
   * 输出格式: ref | tag | role | type | placeholder | name | text | hash | stableHash
   */
  private buildDOMDescription(context: PageContext): string {
    const elementCount = context?.elements?.length || 0
    console.log(`[BrowserAIParser] Building DOM description from ${elementCount} elements`)
    console.log(`[BrowserAIParser] Page URL: ${context.url}`)
    console.log(`[BrowserAIParser] Page Title: ${context.title}`)

    if (!context?.elements || context.elements.length === 0) {
      console.log('[BrowserAIParser] No elements found in context')
      return '（页面暂无元素或需要等待加载）'
    }

    // 打印前 10 个元素用于调试
    console.log('[BrowserAIParser] First 10 elements:')
    context.elements.slice(0, 10).forEach(e => {
      console.log(`  ref=${e.ref}, tag=${e.tag}, role=${e.role}, type=${e.type}, text="${e.text?.substring(0, 30)}"`)
    })

    return context.elements
      .slice(0, 50) // 限制元素数量，避免超出 token 限制
      .map(e => {
        // 对于没有 name 的输入框，尝试使用 ariaLabel 或其他属性
        const displayName = e.name || e.ariaLabel || ''
        const parts = [
          String(e.ref),
          e.tag || '-',
          e.role || '-',
          e.type || '-',
          e.placeholder ? `"${e.placeholder.substring(0, 30)}"` : '-',
          displayName ? `"${displayName.substring(0, 30)}"` : '-',
          e.text ? `"${e.text.substring(0, 40)}"` : '-',
          e.hash ? e.hash.substring(0, 8) : '-',
          e.stableHash ? e.stableHash.substring(0, 8) : '-'
        ]
        return parts.join(' | ')
      })
      .join('\n')
  }

  /**
   * 解析 URL
   */
  private resolveUrl(target: string): string {
    const lower = target.toLowerCase()

    // 中文网站映射
    const mappings: Record<string, string> = {
      '百度': 'https://www.baidu.com',
      '百度翻译': 'https://fanyi.baidu.com',
      '百度地图': 'https://map.baidu.com',
      '美团': 'https://www.meituan.com',
      '淘宝': 'https://www.taobao.com',
      '天猫': 'https://www.tmall.com',
      '京东': 'https://www.jd.com',
      '知乎': 'https://www.zhihu.com',
      'bilibili': 'https://www.bilibili.com',
      'b站': 'https://www.bilibili.com',
      '微博': 'https://weibo.com',
      'github': 'https://github.com',
      '谷歌': 'https://www.google.com',
      'google': 'https://www.google.com'
    }

    for (const [keyword, url] of Object.entries(mappings)) {
      if (lower.includes(keyword.toLowerCase())) {
        return url
      }
    }

    // 直接是 URL
    if (target.match(/^https?:\/\//)) {
      return target
    }

    // 添加 https://
    if (target.includes('.')) {
      return `https://${target}`
    }

    // 默认搜索
    return `https://www.baidu.com/s?wd=${encodeURIComponent(target)}`
  }
}
