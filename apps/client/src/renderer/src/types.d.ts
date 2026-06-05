import type { Message, ToolCall, ToolResult, ModelConfig } from '@auto-agent/shared-types'

export type { Message, ToolCall, ToolResult, ModelConfig } from '@auto-agent/shared-types'

export interface Session {
  id: string
  title: string
  updatedAt: number
  messageCount: number
}

/**
 * Agent API 接口
 * 定义主进程暴露给渲染进程的 API
 */
export interface AgentAPI {
  /** 初始化 Agent */
  init: (config: { apiKey: string; modelConfig: ModelConfig }) => Promise<{ success: boolean; sessionId?: string; error?: string }>
  /** 发送消息 */
  sendMessage: (content: string) => Promise<{ success: boolean; error?: string }>
  /** 清空对话历史 */
  clearHistory: () => Promise<{ success: boolean; error?: string }>
  /** 获取所有消息 */
  getMessages: () => Promise<{ success: boolean; messages?: Message[]; error?: string }>
  /** 获取会话列表 */
  getSessions: () => Promise<{ success: boolean; sessions?: Session[]; error?: string }>
  /** 获取指定会话的消息历史 */
  getSessionMessages: (sessionId: string) => Promise<{ success: boolean; messages?: Message[]; error?: string }>
  /** 创建新会话 */
  createSession: () => Promise<{ success: boolean; sessionId?: string; error?: string }>
  /** 切换会话 */
  switchSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  /** 删除会话 */
  deleteSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  /** 重命名会话 */
  renameSession: (sessionId: string, title: string) => Promise<{ success: boolean; error?: string }>
  /** 监听新消息 */
  onMessage: (callback: (message: Message) => void) => () => void
  /** 监听流式消息块（SSE 逐字输出） */
  onStreamChunk: (callback: (data: { chunk: string; sessionId?: string }) => void) => () => void
  /** 监听流式结束 */
  onStreamDone: (callback: (data: { sessionId?: string }) => void) => () => void
  /** 监听处理状态 */
  onProcessing: (callback: (data: { processing: boolean; sessionId?: string }) => void) => () => void
  /** 监听工具开始执行 */
  onToolStart: (callback: (data: { toolCall: ToolCall }) => void) => () => void
  /** 监听工具执行完成 */
  onToolResult: (callback: (data: { toolCall: ToolCall; result: ToolResult }) => void) => () => void
  /** 监听工具结果消息 */
  onToolResults: (callback: (message: Message) => void) => () => void
  /** 监听历史清空 */
  onHistoryCleared: (callback: () => void) => () => void
  /** 监听会话列表更新 */
  onSessionsUpdated: (callback: (sessions: Session[]) => void) => () => void
  /** 监听会话切换 */
  onSessionSwitched: (callback: (sessionId: string) => void) => () => void
  /** SSO 登录 */
  login: () => Promise<{ success: boolean; error?: string }>
  /** SSO 查询当前登录用户 */
  whoami: () => Promise<{ success: boolean; error?: string, data: any }>
  /** SSO 登出 */
  logout: () => Promise<{ success: boolean; error?: string }>
}

declare global {
  interface Window {
    api: {
      agent: AgentAPI
    }
  }
}

export {}
