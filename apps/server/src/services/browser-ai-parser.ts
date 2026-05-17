/**
 * Browser AI 语义解析器
 * 将自然语言指令解析为结构化的浏览器动作
 *
 * 支持基于页面 DOM 上下文的智能解析
 */

import { LLMClient } from './llm-client.js'

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

export interface ParsedBrowserAction {
  type: 'navigate' | 'click' | 'type' | 'select' | 'hover' | 'scroll' | 'wait' | 'screenshot' | 'analyze' | 'back' | 'forward' | 'close'
  url?: string
  ref?: number
  description?: ElementSemanticDescription  // 语义描述，用于回退定位
  text?: string
  field?: ElementSemanticDescription  // 输入框的语义描述
  direction?: 'up' | 'down'
  amount?: number
  option?: string
  timeout?: number
  fullPage?: boolean
}

export interface ParseResult {
  success: boolean
  action?: ParsedBrowserAction
  error?: string
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
    // 导航指令不需要上下文，直接处理
    const navResult = this.tryParseNavigation(instruction)
    if (navResult) {
      return navResult
    }

    // 其他指令需要上下文才能精确定位
    if (!context) {
      return {
        success: false,
        error: '需要页面上下文来解析此指令'
      }
    }

    return this.parseWithContext(instruction, context)
  }

  /**
   * 尝试解析导航指令
   */
  private tryParseNavigation(instruction: string): ParseResult | null {
    const lower = instruction.toLowerCase()

    // 检查是否是导航指令
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
          action: { type: 'navigate', url }
        }
      }
    }

    // 直接包含 http 的 URL
    const urlMatch = instruction.match(/(https?:\/\/[^\s]+)/i)
    if (urlMatch) {
      return {
        success: true,
        action: { type: 'navigate', url: urlMatch[1] }
      }
    }

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
    console.log(`[BrowserAIParser] Context has ${context.elements.length} elements`)

    // 查找 textarea 元素
    const textareas = context.elements.filter(e => e.tag === 'textarea')
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
        return { success: false, error: 'LLM 返回空内容' }
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

      return { success: true, action }
    } catch (error) {
      return {
        success: false,
        error: `解析失败: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  /**
   * 构建 DOM 描述文本
   * 输出格式: ref | tag | role | type | placeholder | name | text | hash | stableHash
   */
  private buildDOMDescription(context: PageContext): string {
    console.log(`[BrowserAIParser] Building DOM description from ${context.elements.length} elements`)
    console.log(`[BrowserAIParser] Page URL: ${context.url}`)
    console.log(`[BrowserAIParser] Page Title: ${context.title}`)

    if (context.elements.length === 0) {
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
        const parts = [
          String(e.ref),
          e.tag || '-',
          e.role || '-',
          e.type || '-',
          e.placeholder ? `"${e.placeholder.substring(0, 30)}"` : '-',
          e.name ? `"${e.name.substring(0, 30)}"` : '-',
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
