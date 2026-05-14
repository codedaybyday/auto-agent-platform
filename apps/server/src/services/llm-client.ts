/**
 * LLM Client 服务
 * 统一封装 Claude/OpenAI/千问 等模型调用
 */

import Anthropic from '@anthropic-ai/sdk'
import type { Message, ToolCall, LLMResponse } from '../types/index.js'

export class LLMClient {
  private model: string
  private anthropic: Anthropic | null = null
  private apiKey: string

  constructor(model: string) {
    this.model = model
    this.apiKey = process.env.ANTHROPIC_API_KEY || ''

    if (this.apiKey) {
      this.anthropic = new Anthropic({
        apiKey: this.apiKey
      })
    }
  }

  /**
   * 非流式对话
   */
  async chat(messages: Message[]): Promise<LLMResponse> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized')
    }

    // 转换消息格式
    const formattedMessages = this.formatMessages(messages)

    // 定义可用工具
    const tools = this.getAvailableTools()

    try {
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 4096,
        messages: formattedMessages,
        tools: tools.length > 0 ? tools : undefined
      })

      // 解析响应
      const content = response.content
        .filter(c => c.type === 'text')
        .map(c => (c as any).text)
        .join('')

      const toolCalls = response.content
        .filter(c => c.type === 'tool_use')
        .map(c => ({
          id: (c as any).id,
          name: (c as any).name,
          arguments: (c as any).input
        }))

      return {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          promptTokens: response.usage?.input_tokens || 0,
          completionTokens: response.usage?.output_tokens || 0,
          totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
        }
      }
    } catch (error) {
      console.error('LLM API error:', error)
      throw error
    }
  }

  /**
   * 流式对话
   */
  async *streamChat(messages: Message[]): AsyncGenerator<string, void, unknown> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized')
    }

    const formattedMessages = this.formatMessages(messages)
    const tools = this.getAvailableTools()

    const stream = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: formattedMessages,
      tools: tools.length > 0 ? tools : undefined,
      stream: true
    })

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        yield chunk.delta.text
      }
    }
  }

  /**
   * 格式化消息为 Anthropic 格式
   */
  private formatMessages(messages: Message[]): any[] {
    return messages.map(msg => {
      if (msg.role === 'system') {
        // Anthropic 使用 system 字段，不是 message 角色
        return null
      }

      if (msg.role === 'tool') {
        return {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.toolResults?.[0]?.toolCallId || '',
            content: msg.content
          }]
        }
      }

      return {
        role: msg.role,
        content: msg.content
      }
    }).filter(Boolean) as any[]
  }

  /**
   * 获取可用工具定义
   */
  private getAvailableTools(): any[] {
    return [
      {
        name: 'browser',
        description: 'Control a web browser to navigate websites, interact with web pages, and extract information.',
        input_schema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['navigate', 'click', 'type', 'screenshot', 'get_text', 'scroll', 'wait', 'back', 'forward', 'close'],
              description: 'The browser action to perform'
            },
            url: {
              type: 'string',
              description: 'URL to navigate to (for navigate action)'
            },
            selector: {
              type: 'string',
              description: 'CSS selector for the target element'
            },
            text: {
              type: 'string',
              description: 'Text to type (for type action)'
            }
          },
          required: ['action']
        }
      },
      {
        name: 'bash',
        description: 'Execute bash commands on the local system.',
        input_schema: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The bash command to execute'
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
              default: 30000
            }
          },
          required: ['command']
        }
      },
      {
        name: 'file_read',
        description: 'Read content from a local file.',
        input_schema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The file path to read'
            }
          },
          required: ['path']
        }
      },
      {
        name: 'file_write',
        description: 'Write content to a local file.',
        input_schema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The file path to write'
            },
            content: {
              type: 'string',
              description: 'The content to write'
            }
          },
          required: ['path', 'content']
        }
      },
      {
        name: 'http_request',
        description: 'Make HTTP requests to external APIs.',
        input_schema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to request'
            },
            method: {
              type: 'string',
              enum: ['GET', 'POST', 'PUT', 'DELETE'],
              default: 'GET'
            },
            headers: {
              type: 'object',
              description: 'Request headers'
            },
            body: {
              type: 'object',
              description: 'Request body (for POST/PUT)'
            }
          },
          required: ['url']
        }
      }
    ]
  }

  /**
   * 计算 Token 数（估算）
   */
  estimateTokens(text: string): number {
    // 简单估算：中文 1 字 ≈ 2 tokens，英文 1 词 ≈ 1.3 tokens
    const chineseChars = (text.match(/[一-龥]/g) || []).length
    const englishWords = text.split(/\s+/).length
    return Math.ceil(chineseChars * 2 + englishWords * 1.3)
  }
}
