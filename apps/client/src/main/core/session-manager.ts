import { BrowserWindow } from 'electron'
import { httpDelete, httpGet, httpPost } from '../utils/http-client'

/**
 * 会话管理器 - 管理应用会话状态和通信
 */

export interface SessionInfo {
  id: string
  title: string
  updatedAt: number
  messageCount: number
}

// 本地会话缓存
const sessions = new Map<string, SessionInfo>()
let currentSessionId: string | null = null

export function getCurrentSessionId(): string | null {
  return currentSessionId
}

export function setCurrentSessionId(sessionId: string | null): void {
  currentSessionId = sessionId
}

export function getSession(sessionId: string): SessionInfo | undefined {
  return sessions.get(sessionId)
}

export function addSession(sessionInfo: SessionInfo): void {
  sessions.set(sessionInfo.id, sessionInfo)
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId)
}

export function getAllSessions(): SessionInfo[] {
  return Array.from(sessions.values())
}

export function updateSessionTitle(sessionId: string, title: string): void {
  const session = sessions.get(sessionId)
  if (session) {
    session.title = title
    sessions.set(sessionId, session)
  }
}

export function updateSessionMessageCount(sessionId: string, count: number): void {
  const session = sessions.get(sessionId)
  if (session) {
    session.messageCount = count
    sessions.set(sessionId, session)
  }
}

export function notifySessionsUpdated(mainWindow: BrowserWindow | null): void {
  mainWindow?.webContents.send('agent:sessions_updated', getAllSessions())
}

/**
 * 获取会话列表并同步到本地缓存
 */
export async function fetchAndSyncSessions(): Promise<SessionInfo[]> {
  try {
    console.log('[SessionManager] Fetching sessions from server...')
    const data = await httpGet('/api/sessions')
    console.log('[SessionManager] Server response:', data)

    const serverSessions = data.data?.sessions || []
    console.log(`[SessionManager] Got ${serverSessions.length} sessions from server`)

    for (const session of serverSessions) {
      console.log('[SessionManager] Adding session:', session.id, session.title)
      addSession({
        id: session.id,
        title: session.title || `会话 ${sessions.size + 1}`,
        updatedAt: new Date(session.updatedAt).getTime(),
        messageCount: session.messages?.length || 0
      })
    }

    const allSessions = getAllSessions()
    console.log(`[SessionManager] Total local sessions: ${allSessions.length}`)
    return allSessions
  } catch (error) {
    console.error('[SessionManager] Failed to fetch sessions:', error)
    // 失败时返回本地缓存
    return getAllSessions()
  }
}

/**
 * 创建新会话
 */
export async function createNewSession(mainWindow: BrowserWindow | null): Promise<{ sessionId: string } | null> {
  try {
    // 根因：新建会话后，需要通过 WebSocket 通知服务器创建 AgentLoop
    // 修复：先确保 WebSocket 连接，再创建会话
    const { connectToServer, ws, generateId } = await import('./server-connection')

    if (!ws || ws.readyState !== 1) {
      console.log('[SessionManager] WebSocket not connected, connecting...')
      await connectToServer(mainWindow)
    }

    const data = await httpPost('/api/sessions', { title: '新会话' })

    if (!data.success || !data.data?.session) {
      return null
    }

    const session = data.data.session
    currentSessionId = session.id

    addSession({
      id: session.id,
      title: session.title || `会话 ${sessions.size + 1}`,
      updatedAt: new Date(session.updatedAt).getTime(),
      messageCount: 0
    })

    notifySessionsUpdated(mainWindow)

    // 通过 WebSocket 通知服务器创建会话（初始化 AgentLoop）
    const { getPendingSessionResolve, setPendingSessionResolve } = await import('./server-connection')
    const sessionPromise = new Promise<string>((resolve, reject) => {
      setPendingSessionResolve(resolve)
      setTimeout(() => {
        if (getPendingSessionResolve() === resolve) {
          setPendingSessionResolve(null)
          reject(new Error('Session creation timeout'))
        }
      }, 10000)
    })

    ws!.send(JSON.stringify({
      type: 'session.create',
      messageId: generateId(),
      timestamp: Date.now(),
      payload: { sessionId: session.id }
    }))

    await sessionPromise
    console.log('[SessionManager] Session initialized via WebSocket:', session.id)

    return { sessionId: session.id }
  } catch (error) {
    console.error('[SessionManager] Create session error:', error)
    return null
  }
}

/**
 * 删除会话
 */
export async function removeSession(sessionId: string, mainWindow: BrowserWindow | null): Promise<boolean> {
  try {
    await httpDelete(`/api/sessions/${sessionId}`)
    deleteSession(sessionId)

    if (currentSessionId === sessionId) {
      currentSessionId = null
      mainWindow?.webContents.send('agent:history_cleared')
    }

    notifySessionsUpdated(mainWindow)
    return true
  } catch (error) {
    console.error('[SessionManager] Delete session error:', error)
    return false
  }
}

/**
 * 获取会话消息历史
 */
export async function getSessionMessages(sessionId: string, mainWindow: BrowserWindow | null): Promise<any[]> {
  try {
    const data = await httpGet(`/api/sessions/${sessionId}/messages`)
    const messages = data.data?.messages || []

    updateSessionMessageCount(sessionId, messages.length)
    notifySessionsUpdated(mainWindow)

    return messages
  } catch (error) {
    console.error('[SessionManager] Get messages error:', error)
    return []
  }
}

/**
 * 清空会话消息
 */
export async function clearSessionMessages(sessionId: string): Promise<boolean> {
  try {
    await httpDelete(`/api/sessions/${sessionId}/messages`)
    updateSessionMessageCount(sessionId, 0)
    return true
  } catch (error) {
    console.error('[SessionManager] Clear messages error:', error)
    return false
  }
}
