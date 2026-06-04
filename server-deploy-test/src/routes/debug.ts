/**
 * 开发调试路由
 */

import { Router, Request, Response } from 'express'
import type { SessionManager } from '../services/agent/session.js'
import type { WebSocketGateway } from '../websocket/server.js'
import type { RateLimiter } from '../services/rate-limiter.js'

interface DebugDeps {
  instanceId: string
  sessionManager: SessionManager
  wsGateway: WebSocketGateway
  rateLimiter: RateLimiter
}

export function createDebugRouter(deps: DebugDeps): Router {
  const router = Router()

  // 获取服务器统计（仅开发环境）
  router.get('/stats', (req: Request, res: Response) => {
    if (process.env.NODE_ENV === 'production') {
      res.status(404).json({ error: 'Not found' })
      return
    }

    res.json({
      instanceId: deps.instanceId,
      sessions: deps.sessionManager.getStats(),
      websocket: deps.wsGateway.getStats(),
      rateLimit: deps.rateLimiter.getStats()
    })
  })

  return router
}
