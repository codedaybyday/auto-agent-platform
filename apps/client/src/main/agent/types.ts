import { Anthropic } from '@anthropic-ai/sdk'

export interface Tool {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export interface ToolResult {
  tool_use_id: string
  content: string
  is_error?: boolean
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  tool_calls?: ToolCall[]
  tool_results?: ToolResult[]
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface AgentState {
  messages: Message[]
  isProcessing: boolean
  systemPrompt: string
}

export type AnthropicMessage = Anthropic.Messages.MessageParam

export interface BrowserState {
  page: unknown | null
  browser: unknown | null
  context: unknown | null
  currentUrl: string | null
}

export interface BashResult {
  stdout: string
  stderr: string
  exitCode: number
}
