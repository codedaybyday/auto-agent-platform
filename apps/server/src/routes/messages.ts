/**
 * 消息相关路由
 */

import { Router } from 'express'
import type { AuthRequest } from '../middleware/auth.js'
import type { SessionManager } from '../services/agent/session.js'

interface MessagesDeps {
  sessionManager: SessionManager
}

export function createMessagesRouter(deps: MessagesDeps): Router {
  const router = Router({ mergeParams: true })

  // 发送消息（非流式）
  router.post('/chat', async (req: AuthRequest, res) => {
    try {
      const { sessionId } = req.params
      const { content } = req.body
      const userId = req.user!.id

      if (!content) {
        res.status(400).json({
          success: false,
          error: 'Missing content'
        })
        return
      }

      const { agentLoop } = await deps.sessionManager.getOrCreateSession(userId, sessionId)

      // 非流式：等待完整响应
      let response = ''
      let isComplete = false
      let error: any = null

      agentLoop.on('stream_chunk', (data) => {
        if (data.content) {
          response += data.content
        }
      })

      agentLoop.on('run_complete', () => {
        isComplete = true
      })

      agentLoop.on('run_error', (data) => {
        error = data.error
        isComplete = true
      })

      // 启动 Agent Loop
      agentLoop.run(content).catch(err => {
        error = err
        isComplete = true
      })

      // 等待完成或超时
      const startTime = Date.now()
      const timeout = 120000 // 120秒超时

      while (!isComplete && Date.now() - startTime < timeout) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      if (error) {
        res.status(500).json({
          success: false,
          error: error.message
        })
        return
      }

      if (!isComplete) {
        res.status(504).json({
          success: false,
          error: 'Request timeout'
        })
        return
      }

      res.json({
        success: true,
        data: {
          response,
          sessionId: agentLoop.getState().sessionId
        }
      })
    } catch (error) {
      console.error('[API] Chat error:', error)
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // 获取会话历史消息
  router.get('/messages', (req: AuthRequest, res) => {
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

      const agentLoop = deps.sessionManager.getAgentLoop(sessionId)
      const messages = agentLoop?.getMessages() || session.messages

      res.json({
        success: true,
        data: { messages }
      })
    } catch (error) {
      console.error('[API] Get messages error:', error)
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // 清除会话消息
  router.delete('/messages', async (req: AuthRequest, res) => {
    try {
      const { sessionId } = req.params
      console.log('[API] Clear messages request for session:', sessionId, 'user:', req.user?.id)
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

      await deps.sessionManager.clearSessionMessages(sessionId)
      console.log('[API] Messages cleared for session:', sessionId)

      res.json({
        success: true,
        message: 'Messages cleared'
      })
    } catch (error) {
      console.error('[API] Clear messages error:', error)
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  return router
}
