import { BrowserWindow } from 'electron'
import { 
  getCurrentSessionId, 
  setCurrentSessionId, 
  addSession, 
  notifySessionsUpdated 
} from '../core/session-manager'
import { cleanupSessionTools } from '../tools/executor'
import { generateId, getPendingConnectResolve, setPendingConnectResolve, getPendingSessionResolve, setPendingSessionResolve } from '../core/server-connection'

/**
 * 服务器消息处理
 */

export async function handleServerMessage(message: any, mainWindow: BrowserWindow | null) {
  console.log('[Main] Received:', message.type)

  switch (message.type) {
    case 'connect_ack':
      handleConnectAck()
      break

    case 'stream.chunk':
      handleStreamChunk(message, mainWindow)
      break

    case 'stream.complete':
      handleStreamComplete(message, mainWindow)
      break

    case 'stream.error':
      handleStreamError(message, mainWindow)
      break

    case 'state.update':
      handleStateUpdate(message, mainWindow)
      break

    case 'tool.execute':
      // 动态导入以避免循环依赖
      const { executeToolAndReport } = await import('../tools/executor')
      await executeToolAndReport(message, mainWindow)
      break

    case 'tool.cleanup':
      await handleToolCleanup(message)
      break

    case 'session.create_ack':
      await handleSessionCreateAck(message, mainWindow)
      break
  }
}

function handleConnectAck() {
  console.log('[Main] Server acknowledged connection')
  const resolve = getPendingConnectResolve()
  if (resolve) {
    resolve()
    setPendingConnectResolve(null)
  }
}

function handleStreamChunk(message: any, mainWindow: BrowserWindow | null) {
  console.log(`[Main] Forwarding stream.chunk for session ${message.sessionId}`, message.payload?.type)

  // 处理 SSE 格式流式消息
  if (message.payload?.type === 'sse') {
    const { event, data } = message.payload

    if (event === 'content') {
      // 逐字内容 - 使用专门的流式事件
      mainWindow?.webContents.send('agent:stream_chunk', {
        chunk: data,
        sessionId: message.sessionId
      })
      return
    }

    if (event === 'done') {
      // 流式结束
      mainWindow?.webContents.send('agent:stream_done', {
        sessionId: message.sessionId
      })
      return
    }
  }

  // 兼容旧格式（非 SSE）
  mainWindow?.webContents.send('agent:message', {
    id: message.messageId || generateId(),
    role: 'assistant',
    content: message.payload?.content || '',
    timestamp: Date.now(),
    sessionId: message.sessionId
  })
}

function handleStreamComplete(message: any, mainWindow: BrowserWindow | null) {
  mainWindow?.webContents.send('agent:processing', { 
    processing: false, 
    sessionId: message.sessionId 
  })
}

function handleStreamError(message: any, mainWindow: BrowserWindow | null) {
  mainWindow?.webContents.send('agent:error', message.payload?.error)
  mainWindow?.webContents.send('agent:processing', { 
    processing: false, 
    sessionId: message.sessionId 
  })
}

function handleStateUpdate(message: any, mainWindow: BrowserWindow | null) {
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
}

async function handleToolCleanup(message: any) {
  console.log('[Main] Server requested tool cleanup for session:', message.sessionId)
  await cleanupSessionTools(message.sessionId)
}

async function handleSessionCreateAck(message: any, mainWindow: BrowserWindow | null) {
  if (message.payload?.session?.id) {
    const session = message.payload.session
    const sessionId = session.id
    
    setCurrentSessionId(sessionId)
    console.log('[Main] Session created:', sessionId)

    // 添加到本地会话缓存
    addSession({
      id: session.id,
      title: session.title || `会话 ${Date.now()}`,
      updatedAt: new Date(session.updatedAt).getTime(),
      messageCount: session.messages?.length || 0
    })

    // 通知渲染进程更新会话列表
    notifySessionsUpdated(mainWindow)

    // 通知等待的 init 调用
    const resolve = getPendingSessionResolve()
    if (resolve && sessionId) {
      resolve(sessionId)
      setPendingSessionResolve(null)
    }
  }
}
