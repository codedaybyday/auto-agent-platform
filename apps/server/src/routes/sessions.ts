/**
 * 会话管理路由
 */

import { Router } from 'express'
import type { AuthRequest } from '../middleware/auth.js'
import type { SessionManager } from '../services/agent/session.js'

interface SessionsDeps {
  sessionManager: SessionManager
}

export function createSessionsRouter(deps: SessionsDeps): Router {
  const router = Router()

  // 创建会话
  router.post('/', async (req: AuthRequest, res) => {
    try {
      const { title } = req.body
      const userId = req.user!.id

      const session = await deps.sessionManager.createSession(userId, title)

      res.json({
        success: true,
        data: { session }
      })
    } catch (error) {
      console.error('[API] Create session error:', error)
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // 获取用户的所有会话
  router.get('/', (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id
      const sessions = deps.sessionManager.getUserSessions(userId)

      res.json({
        success: true,
        data: { sessions }
      })
    } catch (error) {
      console.error('[API] List sessions error:', error)
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // 获取单个会话详情
  router.get('/:sessionId', (req: AuthRequest, res) => {
    try {
      const { sessionId } = req.params
      const session = deps.sessionManager.getSession(sessionId)

      if (!session) {
        res.status(404).json({
          success: false,
          error: 'Session not found'
        })
        return
      }

      // 验证权限
      if (session.userId !== req.user!.id) {
        res.status(403).json({
          success: false,
          error: 'Forbidden'
        })
        return
      }

      res.json({
        success: true,
        data: { session }
      })
    } catch (error) {
      console.error('[API] Get session error:', error)
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // 删除会话
  router.delete('/:sessionId', async (req: AuthRequest, res) => {
    try {
      const { sessionId } = req.params
      const session = deps.sessionManager.getSession(sessionId)

      if (!session) {
        res.status(404).json({
          success: false,
          error: 'Session not found'
        })
        return
      }

      // 验证权限
      if (session.userId !== req.user!.id) {
        res.status(403).json({
          success: false,
          error: 'Forbidden'
        })
        return
      }

      await deps.sessionManager.deleteSession(sessionId)

      res.json({
        success: true,
        data: { message: 'Session deleted' }
      })
    } catch (error) {
      console.error('[API] Delete session error:', error)
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  return router
}
