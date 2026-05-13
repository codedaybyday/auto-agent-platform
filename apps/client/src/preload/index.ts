import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { Message, ModelConfig } from '@auto-agent/shared-types'

export type { Message, ModelConfig } from '@auto-agent/shared-types'

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
  /** 监听新消息 */
  onMessage: (callback: (message: Message) => void) => () => void
  /** 监听处理状态 */
  onProcessing: (callback: (isProcessing: boolean) => void) => () => void
  /** 监听工具开始执行 */
  onToolStart: (callback: (data: { toolCall: { id: string; name: string; input: Record<string, unknown> } }) => void) => () => void
  /** 监听工具执行完成 */
  onToolResult: (callback: (data: { toolCall: { id: string; name: string; input: Record<string, unknown> }; result: { tool_use_id: string; content: string; is_error?: boolean } }) => void) => () => void
  /** 监听工具结果消息 */
  onToolResults: (callback: (message: Message) => void) => () => void
  /** 监听历史清空 */
  onHistoryCleared: (callback: () => void) => () => void
}

/**
 * Agent API 实现
 */
const agentAPI: AgentAPI = {
  init: (config: { apiKey: string; modelConfig: ModelConfig }) => ipcRenderer.invoke('agent:init', config),

  sendMessage: (content: string) => ipcRenderer.invoke('agent:send_message', content),

  clearHistory: () => ipcRenderer.invoke('agent:clear_history'),

  getMessages: () => ipcRenderer.invoke('agent:get_messages'),

  onMessage: (callback: (message: Message) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: Message) => callback(message)
    ipcRenderer.on('agent:message', handler)
    return () => ipcRenderer.removeListener('agent:message', handler)
  },

  onProcessing: (callback: (isProcessing: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isProcessing: boolean) => callback(isProcessing)
    ipcRenderer.on('agent:processing', handler)
    return () => ipcRenderer.removeListener('agent:processing', handler)
  },

  onToolStart: (callback: (data: { toolCall: { id: string; name: string; input: Record<string, unknown> } }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { toolCall: { id: string; name: string; input: Record<string, unknown> } }) => callback(data)
    ipcRenderer.on('agent:tool_start', handler)
    return () => ipcRenderer.removeListener('agent:tool_start', handler)
  },

  onToolResult: (callback: (data: { toolCall: { id: string; name: string; input: Record<string, unknown> }; result: { tool_use_id: string; content: string; is_error?: boolean } }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { toolCall: { id: string; name: string; input: Record<string, unknown> }; result: { tool_use_id: string; content: string; is_error?: boolean } }) => callback(data)
    ipcRenderer.on('agent:tool_result', handler)
    return () => ipcRenderer.removeListener('agent:tool_result', handler)
  },

  onToolResults: (callback: (message: Message) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: Message) => callback(message)
    ipcRenderer.on('agent:tool_results', handler)
    return () => ipcRenderer.removeListener('agent:tool_results', handler)
  },

  onHistoryCleared: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('agent:history_cleared', handler)
    return () => ipcRenderer.removeListener('agent:history_cleared', handler)
  }
}

const api = {
  agent: agentAPI
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-ignore fallback for non-isolated context
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}

export type { Message }
