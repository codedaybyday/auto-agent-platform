import { BrowserWindow } from 'electron'
// @ts-ignore
import WebSocket from 'ws'

/**
 * WebSocket 连接管理（纯通信层，不包含业务逻辑）
 */

export let ws: WebSocket | null = null
const SERVER_URL = process.env.VITE_SERVER_URL || 'ws://localhost:3001'

let pendingConnectResolve: (() => void) | null = null
let pendingSessionResolve: ((sessionId: string) => void) | null = null
let messageHandler: ((message: any, mainWindow: BrowserWindow | null) => Promise<void>) | null = null
let mainWindowRef: BrowserWindow | null = null

export function getPendingSessionResolve() {
  return pendingSessionResolve
}

export function setPendingSessionResolve(resolve: ((sessionId: string) => void) | null) {
  pendingSessionResolve = resolve
}

export function getPendingConnectResolve() {
  return pendingConnectResolve
}

export function setPendingConnectResolve(resolve: (() => void) | null) {
  pendingConnectResolve = resolve
}

/**
 * 初始化服务器连接配置
 */
export function initServerConnection(opts: {
  messageHandler: (message: any, mainWindow: BrowserWindow | null) => Promise<void>
  mainWindow: BrowserWindow | null
}) {
  messageHandler = opts.messageHandler
  mainWindowRef = opts.mainWindow
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

export function connectToServer(mainWindow: BrowserWindow | null): Promise<void> {
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

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString())
        console.log('[Main] Received message:', message.type)
        // 调用注册的消息处理器
        if (messageHandler) {
          await messageHandler(message, mainWindowRef)
        } else {
          console.warn('[Main] No message handler registered!')
        }
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
      
      if (pendingSessionResolve) {
        pendingSessionResolve = null
      }
      
      // 尝试重连
      setTimeout(() => connectToServer(mainWindow).catch(console.error), 3000)
    })
  })
}

export function sendMessage(message: any): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message))
  }
}

export function closeConnection(): void {
  if (ws) {
    ws.close()
    ws = null
  }
}
