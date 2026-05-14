/**
 * 服务端类型定义
 */

// ==================== Agent Loop 类型 ====================

export interface AgentLoopConfig {
  maxIterations: number
  model: string
  systemPrompt: string
  baseURL?: string
}

export interface LoopState {
  sessionId: string
  status: 'idle' | 'running' | 'waiting_tool' | 'paused' | 'completed' | 'error'
  iteration: number
  messages: Message[]
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  timestamp: number
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, any>
}

export interface ToolResult {
  toolCallId: string
  success: boolean
  data?: any
  error?: string
  executionTime: number
  metadata?: {
    screenshot?: string
    logs?: string[]
  }
}

export interface LLMResponse {
  content?: string
  toolCalls?: ToolCall[]
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

// ==================== WebSocket 类型 ====================

export enum MessageType {
  // 连接管理
  CONNECT = 'connect',
  CONNECT_ACK = 'connect_ack',
  PING = 'ping',
  PONG = 'pong',
  DISCONNECT = 'disconnect',

  // 会话管理
  SESSION_CREATE = 'session.create',
  SESSION_CREATE_ACK = 'session.create_ack',
  SESSION_LIST = 'session.list',
  SESSION_SWITCH = 'session.switch',

  // Agent Loop 控制
  AGENT_RUN = 'agent.run',
  AGENT_PAUSE = 'agent.pause',
  AGENT_RESUME = 'agent.resume',
  AGENT_STOP = 'agent.stop',

  // 流式输出
  STREAM_CHUNK = 'stream.chunk',
  STREAM_COMPLETE = 'stream.complete',
  STREAM_ERROR = 'stream.error',

  // 工具执行（反向通道核心）
  TOOL_EXECUTE = 'tool.execute',
  TOOL_EXECUTE_ACK = 'tool.execute_ack',
  TOOL_PROGRESS = 'tool.progress',
  TOOL_RESULT = 'tool.result',
  TOOL_ERROR = 'tool.error',

  // 状态同步
  STATE_SYNC = 'state.sync',
  STATE_UPDATE = 'state.update'
}

export interface WSMessage {
  type: MessageType
  messageId: string
  timestamp: number
  sessionId?: string
  payload?: any
}

// ==================== 会话类型 ====================

export interface Session {
  id: string
  userId: string
  title: string
  status: 'active' | 'idle' | 'suspended'
  createdAt: Date
  updatedAt: Date
  messages: Message[]
  metadata: {
    model: string
    totalTokens: number
    toolUsageCount: number
  }
}

export interface SessionContext {
  sessionId: string
  userId: string
  instanceId: string
  wsConnectionId: string
  createdAt: Date
  lastActiveAt: Date
  status: 'active' | 'idle' | 'suspended'
}

// ==================== 工具类型 ====================

export enum ToolType {
  LOCAL = 'local',
  REMOTE = 'remote',
  HYBRID = 'hybrid'
}

export interface Tool {
  name: string
  description: string
  type: ToolType
  inputSchema: object
  execute: (input: any) => Promise<ToolResult>
}

// ==================== 用户配额类型 ====================

export interface UserQuota {
  maxConcurrentSessions: number
  maxDailyTokens: number
  maxDailyToolCalls: number
  maxStorageMB: number
}

export interface QuotaUsage {
  tier: string
  sessions: { used: number; total: number }
  tokens: { used: number; total: number }
  toolCalls: { used: number; total: number }
}

// ==================== WebSocket 连接类型 ====================

export interface WSConnection {
  id: string
  userId: string
  socket: any
  connectedAt: Date
  lastPingAt: Date
  isAlive: boolean
  subscriptions: Set<string>
}

// ==================== 错误类型 ====================

export class AgentError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message)
    this.name = 'AgentError'
  }
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfter: number
  ) {
    super(message)
    this.name = 'RateLimitError'
  }
}
