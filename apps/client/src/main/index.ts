import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import type { Message } from '@auto-agent/shared-types'
import WebSocket from 'ws'

let mainWindow: BrowserWindow | null = null
let ws: WebSocket | null = null
let currentSessionId: string | null = null
let pendingSessionResolve: ((sessionId: string) => void) | null = null
let pendingConnectResolve: (() => void) | null = null
let isInitializing = false
let initPromise: Promise<{ success: boolean; sessionId?: string; error?: string }> | null = null

// 本地会话缓存（模块级别，可被多个函数访问）
const sessions: Map<string, { id: string; title: string; updatedAt: number; messageCount: number }> = new Map()

// 后端服务地址
const SERVER_URL = process.env.VITE_SERVER_URL || 'ws://localhost:3001'
const HTTP_BASE_URL = SERVER_URL.replace(/^ws/, 'http').replace(/\/ws$/, '')

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    frame: true,
    titleBarStyle: 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function connectToServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const wsUrl = SERVER_URL.replace(/^http/, 'ws') + '/ws'
    console.log('[Main] Connecting to server:', wsUrl)

    ws = new WebSocket(wsUrl)

    ws.on('open', () => {
      console.log('[Main] WebSocket connected')

      // 发送连接认证
      ws!.send(JSON.stringify({
        type: 'connect',
        messageId: generateId(),
        timestamp: Date.now(),
        payload: {
          userId: 'desktop-user'
        }
      }))

      // 等待 connect_ack
      pendingConnectResolve = () => {
        pendingConnectResolve = null
        resolve()
      }

      // 10秒超时
      setTimeout(() => {
        if (pendingConnectResolve) {
          pendingConnectResolve = null
          reject(new Error('Connection authentication timeout'))
        }
      }, 10000)
    })

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString())
        handleServerMessage(message)
      } catch (error) {
        console.error('[Main] Failed to parse message:', error)
      }
    })

    ws.on('error', (error) => {
      console.error('[Main] WebSocket error:', error)
      reject(error)
    })

    ws.on('close', () => {
      console.log('[Main] WebSocket closed')
      // 清理待处理的 resolver
      if (pendingSessionResolve) {
        pendingSessionResolve = null
      }
      // 清理初始化状态
      isInitializing = false
      initPromise = null
      // 尝试重连
      setTimeout(() => connectToServer().catch(console.error), 3000)
    })
  })
}

function handleServerMessage(message: any): void {
  console.log('[Main] Received:', message.type)

  switch (message.type) {
    case 'connect_ack':
      console.log('[Main] Server acknowledged connection')
      // 通知连接完成
      if (pendingConnectResolve) {
        pendingConnectResolve()
      }
      break

    case 'stream.chunk':
      // 转发给渲染进程
      mainWindow?.webContents.send('agent:message', {
        id: generateId(),
        role: 'assistant',
        content: message.payload?.content || '',
        timestamp: Date.now()
      })
      break

    case 'stream.complete':
      mainWindow?.webContents.send('agent:processing', false)
      break

    case 'stream.error':
      mainWindow?.webContents.send('agent:error', message.payload?.error)
      mainWindow?.webContents.send('agent:processing', false)
      break

    case 'state.update':
      if (message.payload?.type === 'tool_start') {
        mainWindow?.webContents.send('agent:tool_start', {
          toolCall: message.payload.toolCall
        })
      } else if (message.payload?.type === 'tool_end') {
        mainWindow?.webContents.send('agent:tool_result', {
          toolCall: message.payload.toolCall,
          result: message.payload.result
        })
      }
      break

    case 'tool.execute':
      // 后端请求执行本地工具
      executeToolAndReport(message)
      break

    case 'session.create_ack':
      if (message.payload?.session?.id) {
        const session = message.payload.session
        currentSessionId = session.id
        console.log('[Main] Session created:', currentSessionId)

        // 添加到本地会话缓存
        sessions.set(session.id, {
          id: session.id,
          title: session.title || `会话 ${sessions.size + 1}`,
          updatedAt: new Date(session.updatedAt).getTime(),
          messageCount: session.messages?.length || 0
        })

        // 通知渲染进程更新会话列表
        mainWindow?.webContents.send('agent:sessions_updated', Array.from(sessions.values()))

        // 通知等待的 init 调用
        if (pendingSessionResolve) {
          pendingSessionResolve(currentSessionId)
          pendingSessionResolve = null
        }
      }
      break
  }
}

async function executeToolAndReport(message: any): Promise<void> {
  const { toolCall } = message.payload
  console.log('[Main] Executing tool:', toolCall.name)

  try {
    // 动态导入工具
    const { bashTool } = await import('./tools/bash')
    const { browserTool } = await import('./tools/browser')

    let result: any

    switch (toolCall.name) {
      case 'bash':
        result = await bashTool.execute(toolCall.arguments)
        break
      case 'browser':
        result = await browserTool.execute(toolCall.arguments)
        break
      default:
        throw new Error(`Unknown tool: ${toolCall.name}`)
    }

    // 返回结果给服务端
    ws?.send(JSON.stringify({
      type: 'tool.result',
      messageId: generateId(),
      timestamp: Date.now(),
      sessionId: currentSessionId,
      payload: {
        toolCallId: toolCall.id,
        success: true,
        data: result,
        executionTime: 0
      }
    }))
  } catch (error) {
    console.error('[Main] Tool execution failed:', error)

    ws?.send(JSON.stringify({
      type: 'tool.error',
      messageId: generateId(),
      timestamp: Date.now(),
      sessionId: currentSessionId,
      payload: {
        toolCallId: toolCall.id,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }))
  }
}

function setupAgentHandlers(): void {
  // 初始化 Agent - 实际是和后端建立会话
  ipcMain.handle('agent:init', async () => {
    console.log('[Main] agent:init called')

    // 如果已有会话，直接返回成功
    if (currentSessionId) {
      console.log('[Main] Using existing session:', currentSessionId)
      return { success: true, sessionId: currentSessionId }
    }

    // 如果正在初始化中，返回现有的 promise
    if (isInitializing && initPromise) {
      console.log('[Main] Initialization already in progress, waiting...')
      return initPromise
    }

    // 开始新的初始化
    isInitializing = true
    initPromise = (async () => {
      try {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          console.log('[Main] WebSocket not connected, connecting...')
          await connectToServer()
        }

        // 再次检查会话（可能在连接过程中已被创建）
        if (currentSessionId) {
          console.log('[Main] Session created during connection:', currentSessionId)
          return { success: true, sessionId: currentSessionId }
        }

        console.log('[Main] Creating new session...')
        // 创建新会话并等待确认
        const sessionPromise = new Promise<string>((resolve, reject) => {
          pendingSessionResolve = resolve
          // 10秒超时
          setTimeout(() => {
            if (pendingSessionResolve === resolve) {
              pendingSessionResolve = null
              reject(new Error('Session creation timeout'))
            }
          }, 10000)
        })

        ws!.send(JSON.stringify({
          type: 'session.create',
          messageId: generateId(),
          timestamp: Date.now(),
          payload: {}
        }))
        console.log('[Main] Sent session.create message')

        const sessionId = await sessionPromise
        console.log('[Main] Session created successfully:', sessionId)
        return { success: true, sessionId }
      } catch (error) {
        console.error('[Main] agent:init error:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }
      } finally {
        isInitializing = false
        initPromise = null
      }
    })()

    return initPromise
  })

  // 发送消息
  ipcMain.handle('agent:send_message', async (_event, content: string) => {
    try {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return { success: false, error: 'Not connected to server' }
      }

      if (!currentSessionId) {
        return { success: false, error: 'No active session' }
      }

      // 发送用户消息给渲染进程显示
      mainWindow?.webContents.send('agent:message', {
        id: generateId(),
        role: 'user',
        content,
        timestamp: Date.now()
      })

      mainWindow?.webContents.send('agent:processing', true)

      // 发送到后端
      ws.send(JSON.stringify({
        type: 'agent.run',
        messageId: generateId(),
        timestamp: Date.now(),
        sessionId: currentSessionId,
        payload: { content }
      }))

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // 清空历史
  ipcMain.handle('agent:clear_history', () => {
    try {
      mainWindow?.webContents.send('agent:history_cleared')
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // 获取消息列表
  ipcMain.handle('agent:get_messages', () => {
    try {
      return { success: true, messages: [] }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // 获取会话列表
  // HTTP API 调用辅助函数
  async function httpGet(path: string) {
    const response = await fetch(`${HTTP_BASE_URL}${path}`)
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    return response.json()
  }

  async function httpPost(path: string, body?: any) {
    const response = await fetch(`${HTTP_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    return response.json()
  }

  async function httpDelete(path: string) {
    const response = await fetch(`${HTTP_BASE_URL}${path}`, { method: 'DELETE' })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    return response.json()
  }

  // 获取会话列表（使用 HTTP 短连接）
  ipcMain.handle('agent:get_sessions', async () => {
    try {
      // 使用 HTTP GET 获取会话列表
      const data = await httpGet('/api/sessions')

      // 更新本地缓存
      for (const session of data.sessions || []) {
        sessions.set(session.id, {
          id: session.id,
          title: session.title || `会话 ${sessions.size + 1}`,
          updatedAt: new Date(session.updatedAt).getTime(),
          messageCount: session.messages?.length || 0
        })
      }

      return { success: true, sessions: Array.from(sessions.values()) }
    } catch (error) {
      // 如果 HTTP 请求失败，返回本地缓存
      return {
        success: true,
        sessions: Array.from(sessions.values()),
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // 创建新会话
  ipcMain.handle('agent:create_session', async () => {
    try {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return { success: false, error: 'Not connected to server' }
      }

      const sessionPromise = new Promise<string>((resolve, reject) => {
        pendingSessionResolve = resolve
        setTimeout(() => {
          if (pendingSessionResolve === resolve) {
            pendingSessionResolve = null
            reject(new Error('Session creation timeout'))
          }
        }, 10000)
      })

      ws.send(JSON.stringify({
        type: 'session.create',
        messageId: generateId(),
        timestamp: Date.now(),
        payload: {}
      }))

      const sessionId = await sessionPromise
      currentSessionId = sessionId

      // 通知渲染进程切换会话
      mainWindow?.webContents.send('agent:session_switched', sessionId)

      return { success: true, sessionId }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // 切换会话
  ipcMain.handle('agent:switch_session', async (_event, sessionId: string) => {
    try {
      currentSessionId = sessionId

      // 清空当前消息显示
      mainWindow?.webContents.send('agent:history_cleared')

      // 通知渲染进程切换会话
      mainWindow?.webContents.send('agent:session_switched', sessionId)

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // 删除会话（使用 HTTP 短连接）
  ipcMain.handle('agent:delete_session', async (_event, sessionId: string) => {
    try {
      // 调用后端 HTTP API 删除会话
      await httpDelete(`/api/sessions/${sessionId}`)

      // 从本地缓存删除
      sessions.delete(sessionId)

      // 如果删除的是当前会话，清空当前会话
      if (currentSessionId === sessionId) {
        currentSessionId = null
        mainWindow?.webContents.send('agent:history_cleared')
      }

      // 通知渲染进程更新会话列表
      mainWindow?.webContents.send('agent:sessions_updated', Array.from(sessions.values()))

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // 重命名会话（使用 HTTP 短连接）
  ipcMain.handle('agent:rename_session', async (_event, sessionId: string, title: string) => {
    try {
      // 更新本地缓存
      const session = sessions.get(sessionId)
      if (session) {
        session.title = title
        sessions.set(sessionId, session)

        // 通知渲染进程更新会话列表
        mainWindow?.webContents.send('agent:sessions_updated', Array.from(sessions.values()))
      }

      // TODO: 后端需要添加重命名 API
      // await httpPost(`/api/sessions/${sessionId}/rename`, { title })

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // 获取会话消息历史（使用 HTTP 短连接）
  ipcMain.handle('agent:get_session_messages', async (_event, sessionId: string) => {
    try {
      // 使用 HTTP GET 获取消息历史
      const data = await httpGet(`/api/sessions/${sessionId}/messages`)
      return { success: true, messages: data.messages || [] }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        messages: []
      }
    }
  })
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.auto-agent.desktop')
  }

  createWindow()
  setupAgentHandlers()

  // 启动时连接服务端
  connectToServer().catch(console.error)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    ws?.close()
    app.quit()
  }
})

app.on('before-quit', () => {
  ws?.close()
})
