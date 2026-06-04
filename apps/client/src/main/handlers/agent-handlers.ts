import { BrowserWindow, ipcMain } from 'electron'
import {
  getCurrentSessionId,
  setCurrentSessionId,
  getAllSessions,
  fetchAndSyncSessions,
  createNewSession,
  removeSession,
  getSessionMessages,
  clearSessionMessages,
  notifySessionsUpdated
} from '../core/session-manager'
import { getPendingSessionResolve, setPendingSessionResolve } from '../core/server-connection'
import { log } from '@auto-agent/shared-utils'

/**
 * Agent IPC 处理器
 */

let isInitializing = false
let initPromise: Promise<{ success: boolean; sessionId?: string; error?: string }> | null = null

export function setupAgentHandlers(mainWindow: BrowserWindow | null): void {
  // 初始化 Agent
  ipcMain.handle('agent:init', async () => {
    log.info('Main', 'agent:init called')

    const currentId = getCurrentSessionId()
    if (currentId) {
      log.info('Main', `Using existing session: ${currentId}`)
      return { success: true, sessionId: currentId }
    }

    if (isInitializing && initPromise) {
      log.info('Main', 'Initialization already in progress, waiting...')
      return initPromise
    }

    isInitializing = true
    initPromise = (async () => {
      try {
        const { connectToServer, ws, generateId } = await import('../core/server-connection')

        if (!ws || ws.readyState !== 1) { // WebSocket.OPEN
          log.info('Main', 'WebSocket not connected, connecting...')
          await connectToServer(mainWindow)
        }

        const sessionId = getCurrentSessionId()
        if (sessionId) {
          log.success('Main', `Session created during connection: ${sessionId}`)
          return { success: true, sessionId }
        }

        log.info('Main', 'Creating new session...')
        
        const sessionPromise = new Promise<string>((resolve, reject) => {
          setPendingSessionResolve(resolve)
          setTimeout(() => {
            if (getPendingSessionResolve() === resolve) {
              setPendingSessionResolve(null)
              reject(new Error('Session creation timeout'))
            }
          }, 10000)
        })

        const { ws: wsInstance } = await import('../core/server-connection')
        wsInstance!.send(JSON.stringify({
          type: 'session.create',
          messageId: generateId(),
          timestamp: Date.now(),
          payload: {}
        }))

        log.info('Main', 'Sent session.create message')
        const newSessionId = await sessionPromise
        log.success('Main', `Session created successfully: ${newSessionId}`)
        return { success: true, sessionId: newSessionId }
      } catch (error) {
        log.error('Main', 'agent:init error', error)
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
      const { ws, generateId } = await import('../core/server-connection')

      if (!ws || ws.readyState !== 1) {
        return { success: false, error: 'Not connected to server' }
      }

      const sessionId = getCurrentSessionId()
      if (!sessionId) {
        return { success: false, error: 'No active session' }
      }

      mainWindow?.webContents.send('agent:message', {
        id: generateId(),
        role: 'user',
        content,
        timestamp: Date.now(),
        sessionId
      })

      mainWindow?.webContents.send('agent:processing', { processing: true, sessionId })

      ws.send(JSON.stringify({
        type: 'agent.run',
        messageId: generateId(),
        timestamp: Date.now(),
        sessionId,
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
      const sessionId = getCurrentSessionId()
      if (!sessionId) {
        log.warn('Main', 'clear_history: No active session')
        return { success: false, error: 'No active session' }
      }

      await clearSessionMessages(sessionId)
      mainWindow?.webContents.send('agent:history_cleared')
      return { success: true }
    } catch (error) {
      log.error('Main', 'clear_history error', error)
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
  ipcMain.handle('agent:get_sessions', async () => {
    try {
      const sessions = await fetchAndSyncSessions()
      return { success: true, sessions }
    } catch (error) {
      return {
        success: true,
        sessions: getAllSessions(),
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // 创建新会话
  ipcMain.handle('agent:create_session', async () => {
    try {
      const result = await createNewSession(mainWindow)
      if (!result) {
        return { success: false, error: '创建会话失败' }
      }
      return { success: true, sessionId: result.sessionId }
    } catch (error) {
      log.error('Main', 'Create session error', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // 切换会话
  ipcMain.handle('agent:switch_session', async (_event, sessionId: string) => {
    try {
      setCurrentSessionId(sessionId)
      mainWindow?.webContents.send('agent:session_switched', sessionId)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // 删除会话
  ipcMain.handle('agent:delete_session', async (_event, sessionId: string) => {
    try {
      const success = await removeSession(sessionId, mainWindow)
      
      if (success && getCurrentSessionId() === sessionId) {
        try {
          const { browserController } = await import('../tools/browser-use/index.js') as { browserController: import('../tools/browser-use/index.js').BrowserController }
          await browserController.close(sessionId)
          log.success('Main', `Browser context cleaned up for deleted session: ${sessionId}`)
        } catch (browserError) {
          log.warn('Main', `Failed to cleanup browser for session ${sessionId}`, browserError)
        }
      }

      return { success }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // 重命名会话
  ipcMain.handle('agent:rename_session', async (_event, sessionId: string, title: string) => {
    try {
      const session = getAllSessions().find(s => s.id === sessionId)
      if (session) {
        session.title = title
        notifySessionsUpdated(mainWindow)
      }
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // 获取会话消息历史
  ipcMain.handle('agent:get_session_messages', async (_event, sessionId: string) => {
    try {
      const messages = await getSessionMessages(sessionId, mainWindow)
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
