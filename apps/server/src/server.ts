/**
 * 服务器启动
 */

import { createServer } from 'http'
import { config } from './config/index.js'
import { createApp } from './app.js'
import { WebSocketGateway } from './websocket/server.js'
import { SessionManager } from './services/agent/session.js'
import { rateLimiter } from './services/rate-limiter.js'
import { log } from '@auto-agent/shared-utils'

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
  log.info('Server', `Instance ID: ${instanceId}`)

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
    log.success('Server', `Server running on port ${PORT}`)
    log.info('Server', `Instance: ${instanceId}`)
    log.info('Server', `WebSocket: ws://localhost:${PORT}/ws`)
  })

  // 优雅关闭
  const gracefulShutdown = (signal: string) => {
    log.info('Server', `${signal} received, shutting down gracefully`)
    server.close(() => {
      log.info('Server', 'Server closed')
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
