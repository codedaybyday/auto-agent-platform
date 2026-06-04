/**
 * Express 应用配置
 */

import express, { Express } from 'express'
import cors from 'cors'
import { authMiddleware } from './middleware/auth.js'
import { createRoutes, createRateLimitMiddleware } from './routes/index.js'
import type { SessionManager } from './services/agent/session.js'
import type { WebSocketGateway } from './websocket/server.js'
import type { RateLimiter } from './services/rate-limiter.js'

interface AppDeps {
  instanceId: string
  sessionManager: SessionManager
  wsGateway: WebSocketGateway
  rateLimiter: RateLimiter
}

export function createApp(deps: AppDeps): Express {
  const app = express()

  // 中间件
  app.use(cors())
  app.use(express.json({ limit: '10mb' }))

  // 认证中间件（应用到所有 /api 路由）
  app.use('/api', authMiddleware)

  // 限流中间件
  const rateLimitMiddleware = createRateLimitMiddleware(deps.rateLimiter)
  app.use('/api', rateLimitMiddleware)

  // 路由
  const routes = createRoutes(deps)
  app.use('/', routes)

  return app
}
