import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { ModelConfig } from '../config/models'

/**
 * LLM 消息类型
 * 统一不同 API 协议的消息格式
 */
export type LLMMessage =
  | { role: 'user' | 'assistant'; content: string }
  | { role: 'tool'; tool_call_id: string; content: string }

/**
 * 工具定义接口
 * 描述一个工具的名称、描述和参数结构
 */
export interface ToolDefinition {
  /** 工具名称 */
  name: string
  /** 工具功能描述 */
  description: string
  /** 工具参数 JSON Schema */
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

/**
 * 工具调用信息
 * 记录模型请求调用某个工具的参数
 */
export interface ToolCall {
  /** 工具调用唯一标识 */
  id: string
  /** 要调用的工具名称 */
  name: string
  /** 工具参数（JSON 字符串） */
  arguments: string
}

/**
 * LLM 响应接口
 * 包含模型的文本回复和工具调用请求
 */
export interface LLMResponse {
  /** 文本回复内容 */
  content: string
  /** 请求调用的工具列表 */
  tool_calls?: ToolCall[]
}

/**
 * LLM 客户端抽象基类
 * 定义所有 LLM 客户端必须实现的接口
 */
export abstract class LLMClient {
  /**
   * 发送聊天请求
   * @param messages - 对话历史消息列表
   * @param tools - 可用工具定义列表
   * @param systemPrompt - 系统提示词（可选）
   * @returns 模型的响应内容
   */
  abstract chat(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    systemPrompt?: string
  ): Promise<LLMResponse>
}

/**
 * Message API 客户端
 * 实现 Anthropic Messages API 协议（Claude 系列）
 */
export class MessageApiClient extends LLMClient {
  private client: Anthropic
  private model: string

  constructor(apiKey: string, model: string, baseURL?: string) {
    super()
    this.model = model
    this.client = new Anthropic({ apiKey, baseURL })
  }

  async chat(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    systemPrompt?: string
  ): Promise<LLMResponse> {
    // 将统一消息格式转换为 Anthropic Messages API 格式
    const anthropicMessages = messages.map((m) => {
      if (m.role === 'tool') {
        // 工具返回结果用 XML 标签包裹
        return {
          role: 'user' as const,
          content: `<tool_result tool_use_id="${m.tool_call_id}">\n${m.content}\n</tool_result>`
        }
      }
      return { role: m.role, content: m.content }
    })

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: anthropicMessages,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }))
    })

    // 解析响应内容块
    let content = ''
    const tool_calls: ToolCall[] = []

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text
      } else if (block.type === 'tool_use') {
        tool_calls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input)
        })
      }
    }

    return { content, tool_calls }
  }
}

/**
 * Chat Completion 客户端
 * 实现 OpenAI Chat Completions API 协议
 * 支持 OpenAI、千问、DeepSeek 等兼容该协议的模型
 */
export class ChatCompletionClient extends LLMClient {
  private client: OpenAI
  private model: string

  constructor(apiKey: string, model: string, baseURL: string) {
    super()
    this.model = model
    this.client = new OpenAI({ apiKey, baseURL })
  }

  async chat(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    systemPrompt?: string
  ): Promise<LLMResponse> {
    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []

    // 添加系统提示词
    if (systemPrompt) {
      openaiMessages.push({ role: 'system', content: systemPrompt })
    }

    // 转换消息格式
    for (const m of messages) {
      if (m.role === 'tool') {
        openaiMessages.push({
          role: 'tool',
          tool_call_id: m.tool_call_id,
          content: m.content
        })
      } else {
        openaiMessages.push({ role: m.role, content: m.content })
      }
    }

    // 转换工具定义格式
    const openaiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }))

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      tool_choice: openaiTools.length > 0 ? 'auto' : undefined
    })

    const choice = response.choices[0]
    const message = choice.message

    // 解析工具调用
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tool_calls = message.tool_calls?.map((tc: any) => ({
      id: tc.id,
      name: tc.function?.name || '',
      arguments: tc.function?.arguments || ''
    }))

    return {
      content: message.content || '',
      tool_calls
    }
  }
}

/**
 * LLM 客户端工厂函数
 * 根据配置自动选择合适的客户端实现
 * @param config - 模型配置
 * @param apiKey - API 密钥
 * @returns 对应的 LLMClient 实例
 */
export function createLLMClient(config: ModelConfig, apiKey: string): LLMClient {
  // 根据协议类型选择客户端
  if (config.protocol === 'anthropic-messages') {
    return new MessageApiClient(apiKey, config.model, config.baseURL)
  }

  // 默认使用 OpenAI 兼容接口
  return new ChatCompletionClient(apiKey, config.model, config.baseURL)
}
