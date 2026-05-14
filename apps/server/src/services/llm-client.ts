/**
 * LLM Client 服务
 * 支持 OpenAI API（包括兼容 OpenAI 格式的国产模型）
 */

import type { Message, ToolCall, LLMResponse } from '../types/index.js'

export interface LLMConfig {
  model: string
  apiKey: string
  baseURL: string
  maxTokens?: number
  temperature?: number
}

export class LLMClient {
  private config: LLMConfig

  constructor(config: Partial<LLMConfig> = {}) {
    this.config = {
      model: config.model || process.env.LLM_MODEL || 'gpt-4',
      apiKey: config.apiKey || process.env.LLM_API_KEY || '',
      baseURL: config.baseURL || process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
      maxTokens: config.maxTokens || 4096,
      temperature: config.temperature || 0.7
    }
  }

  /**
   * 非流式对话
   */
  async chat(messages: Message[]): Promise<LLMResponse> {
    const response = await fetch(`${this.config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: this.formatMessages(messages),
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        tools: this.getTools(),
        tool_choice: 'auto'
      })
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`LLM API error: ${error}`)
    }

    const data: any = await response.json()
    const choice = data.choices[0]

    const toolCalls = choice.message.tool_calls?.map((tool: any) => ({
      id: tool.id,
      name: tool.function.name,
      arguments: JSON.parse(tool.function.arguments)
    }))

    return {
      content: choice.message.content || '',
      toolCalls: toolCalls?.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0
      }
    }
  }

  /**
   * 流式对话
   */
  async *streamChat(messages: Message[]): AsyncGenerator<string> {
    const response = await fetch(`${this.config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: this.formatMessages(messages),
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        stream: true
      })
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`LLM API error: ${error}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value)
      const lines = chunk.split('\n').filter(line => line.trim() !== '')

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') return

          try {
            const parsed = JSON.parse(data)
            const content = parsed.choices?.[0]?.delta?.content
            if (content) yield content
          } catch {
            // ignore
          }
        }
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
        return {
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
