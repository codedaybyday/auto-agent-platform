/**
 * 健康检查路由
 */

import { Router } from 'express'
import type { SessionManager } from '../services/agent/session.js'
import type { WebSocketGateway } from '../websocket/server.js'
import type { RateLimiter } from '../services/rate-limiter.js'

interface HealthDeps {
  instanceId: string
  sessionManager: SessionManager
  wsGateway: WebSocketGateway
  rateLimiter: RateLimiter
}

export function createHealthRouter(deps: HealthDeps): Router {
  const router = Router()

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      instanceId: deps.instanceId,
      stats: {
        sessions: deps.sessionManager.getStats(),
        websocket: deps.wsGateway.getStats(),
        rateLimit: deps.rateLimiter.getStats()
      }
    })
  })

  return router
}
