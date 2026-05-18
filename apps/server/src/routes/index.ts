/**
 * 路由汇总
 */

import { Router, Request, Response } from 'express'
import type { AuthRequest } from '../middleware/auth.js'
import type { SessionManager } from '../services/agent/session.js'
import type { WebSocketGateway } from '../websocket/server.js'
import type { RateLimiter } from '../services/rate-limiter.js'
import { createHealthRouter } from './health.js'
import { createSessionsRouter } from './sessions.js'
import { createMessagesRouter } from './messages.js'
import { createDebugRouter } from './debug.js'

interface RouterDeps {
  instanceId: string
  sessionManager: SessionManager
  wsGateway: WebSocketGateway
  rateLimiter: RateLimiter
}

export function createRoutes(deps: RouterDeps): Router {
  const router = Router()

  // 健康检查
  router.use('/', createHealthRouter(deps))

  // 会话管理
  router.use('/api/sessions', createSessionsRouter({ sessionManager: deps.sessionManager }))

  // 消息相关（嵌套路由 /api/sessions/:sessionId/*）
  router.use('/api/sessions/:sessionId', createMessagesRouter({ sessionManager: deps.sessionManager }))

  // 开发调试
  router.use('/debug', createDebugRouter(deps))

  // 404 处理
  router.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' })
  })

  // 全局错误处理
  router.use((err: Error, _req: Request, res: Response, _next: any) => {
    console.error('[Server] Unhandled error:', err)
    res.status(500).json({
      error: process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : err.message
    })
  })

  return router
}

// 限流中间件
export function createRateLimitMiddleware(rateLimiter: RateLimiter) {
  return (req: AuthRequest, res: Response, next: any) => {
    const userId = req.user?.id || req.body?.userId || 'anonymous'

    const check = rateLimiter.checkHttpRequest(userId)
    if (!check.allowed) {
      res.status(429).json({
        success: false,
        error: `请求过于频繁，请 ${check.retryAfter} 秒后再试`,
        retryAfter: check.retryAfter
      })
      return
    }

    next()
  }
}
