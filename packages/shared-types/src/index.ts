/**
 * Auto Agent Platform - 共享类型定义
 * 这些类型在客户端和服务端之间共享
 */

// ==================== API 协议类型 ====================

/**
 * API 协议类型
 * - anthropic-messages: Anthropic Messages API 协议
 * - openai-chat-completion: OpenAI Chat Completions API 协议
 */
export type ApiProtocol = 'anthropic-messages' | 'openai-chat-completion'

/**
 * 模型配置接口
 */
export interface ModelConfig {
  /** 配置唯一标识 */
  id: string
  /** 显示名称 */
  name: string
  /** 实际模型名称 */
  model: string
  /** API 基础 URL */
  baseURL: string
  /** API 协议类型 */
  protocol: ApiProtocol
  /** 配置描述 */
  description?: string
}

// ==================== Agent 类型 ====================

/**
 * 工具调用信息
 */
export interface ToolCall {
  /** 工具调用唯一标识 */
  id: string
  /** 工具名称 */
  name: string
  /** 工具参数 */
  input: Record<string, unknown>
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  /** 对应的工具调用 ID */
  tool_use_id: string
  /** 结果内容 */
  content: string
  /** 是否为错误结果 */
  is_error?: boolean
}

/**
 * 对话消息
 */
export interface Message {
  /** 消息唯一标识 */
  id: string
  /** 发送者角色 */
  role: 'user' | 'assistant'
  /** 消息内容 */
  content: string
  /** 发送时间戳 */
  timestamp: number
  /** 包含的工具调用请求 */
  tool_calls?: ToolCall[]
  /** 包含的工具执行结果 */
  tool_results?: ToolResult[]
}

/**
 * Agent 状态
 */
export interface AgentState {
  messages: Message[]
  isProcessing: boolean
  systemPrompt: string
}

// ==================== 工具类型 ====================

/**
 * 工具定义
 */
export interface Tool {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

/**
 * 工具定义（用于 LLM 客户端）
 */
export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

/**
 * Bash 命令执行结果
 */
export interface BashResult {
  stdout: string
  stderr: string
  exitCode: number
}

// ==================== API 通信类型 ====================

/**
 * WebSocket 消息类型
 */
export type WebSocketMessageType =
  | 'connected'
  | 'message'
  | 'tool_start'
  | 'tool_result'
  | 'processing'
  | 'error'
  | 'ping'
  | 'pong'

/**
 * WebSocket 消息
 */
export interface WebSocketMessage<T = unknown> {
  type: WebSocketMessageType
  data: T
}

/**
 * 发送消息请求
 */
export interface SendMessageRequest {
  content: string
}

/**
 * 连接成功响应
 */
export interface ConnectedResponse {
  sessionId: string
}

// ==================== 用户/认证类型 ====================

/**
 * 用户信息
 */
export interface User {
  id: string
  email: string
  name: string
  avatar?: string
  createdAt: string
}

/**
 * JWT Payload
 */
export interface JWTPayload {
  userId: string
  email: string
  iat: number
  exp: number
}

// ==================== 错误类型 ====================

/**
 * API 错误码
 */
export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'QUOTA_EXCEEDED'
  | 'SESSION_NOT_FOUND'
  | 'INTERNAL_ERROR'
  | 'RATE_LIMITED'

/**
 * API 错误
 */
export interface APIError {
  code: ErrorCode
  message: string
}
