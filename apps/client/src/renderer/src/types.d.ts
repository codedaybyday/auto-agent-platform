import type { Message, ToolCall, ToolResult, ModelConfig } from '@auto-agent/shared-types'

export type { Message, ToolCall, ToolResult, ModelConfig } from '@auto-agent/shared-types'

/**
 * Agent API 接口
 * 定义主进程暴露给渲染进程的 API
 */
export interface AgentAPI {
  /** 初始化 Agent */
  init: (config: { apiKey: string; modelConfig: ModelConfig }) => Promise<{ success: boolean; error?: string }>
  /** 发送消息 */
  sendMessage: (content: string) => Promise<{ success: boolean; error?: string }>
  /** 清空对话历史 */
  clearHistory: () => Promise<{ success: boolean; error?: string }>
  /** 获取所有消息 */
  getMessages: () => Promise<{ success: boolean; messages?: Message[]; error?: string }>
  /** 监听新消息事件 */
  onMessage: (callback: (message: Message) => void) => () => void
  /** 监听处理状态事件 */
  onProcessing: (callback: (isProcessing: boolean) => void) => () => void
  /** 监听工具开始执行事件 */
  onToolStart: (callback: (data: { toolCall: ToolCall }) => void) => () => void
  /** 监听工具执行完成事件 */
  onToolResult: (callback: (data: { toolCall: ToolCall; result: ToolResult }) => void) => () => void
  /** 监听工具结果消息事件 */
  onToolResults: (callback: (message: Message) => void) => () => void
  /** 监听历史清空事件 */
  onHistoryCleared: (callback: () => void) => () => void
}

declare global {
  interface Window {
    api: {
      agent: AgentAPI
    }
  }
}

export {}
