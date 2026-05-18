/**
 * 服务器启动
 */

import { createServer } from 'http'
import { config } from './config/index.js'
import { createApp } from './app.js'
import { WebSocketGateway } from './websocket/server.js'
import { SessionManager } from './services/agent/session.js'
import { rateLimiter } from './services/rate-limiter.js'

export interface ServerContext {
  instanceId: string
  sessionManager: SessionManager
  wsGateway: WebSocketGateway
  rateLimiter: typeof rateLimiter
  port: number
}

export function startServer(): ServerContext {
  // 生成实例 ID
  const instanceId = `${process.env.HOSTNAME || 'local'}-${Date.now()}`
  console.log(`[Server] Instance ID: ${instanceId}`)

  // 初始化服务
  const sessionManager = new SessionManager(instanceId, {
    maxSessionsPerUser: 10,
    maxGlobalSessions: 1000
  })

  // 先创建 HTTP 服务器（不绑定 request handler）
  const server = createServer()

  // 初始化 WebSocket
  const wsGateway = new WebSocketGateway(server, sessionManager, instanceId, rateLimiter)

  // 创建 Express 应用
  const app = createApp({
    instanceId,
    sessionManager,
    wsGateway,
    rateLimiter
  })

  // 将 Express 应用绑定到 server
  server.on('request', app)

  // 启动限流器清理任务（每5分钟清理过期桶）
  setInterval(() => {
    rateLimiter.cleanup()
  }, 5 * 60 * 1000)

  // 启动服务器
  const PORT = config.port || 3000

  server.listen(PORT, () => {
    console.log(`
🚀 Auto Agent Server running
   Port: ${PORT}
   Instance: ${instanceId}
   WebSocket: ws://localhost:${PORT}/ws

📚 API Endpoints:
   GET  /health              - Health check
   GET  /api/sessions        - List sessions
   POST /api/sessions        - Create session
   GET  /api/sessions/:id    - Get session
   DEL  /api/sessions/:id    - Delete session
   POST /api/sessions/:id/chat - Send message
   GET  /api/sessions/:id/messages - Get history

🔌 WebSocket Events:
   connect, session.create, agent.run
   agent.pause, agent.stop, tool.result

⚠️  TODO:
   ✅ 接入外部登录系统 (middleware/auth.ts)
   - 接入 Redis 做跨实例状态同步
   - 接入 PostgreSQL 做持久化存储
`)
  })

  // 优雅关闭
  const gracefulShutdown = (signal: string) => {
    console.log(`[Server] ${signal} received, shutting down gracefully`)
    server.close(() => {
      console.log('[Server] Server closed')
      process.exit(0)
    })
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
  process.on('SIGINT', () => gracefulShutdown('SIGINT'))

  return {
    instanceId,
    sessionManager,
    wsGateway,
    rateLimiter,
    port: PORT
  }
}
