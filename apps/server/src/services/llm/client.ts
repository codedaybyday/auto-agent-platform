/**
 * LLM Client 服务
 * 支持 OpenAI API、Ollama 本地部署（OpenAI 兼容格式）
 */

import type { Message, ToolCall, LLMResponse } from '../../types/index.js'
import { RateLimiter } from '../rate-limiter.js'

export interface LLMConfig {
  model: string
  apiKey: string
  baseURL: string
  maxTokens?: number
  temperature?: number
  provider?: 'openai' | 'ollama' | 'anthropic' | 'custom'
}

/**
 * LLM API 错误类
 * 包含状态码和友好错误消息
 */
export class LLMAPIError extends Error {
  public statusCode: number
  public isQuotaExceeded: boolean

  constructor(message: string, statusCode: number = 500) {
    super(message)
    this.name = 'LLMAPIError'
    this.statusCode = statusCode
    this.isQuotaExceeded = statusCode === 429
  }
}

/**
 * 检测 LLM 提供商类型
 */
function detectProvider(baseURL: string): LLMConfig['provider'] {
  if (baseURL.includes('localhost:11434') || baseURL.includes('127.0.0.1:11434')) {
    return 'ollama'
  }
  if (baseURL.includes('anthropic') || baseURL.includes('claude')) {
    return 'anthropic'
  }
  if (baseURL.includes('openai.com')) {
    return 'openai'
  }
  return 'custom'
}

export class LLMClient {
  private config: LLMConfig
  public readonly provider: LLMConfig['provider']
  public readonly isLocal: boolean
  private rateLimiter?: RateLimiter

  constructor(config: Partial<LLMConfig> = {}, rateLimiter?: RateLimiter) {
    this.rateLimiter = rateLimiter
    const baseURL = config.baseURL || process.env.LLM_BASE_URL || 'https://api.openai.com/v1'
    this.provider = config.provider || detectProvider(baseURL)
    this.isLocal = this.provider === 'ollama' || baseURL.includes('localhost') || baseURL.includes('127.0.0.1')

    this.config = {
      model: config.model || process.env.LLM_MODEL || 'gpt-4',
      // Ollama 本地部署不需要 API Key
      apiKey: config.apiKey || process.env.LLM_API_KEY || (this.isLocal ? 'ollama' : ''),
      baseURL,
      maxTokens: config.maxTokens || 4096,
      temperature: config.temperature || 0.7,
      provider: this.provider
    }
  }

  /**
   * 检查 Ollama 服务是否可用
   */
  async checkOllamaConnection(): Promise<{ ok: boolean; message: string; models?: string[] }> {
    if (!this.isLocal) {
      return { ok: true, message: '非本地提供商，跳过连接检查' }
    }

    try {
      // Ollama 原生 API 获取模型列表（OpenAI 兼容端点没有 /v1/models）
      const baseURL = this.config.baseURL.replace('/v1', '')
      const url = `${baseURL}/api/tags`
      console.log(`[LLMClient] Checking Ollama at: ${url}`)

      const response = await fetch(url, { method: 'GET' })

      console.log(`[LLMClient] Checked Ollama at: ${url}`)

      if (!response.ok) {
        return {
          ok: false,
          message: `Ollama 服务未响应，请确保 Ollama 已启动: ollama serve`
        }
      }

      const data = await response.json() as { models?: Array<{ name: string }> }
      const models = data.models?.map(m => m.name) || []
      console.log(`[LLMClient] Available models:`, models)

      // 检查指定模型是否可用（支持带或不带 :tag）
      const modelExists = models.some(m =>
        m === this.config.model ||
        m.startsWith(`${this.config.model}:`)
      )

      if (!modelExists) {
        return {
          ok: false,
          message: `模型 "${this.config.model}" 未找到。可用模型: ${models.join(', ') || '无'}。请运行: ollama pull ${this.config.model}`,
          models
        }
      }

      return {
        ok: true,
        message: `Ollama 连接正常，模型 "${this.config.model}" 可用`,
        models
      }
    } catch (error: any) {
      // 处理连接失败错误
      const errorMessage = error?.message || String(error)

      if (errorMessage.includes('ECONNREFUSED')) {
        return {
          ok: false,
          message: `无法连接到 Ollama 服务 (${this.config.baseURL})。请确保 Ollama 已启动: ollama serve`
        }
      }

      if (errorMessage.includes('fetch failed')) {
        return {
          ok: false,
          message: `无法连接到 Ollama 服务。请检查: 1) Ollama 是否已运行 (ollama serve) 2) 端口 11434 是否被占用`
        }
      }

      return {
        ok: false,
        message: `连接 Ollama 失败: ${errorMessage.slice(0, 200)}`
      }
    }
  }

  /**
   * 获取请求头
   * Ollama 本地部署时 Authorization 是可选的
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }

    // Ollama 本地部署时 API Key 可以为空，但仍然发送标准头
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`
    }

    return headers
  }

  /**
   * 获取请求体
   * 针对不同提供商调整参数
   */
  private getRequestBody(messages: Message[], options: { stream?: boolean; includeTools?: boolean; responseFormat?: 'json' | 'text' } = {}): object {
    const body: Record<string, any> = {
      model: this.config.model,
      messages: this.formatMessages(messages),
      temperature: this.config.temperature
    }

    // Ollama 某些版本对 max_tokens 支持不稳定，可选添加
    if (!this.isLocal) {
      body.max_tokens = this.config.maxTokens
    }

    // 流式输出
    if (options.stream) {
      body.stream = true
    }

    // 强制 JSON 输出（OpenAI 兼容格式）
    if (options.responseFormat === 'json') {
      body.response_format = { type: 'json_object' }
    }

    // 工具调用（部分本地模型可能不支持）
    if (options.includeTools && this.supportsTools()) {
      body.tools = this.getTools()
      body.tool_choice = 'auto'
    }

    return body
  }

  /**
   * 检测当前模型是否支持工具调用
   */
  private supportsTools(): boolean {
    // Ollama 的某些模型支持工具调用，但需要较新版本
    if (this.isLocal) {
      // 目前 Ollama 工具调用支持仍在发展中，默认禁用以确保兼容性
      // 用户可以通过环境变量启用: LLM_ENABLE_TOOLS=true
      return process.env.LLM_ENABLE_TOOLS === 'true'
    }
    return true
  }

  /**
   * 解析错误响应，返回友好中文消息
   */
  private parseError(response: Response, errorText: string): LLMAPIError {
    let errorMessage: string

    // 尝试解析错误 JSON
    let errorDetail = errorText
    try {
      const errorJson = JSON.parse(errorText)
      errorDetail = errorJson.error?.message || errorJson.message || errorText
    } catch {
      // 保持原始错误文本
    }

    switch (response.status) {
      case 429:
        if (this.isLocal) {
          errorMessage = '本地模型处理过于繁忙，请稍后再试'
        } else if (errorDetail.includes('达到使用量上限') || errorDetail.includes('quota')) {
          errorMessage = 'API 使用量已达上限，请检查您的账户余额或联系服务提供商'
        } else {
          errorMessage = '请求过于频繁，请稍后再试'
        }
        break
      case 401:
        errorMessage = this.isLocal
          ? '本地服务认证失败，请检查 Ollama 配置'
          : 'API 密钥无效或已过期，请检查配置'
        break
      case 403:
        errorMessage = '没有权限访问该 API，请检查账户权限'
        break
      case 404:
        if (this.isLocal) {
          errorMessage = `模型 "${this.config.model}" 不存在，请运行: ollama pull ${this.config.model}`
        } else {
          errorMessage = '模型不存在或不可用，请检查模型配置'
        }
        break
      case 400:
        if (errorDetail.includes('tool') || errorDetail.includes('function')) {
          errorMessage = '当前模型可能不支持工具调用，请尝试使用其他模型或在 .env 中设置 LLM_ENABLE_TOOLS=false'
        } else {
          errorMessage = `请求参数错误: ${errorDetail.slice(0, 100)}`
        }
        break
      case 500:
      case 502:
      case 503:
      case 504:
        errorMessage = this.isLocal
          ? '本地 LLM 服务暂时不可用，请检查 Ollama 是否正常运行'
          : 'LLM 服务暂时不可用，请稍后再试'
        break
      default:
        errorMessage = `LLM API 错误 (${response.status}): ${errorDetail.slice(0, 200)}`
    }

    return new LLMAPIError(errorMessage, response.status)
  }

  /**
   * 非流式对话
   */
  async chat(messages: Message[], userId?: string, options?: { includeTools?: boolean; responseFormat?: 'json' | 'text' }): Promise<LLMResponse> {
    // 检查限流（如果提供了userId）
    if (this.rateLimiter && userId) {
      const check = this.rateLimiter.checkLLMRequest(userId)
      if (!check.allowed) {
        throw new LLMAPIError(
          `请求过于频繁，请 ${check.retryAfter} 秒后再试`,
          429
        )
      }
    }

    const response = await fetch(`${this.config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(this.getRequestBody(messages, {
        includeTools: options?.includeTools ?? true,
        responseFormat: options?.responseFormat
      }))
    })

    if (!response.ok) {
      throw this.parseError(response, await response.text())
    }

    const data: any = await response.json()
    const choice = data.choices[0]

    console.log('[LLMClient] 模型原始返回:', JSON.stringify(choice))
    // 某些本地模型可能不返回 tool_calls
    const toolCalls = choice.message?.tool_calls?.map((tool: any) => ({
      id: tool.id,
      name: tool.function.name,
      arguments: JSON.parse(tool.function.arguments)
    }))

    return {
      content: choice.message?.content || '',
      reasoningContent: choice.message?.reasoning_content || '',
      toolCalls: toolCalls?.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0
      }
    }
  }

  /**
   * 流式对话（支持工具调用）
   * @param messages 消息列表
   * @param onChunk 每当有内容 chunk 或 tool_call delta 时调用
   * @param userId 用户ID（用于限流检查）
   * @returns 完整响应（包含 content 和 toolCalls）
   */
  async streamChat(
    messages: Message[],
    onChunk?: (chunk: string, toolCallDelta?: any) => void,
    userId?: string
  ): Promise<LLMResponse> {
    // 检查限流
    if (this.rateLimiter && userId) {
      const check = this.rateLimiter.checkLLMRequest(userId)
      if (!check.allowed) {
        throw new LLMAPIError(
          `请求过于频繁，请 ${check.retryAfter} 秒后再试`,
          429
        )
      }
    }

    const response = await fetch(`${this.config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(this.getRequestBody(messages, { stream: true, includeTools: true }))
    })

    if (!response.ok) {
      throw this.parseError(response, await response.text())
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let fullContent = ''
    let fullReasoningContent = ''
    const toolCallChunks: Map<number, any> = new Map()
    let usageData: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } = {}

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value)
      const lines = chunk.split('\n').filter(line => line.trim() !== '')

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)

            // 捕获 usage 数据（在流的最后）
            if (parsed.usage) {
              usageData = parsed.usage
            }

            const delta = parsed.choices?.[0]?.delta

            // 处理内容
            if (delta?.content) {
              fullContent += delta.content
              onChunk?.(delta.content, undefined)
            }

            // 处理 reasoning_content（DeepSeek 等模型）
            if (delta?.reasoning_content) {
              fullReasoningContent += delta.reasoning_content
            }

            // 累积 tool_calls
            if (delta?.tool_calls) {
              for (const toolCall of delta.tool_calls) {
                const index = toolCall.index
                if (!toolCallChunks.has(index)) {
                  toolCallChunks.set(index, {
                    id: toolCall.id,
                    function: { name: '', arguments: '' }
                  })
                }
                const existing = toolCallChunks.get(index)
                if (toolCall.function?.name) {
                  existing.function.name = toolCall.function.name
                }
                if (toolCall.function?.arguments) {
                  existing.function.arguments += toolCall.function.arguments
                }
                // 通知 tool_call delta
                onChunk?.('', toolCall)
              }
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    }

    // 构建 toolCalls
    const toolCalls: ToolCall[] = []
    for (let i = 0; i < toolCallChunks.size; i++) {
      const chunk = toolCallChunks.get(i)
      if (chunk) {
        try {
          toolCalls.push({
            id: chunk.id,
            name: chunk.function.name,
            arguments: JSON.parse(chunk.function.arguments)
          })
        } catch (e) {
          console.error(`[LLMClient] Failed to parse tool call arguments for ${chunk.function?.name}:`, e)
        }
      }
    }

    return {
      content: fullContent,
      reasoningContent: fullReasoningContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: usageData.prompt_tokens || 0,
        completionTokens: usageData.completion_tokens || 0,
        totalTokens: usageData.total_tokens || 0
      }
    }
  }

  /**
   * 格式化消息
   */
  private formatMessages(messages: Message[]): any[] {
    return messages.map(msg => {
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: msg.toolResults?.[0]?.toolCallId,
          content: msg.content
        }
      }
      if (msg.role === 'assistant' && msg.toolCalls) {
        const result: any = {
          role: 'assistant',
          content: msg.content,
          tool_calls: msg.toolCalls.map(tool => ({
            id: tool.id,
            type: 'function',
            function: {
              name: tool.name,
              arguments: JSON.stringify(tool.arguments)
            }
          }))
        }
        if (msg.reasoningContent) {
          result.reasoning_content = msg.reasoningContent
        }
        return result
      }
      if (msg.role === 'assistant' && msg.reasoningContent) {
        return {
          role: 'assistant',
          content: msg.content,
          reasoning_content: msg.reasoningContent
        }
      }
      return {
        role: msg.role,
        content: msg.content
      }
    })
  }

  /**
   * 工具定义
   */
  private getTools(): any[] {
    return [
      {
        type: 'function',
        function: {
          name: 'browser',
          description: 'Control a web browser to navigate websites',
          parameters: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['navigate', 'click', 'type', 'screenshot', 'get_text', 'scroll', 'wait', 'back', 'forward', 'close']
              },
              url: { type: 'string' },
              selector: { type: 'string' },
              text: { type: 'string' }
            },
            required: ['action']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'browser_ai',
          description: `Use AI-powered browser automation with natural language instructions.
This tool provides semantic browser control with automatic element detection, snapshot-based interaction, and enhanced security.

Available operations:
- "go to [url]": Navigate to a website (e.g., "go to github.com")
- "click [element]": Click on an element by text or description (e.g., "click Sign in button")
- "type [text] in [field]": Type text into an input field (e.g., "type hello in search box")
- "search for [keyword]": Perform a search (e.g., "search for TypeScript tutorials")
- "scroll up/down": Scroll the page
- "screenshot": Capture a screenshot
- "wait [ms]": Wait for a specified time
- "get page summary": Get a summary of the current page with available elements

You can also use stable references from previous snapshots (e.g., "click ref e5").

This tool is preferred over the basic 'browser' tool for complex tasks requiring intelligent element detection.`,
          parameters: {
            type: 'object',
            properties: {
              instruction: {
                type: 'string',
                description: 'Natural language instruction describing the browser action to perform'
              },
              use_snapshot: {
                type: 'boolean',
                description: 'Whether to use snapshot-based element references (default: true)',
                default: true
              },
              ref: {
                type: 'string',
                description: 'Optional: Stable reference ID from a previous snapshot (e.g., "e5", "ax3")'
              }
            },
            required: ['instruction']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'bash',
          description: 'Execute bash commands',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' },
              timeout: { type: 'number' }
            },
            required: ['command']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'file_read',
          description: 'Read a local file',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' }
            },
            required: ['path']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'file_write',
          description: 'Write to a local file',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' }
            },
            required: ['path', 'content']
          }
        }
      }
    ]
  }
}
