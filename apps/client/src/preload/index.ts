import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { Message, ModelConfig } from '@auto-agent/shared-types'

export type { Message, ModelConfig } from '@auto-agent/shared-types'

export interface Session {
  id: string
  title: string
  updatedAt: number
  messageCount: number
}

export interface MCPUserConfig {
  builtInTools: {
    browser: boolean
    bash: boolean
    file: boolean
  }
  userTools: Array<{
    name: string
    description: string
    command?: string
    args?: string[]
    workingDir?: string
    env?: Record<string, string>
    script?: string
    function?: string
  }>
}

/**
 * Agent API 接口
 * 定义主进程暴露给渲染进程的 API
 */
export interface AgentAPI {
  /** 初始化 Agent */
  init: (config: { apiKey: string; modelConfig: ModelConfig }) => Promise<{ success: boolean; error?: string }>
  /** 发送消息 */
  sendMessage: (content: string) => Promise<{ success: boolean; error?: string }>
  /** 停止生成 */
  stop: () => Promise<{ success: boolean; error?: string }>
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
  onToolStart: (callback: (data: { toolCall: { id: string; name: string; input: Record<string, unknown> } }) => void) => () => void
  /** 监听工具执行完成 */
  onToolResult: (callback: (data: { toolCall: { id: string; name: string; input: Record<string, unknown> }; result: { tool_use_id: string; content: string; is_error?: boolean } }) => void) => () => void
  /** 监听工具结果消息 */
  onToolResults: (callback: (message: Message) => void) => () => void
  /** 监听历史清空 */
  onHistoryCleared: (callback: () => void) => () => void
  /** 监听会话列表更新 */
  onSessionsUpdated: (callback: (sessions: Session[]) => void) => () => void
  /** 监听会话切换 */
  onSessionSwitched: (callback: (sessionId: string) => void) => () => void
  /** 监听会话标题更新 */
  onSessionTitleUpdated: (callback: (data: { sessionId: string; title: string }) => void) => () => void
  login: () => Promise<{ success: boolean; error?: string }>
  whoami: () => Promise<{ success: boolean; error?: string, data: any }>
  logout: () => Promise<{ success: boolean; error?: string }>
  /** 获取 MCP 配置 */
  getMCPConfig: () => Promise<{ success: boolean; config?: MCPUserConfig; error?: string }>
  /** 保存 MCP 配置 */
  saveMCPConfig: (config: MCPUserConfig) => Promise<{ success: boolean; error?: string }>
  /** 保存代码到文件 */
  saveCodeToFile: (filename: string, content: string) => Promise<{ success: boolean; error?: string }>
}

/**
 * Agent API 实现
 */
const agentAPI: AgentAPI = {
  init: (config: { apiKey: string; modelConfig: ModelConfig }) => ipcRenderer.invoke('agent:init', config),

  sendMessage: (content: string) => ipcRenderer.invoke('agent:send_message', content),

  stop: () => ipcRenderer.invoke('agent:stop'),

  clearHistory: () => ipcRenderer.invoke('agent:clear_history'),

  getMessages: () => ipcRenderer.invoke('agent:get_messages'),

  getSessions: () => ipcRenderer.invoke('agent:get_sessions'),

  getSessionMessages: (sessionId: string) => ipcRenderer.invoke('agent:get_session_messages', sessionId),

  createSession: () => ipcRenderer.invoke('agent:create_session'),

  switchSession: (sessionId: string) => ipcRenderer.invoke('agent:switch_session', sessionId),

  deleteSession: (sessionId: string) => ipcRenderer.invoke('agent:delete_session', sessionId),

  renameSession: (sessionId: string, title: string) => ipcRenderer.invoke('agent:rename_session', sessionId, title),

  onMessage: (callback: (message: Message) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: Message) => callback(message)
    ipcRenderer.on('agent:message', handler)
    return () => ipcRenderer.removeListener('agent:message', handler)
  },

  onStreamChunk: (callback: (data: { chunk: string; sessionId?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { chunk: string; sessionId?: string }) => callback(data)
    ipcRenderer.on('agent:stream_chunk', handler)
    return () => ipcRenderer.removeListener('agent:stream_chunk', handler)
  },

  onStreamDone: (callback: (data: { sessionId?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { sessionId?: string }) => callback(data)
    ipcRenderer.on('agent:stream_done', handler)
    return () => ipcRenderer.removeListener('agent:stream_done', handler)
  },

  onProcessing: (callback: (data: { processing: boolean; sessionId?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { processing: boolean; sessionId?: string }) => callback(data)
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
  },

  onSessionsUpdated: (callback: (sessions: Session[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessions: Session[]) => callback(sessions)
    ipcRenderer.on('agent:sessions_updated', handler)
    return () => ipcRenderer.removeListener('agent:sessions_updated', handler)
  },

  onSessionSwitched: (callback: (sessionId: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionId: string) => callback(sessionId)
    ipcRenderer.on('agent:session_switched', handler)
    return () => ipcRenderer.removeListener('agent:session_switched', handler)
  },

  onSessionTitleUpdated: (callback: (data: { sessionId: string; title: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { sessionId: string; title: string }) => callback(data)
    ipcRenderer.on('agent:session_title_updated', handler)
    return () => ipcRenderer.removeListener('agent:session_title_updated', handler)
  },
  // sso
  login: () => ipcRenderer.invoke('sso:login'),
  whoami: () => ipcRenderer.invoke('sso:whoami'),
  logout: () => ipcRenderer.invoke('sso:logout'),
  // mcp
  getMCPConfig: () => ipcRenderer.invoke('mcp:get_config'),
  saveMCPConfig: (config: MCPUserConfig) => ipcRenderer.invoke('mcp:save_config', config),
  // file
  saveCodeToFile: (filename: string, content: string) => ipcRenderer.invoke('file:save_code', filename, content)
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

// export type { Message }
