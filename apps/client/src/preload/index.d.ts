import { ElectronAPI } from '@electron-toolkit/preload'
import type { Message, ToolCall, ToolResult, ModelConfig, ApiProtocol } from '@auto-agent/shared-types'

export type { Message, ToolCall, ToolResult, ModelConfig, ApiProtocol } from '@auto-agent/shared-types'

/**
 * Agent API 接口
 */
export interface AgentAPI {
  init: (config: { apiKey: string; modelConfig: ModelConfig }) => Promise<{ success: boolean; error?: string }>
  sendMessage: (content: string) => Promise<{ success: boolean; error?: string }>
  clearHistory: () => Promise<{ success: boolean; error?: string }>
  getMessages: () => Promise<{ success: boolean; messages?: Message[]; error?: string }>
  onMessage: (callback: (message: Message) => void) => () => void
  onStreamChunk: (callback: (data: { chunk: string; sessionId?: string }) => void) => () => void
  onStreamDone: (callback: (data: { sessionId?: string }) => void) => () => void
  onProcessing: (callback: (isProcessing: boolean) => void) => () => void
  onToolStart: (callback: (data: { toolCall: ToolCall }) => void) => () => void
  onToolResult: (callback: (data: { toolCall: ToolCall; result: ToolResult }) => void) => () => void
  onToolResults: (callback: (message: Message) => void) => () => void
  onHistoryCleared: (callback: () => void) => () => void
  onSessionTitleUpdated: (callback: (data: { sessionId: string; title: string }) => void) => () => void
  login: () => Promise<{ success: boolean; error?: string }>
}

interface CustomAPI {
  agent: AgentAPI
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: CustomAPI
  }
}

export {}
