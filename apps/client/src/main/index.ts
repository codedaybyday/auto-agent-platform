import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
// import type { Message } from '@auto-agent/shared-types'
// @ts-ignore
import WebSocket from 'ws'
import { SSOCliClient, SSOAccessEnvType } from '@mtfe/sso-web-oidc-cli'
import ssoTokenStorage from './sso-token-storage'

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

let ssoClient: SSOCliClient;

function initSSOClient() {
  const accessEnv = SSOAccessEnvType.test; // 或 SSOAccessEnvType.product
  
  ssoClient = new SSOCliClient({
    clientId: '3e64c59645', // 测试环境
    accessEnv,
    localPortList: [5173], // 自定义
    isDebug: process.env.NODE_ENV === 'development',
    // tokenStorage: ssoTokenStorage,
  });
}

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
    // shell.openExternal(details.url)
    mainWindow?.loadURL(details.url);
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

    ws.on('error', (error: Error) => {
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

async function handleServerMessage(message: any) {
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
      console.log(`[Main] Forwarding stream.chunk for session ${message.sessionId}`)
      // 转发给渲染进程，携带 sessionId 用于消息归属验证
      // 使用后端传来的 messageId 保持 ID 一致性
      mainWindow?.webContents.send('agent:message', {
        id: message.messageId || generateId(),
        role: 'assistant',
        content: message.payload?.content || '',
        timestamp: Date.now(),
        sessionId: message.sessionId
      })
      break

    case 'stream.complete':
      mainWindow?.webContents.send('agent:processing', { processing: false, sessionId: message.sessionId })
      break

    case 'stream.error':
      mainWindow?.webContents.send('agent:error', message.payload?.error)
      mainWindow?.webContents.send('agent:processing', { processing: false, sessionId: message.sessionId })
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

    case 'tool.cleanup':
      // 服务端通知清理本地工具资源
      console.log('[Main] Server requested tool cleanup for session:', message.sessionId)
      await cleanupSessionTools(message.sessionId)
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
        if (pendingSessionResolve && currentSessionId) {
          pendingSessionResolve(currentSessionId)
          pendingSessionResolve = null
        }
      }
      break
  }
}

async function executeToolAndReport(message: any): Promise<void> {
  const { toolCall } = message.payload
  const sessionId = message.sessionId

  // 验证 sessionId 有效性
  if (!sessionId) {
    console.error('[Main] Error: sessionId is missing in tool.execute message')
    ws?.send(JSON.stringify({
      type: 'tool.error',
      messageId: toolCall.id,
      timestamp: Date.now(),
      sessionId: sessionId || 'unknown',
      payload: {
        toolCallId: toolCall.id,
        success: false,
        error: 'sessionId is missing'
      }
    }))
    return
  }

  console.log(`[Main] Executing tool: ${toolCall.name} for session: ${sessionId}`)

  try {
    // 动态导入工具
    const { createBashTool } = await import('./tools/bash/index.js')
    const { browserAI } = await import('./tools/browser-ai/index.js')

    let result: any

    switch (toolCall.name) {
      case 'bash': {
        // 使用新的 BashTool，传入当前会话 ID 以支持持久化 session
        const bashTool = createBashTool(
          sessionId || `temp_${Date.now()}`,
          // 确认回调 - 危险命令时显示确认对话框
          async (command, riskLevel) => {
            // TODO: 显示确认对话框
            // 目前默认允许，后续实现对话框
            console.log(`[BashTool] High risk command requires confirmation: ${command}`)
            return true
          }
        )
        result = await bashTool.execute(toolCall.arguments)
        break
      }
      case 'browser_get_context': {
        // 返回页面上下文给服务端
        console.log(`[Main] Getting browser context for session: ${sessionId}`)
        const context = await browserAI.getPageContext(sessionId)
        result = context
        break
      }

      case 'browser_ai_execute': {
        // 服务端已解析的浏览器动作，直接执行
        const { action } = toolCall.arguments as { action: any }
        console.log(`[Main] Executing browser_ai_execute for session ${sessionId}:`, action)
        const actionResult = await browserAI.executeBrowserAction(sessionId, action)
        result = actionResult.result
        break
      }

      case 'browser_ai': {
        // 兼容旧版：如果服务端未解析，客户端降级处理
        const { instruction, ref } = toolCall.arguments

        if (ref !== undefined) {
          const actionResult = await browserAI.clickByIndex(sessionId, ref)
          result = actionResult.result
        } else if (instruction) {
          // 简单指令用硬编码规则解析（作为降级方案）
          const action = parseBrowserInstruction(instruction)
          const actionResult = await browserAI.executeBrowserAction(sessionId, action)
          result = actionResult.result
        } else {
          throw new Error('browser_ai tool requires either "instruction" or "ref" parameter')
        }
        break
      }
      default:
        throw new Error(`Unknown tool: ${toolCall.name}`)
    }

    // 返回结果给服务端
    // 使用 toolCall.id 作为 messageId，以便服务端匹配 pending 请求
    ws?.send(JSON.stringify({
      type: 'tool.result',
      messageId: toolCall.id,
      timestamp: Date.now(),
      sessionId: sessionId,
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
      messageId: toolCall.id,
      timestamp: Date.now(),
      sessionId: sessionId,
      payload: {
        toolCallId: toolCall.id,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }))
  }
}

/**
 * 清理会话的本地工具资源
 */
async function cleanupSessionTools(sessionId: string | undefined): Promise<void> {
  const targetSessionId = sessionId || currentSessionId
  if (!targetSessionId) {
    console.log('[Main] No session ID for cleanup, skipping')
    return
  }

  console.log(`[Main] Cleaning up tools for session: ${targetSessionId}`)

  try {
    // 导入并清理 bash session
    const { sessionManager } = await import('./tools/bash/index.js')
    sessionManager.destroy(targetSessionId)
    console.log(`[Main] Bash session ${targetSessionId} destroyed`)

    // 清理会话的浏览器上下文（使用 BrowserManager 实现会话隔离）
    const { browserAI } = await import('./tools/browser-ai/index.js')
    await browserAI.close(targetSessionId)
    console.log(`[Main] BrowserAI context closed for session ${targetSessionId}`)

    // 清理进程注册表
    const { processRegistry } = await import('./tools/bash/process-registry.js')
    processRegistry.cleanupSession(targetSessionId)
    console.log(`[Main] Process registry cleaned for session ${targetSessionId}`)

    console.log(`[Main] Tools cleanup completed for session: ${targetSessionId}`)
  } catch (error) {
    console.error(`[Main] Failed to cleanup tools for session ${targetSessionId}:`, error)
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

      // 发送用户消息给渲染进程显示，携带 sessionId
      mainWindow?.webContents.send('agent:message', {
        id: generateId(),
        role: 'user',
        content,
        timestamp: Date.now(),
        sessionId: currentSessionId
      })

      mainWindow?.webContents.send('agent:processing', { processing: true, sessionId: currentSessionId })

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
  ipcMain.handle('agent:clear_history', async () => {
    try {
      if (!currentSessionId) {
        console.log('[Main] clear_history: No active session')
        return { success: false, error: 'No active session' }
      }

      console.log('[Main] clear_history: Calling API for session', currentSessionId)
      // 调用后端 API 清除消息
      await httpDelete(`/api/sessions/${currentSessionId}/messages`)
      console.log('[Main] clear_history: API success')

      mainWindow?.webContents.send('agent:history_cleared')
      console.log('[Main] clear_history: Sent history_cleared event')
      return { success: true }
    } catch (error) {
      console.error('[Main] clear_history error:', error)
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
    const response = await fetch(`${HTTP_BASE_URL}${path}`, {
      headers: { 'x-user-id': 'desktop-user' }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    return response.json()
  }

  async function httpPost(path: string, body?: any) {
    const response = await fetch(`${HTTP_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': 'desktop-user'
      },
      body: body ? JSON.stringify(body) : undefined
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    return response.json()
  }

  async function httpDelete(path: string) {
    const response = await fetch(`${HTTP_BASE_URL}${path}`, {
      method: 'DELETE',
      headers: { 'x-user-id': 'desktop-user' }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    return response.json()
  }

  // 获取会话列表（使用 HTTP 短连接）
  ipcMain.handle('agent:get_sessions', async () => {
    try {
      // 使用 HTTP GET 获取会话列表
      const data = await httpGet('/api/sessions')

      // 更新本地缓存
      for (const session of data.data?.sessions || []) {
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

  // 创建新会话（使用 HTTP）
  ipcMain.handle('agent:create_session', async () => {
    try {
      // 使用 HTTP POST 创建会话
      const data = await httpPost('/api/sessions', { title: '新会话' })

      if (!data.success || !data.data?.session) {
        return { success: false, error: '创建会话失败' }
      }

      const session = data.data.session
      currentSessionId = session.id

      // 添加到本地缓存
      sessions.set(session.id, {
        id: session.id,
        title: session.title || `会话 ${sessions.size + 1}`,
        updatedAt: new Date(session.updatedAt).getTime(),
        messageCount: 0
      })

      // 通知渲染进程更新会话列表
      mainWindow?.webContents.send('agent:sessions_updated', Array.from(sessions.values()))

      return { success: true, sessionId: session.id }
    } catch (error) {
      console.error('[Main] Create session error:', error)
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

      // 通知渲染进程切换会话
      // 注意：不发送 history_cleared，由前端自己控制消息显示
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

      // 清理该会话的浏览器上下文
      try {
        const { browserAI } = await import('./tools/browser-ai/index.js')
        await browserAI.close(sessionId)
        console.log(`[Main] Browser context cleaned up for deleted session: ${sessionId}`)
      } catch (browserError) {
        // 浏览器清理失败不影响会话删除结果
        console.warn(`[Main] Failed to cleanup browser for session ${sessionId}:`, browserError)
      }

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
      const messages = data.data?.messages || []

      // 更新本地缓存中的消息计数
      const session = sessions.get(sessionId)
      if (session) {
        session.messageCount = messages.length
        sessions.set(sessionId, session)
        // 通知渲染进程更新会话列表
        mainWindow?.webContents.send('agent:sessions_updated', Array.from(sessions.values()))
      }

      return { success: true, messages }
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

/**
 * 绑定 IPC
 */

function bindIpcEvents() {
  // ==================== SSO 相关 IPC 处理 ====================

  // 获取用户信息 (whoami)
  ipcMain.handle('sso:whoami', async () => {
    try {
      const result = await ssoClient.whoami();
      console.debug('whoami result: ', result);

      if (result && result.code === 0 && result.data) {
        return { success: true, data: result.data, error: null };
      } else {
        return { success: false, data: null, error: result?.msg || '获取用户信息失败' };
      }
      } catch (error: any) {
        console.error('SSO whoami error:', error);
        return { success: false, data: null, error: error.message };
      }
  });

  // SSO 登录
  ipcMain.handle('sso:login', async () => {
    try {
      const result = await ssoClient.login();

      if (result && result.access_token) {
        return { success: true, error: null };
      } else {
        return { success: false, error: '登录失败' };
      }
    } catch (error: any) {
      console.error('SSO login error:', error);
      return { success: false, error: error?.msg || error?.message };
    }
  });

  // SSO 登出
  ipcMain.handle('sso:logout', async () => {
    try {
      const result = await ssoClient.logout();
      console.debug('logout result: ', result);

      // 登出成功后清空 token 信息
      if (result && result.code === 0) {
        await ssoTokenStorage.clear();
        console.debug('SSO token 已清空');
      }

      return { success: true, error: null };
    } catch (error: any) {
      console.error('SSO logout error:', error);
      return { success: false, error: error.message };
    }
  });
}

/**
 * 简单指令解析（降级方案）
 * 当服务端未解析时，客户端基于关键词匹配
 */
function parseBrowserInstruction(instruction: string): any {
  const lower = instruction.toLowerCase()

  // 导航
  const navMatch = instruction.match(/(?:go to|open|visit|navigate to)\s+(https?:\/\/[^\s]+)/i)
  if (navMatch) {
    return { type: 'navigate', url: navMatch[1] }
  }

  // 点击
  const clickMatch = instruction.match(/(?:click|press)\s+(?:on\s+)?(?:the\s+)?["']?([^"']+)["']?/i)
  if (clickMatch) {
    return { type: 'click', description: clickMatch[1] }
  }

  // 输入
  const typeMatch = instruction.match(/(?:type|enter)\s+["']([^"']+)["']\s+(?:in|into)\s+["']?([^"']+)["']?/i)
  if (typeMatch) {
    return { type: 'type', text: typeMatch[1], field: typeMatch[2] }
  }

  // 滚动
  const scrollMatch = instruction.match(/(?:scroll)\s+(up|down)/i)
  if (scrollMatch) {
    return { type: 'scroll', direction: scrollMatch[1].toLowerCase(), amount: 500 }
  }

  // 截图
  if (lower.includes('screenshot')) {
    return { type: 'screenshot' }
  }

  // 等待
  const waitMatch = instruction.match(/(?:wait)\s+(\d+)/i)
  if (waitMatch) {
    return { type: 'wait', timeout: parseInt(waitMatch[1]) * 1000 }
  }

  // 默认分析
  return { type: 'analyze' }
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.auto-agent.desktop')
  }

  initSSOClient()
  bindIpcEvents()
  createWindow()
  setupAgentHandlers()

  // 启动时连接服务端
  connectToServer().catch(console.error)

  // 运行 Bash 工具测试
  try {
    const { testBashTool } = await import('./test-bash.js')
    await testBashTool()
  } catch (error) {
    console.error('[Main] Bash tool test failed:', error)
  }

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

app.on('before-quit', async () => {
  ws?.close()

  // 清理所有 shell 会话
  try {
    const { sessionManager } = await import('./tools/bash/index.js')
    sessionManager.destroyAll()
    console.log('[Main] All shell sessions cleaned up')
  } catch (error) {
    console.error('[Main] Failed to cleanup shell sessions:', error)
  }

  // 清理所有浏览器会话
  try {
    const { browserAI } = await import('./tools/browser-ai/index.js')
    await browserAI.closeAll()
    console.log('[Main] All browser sessions cleaned up')
  } catch (error) {
    console.error('[Main] Failed to cleanup browser sessions:', error)
  }
})
