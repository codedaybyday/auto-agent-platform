/**
 * Auto Agent Server
 *
 * 基于 Express + WebSocket 的 Agent 后端服务
 * - Agent Loop 在后端运行（ReAct 范式）
 * - 工具执行通过 WebSocket 反向调用客户端
 * - 支持多用户、多会话并发
 *
 * TODO: 接入外部登录系统 (参见 middleware/auth.ts)
 */

import express, { Request, Response } from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { config } from './config/index.js'
import { authMiddleware, AuthRequest } from './middleware/auth.js'
import { SessionManager } from './services/agent/session.js'
import { WebSocketGateway } from './websocket/server.js'
import { rateLimiter } from './services/rate-limiter.js'
// import { AgentLoop } from './services/agent/loop.js'

// 生成实例 ID（用于多实例部署时区分）
const INSTANCE_ID = `${process.env.HOSTNAME || 'local'}-${Date.now()}`
console.log(`[Server] Instance ID: ${INSTANCE_ID}`)

// 创建 Express 应用
const app = express()
const server = createServer(app)

// 中间件
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// 限流中间件
function rateLimitMiddleware(req: AuthRequest, res: Response, next: any) {
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

// 初始化服务
const sessionManager = new SessionManager(INSTANCE_ID, {
  maxSessionsPerUser: 10,
  maxGlobalSessions: 1000
})

// 初始化 WebSocket（注入限流器）
const wsGateway = new WebSocketGateway(server, sessionManager, INSTANCE_ID, rateLimiter)

// 启动限流器清理任务（每5分钟清理过期桶）
setInterval(() => {
  rateLimiter.cleanup()
}, 5 * 60 * 1000)

// ==================== HTTP API 路由 ====================

// 健康检查
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    instanceId: INSTANCE_ID,
    stats: {
      sessions: sessionManager.getStats(),
      websocket: wsGateway.getStats(),
      rateLimit: rateLimiter.getStats()
    }
  })
})

// 创建会话（需要认证 + 限流）
app.post('/api/sessions', authMiddleware, rateLimitMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { title } = req.body
    const userId = req.user!.id

    const session = await sessionManager.createSession(userId, title)

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

// 获取用户的所有会话（需要认证）
app.get('/api/sessions', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id
    const sessions = sessionManager.getUserSessions(userId)

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

// 获取单个会话详情（需要认证）
app.get('/api/sessions/:sessionId', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { sessionId } = req.params
    const session = sessionManager.getSession(sessionId)

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

// 删除会话（需要认证）
app.delete('/api/sessions/:sessionId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId } = req.params
    const session = sessionManager.getSession(sessionId)

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

    await sessionManager.deleteSession(sessionId)

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

// 发送消息（非流式，需要认证 + 限流）
app.post('/api/sessions/:sessionId/chat', authMiddleware, rateLimitMiddleware, async (req: AuthRequest, res: Response) => {
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

    const { agentLoop } = await sessionManager.getOrCreateSession(userId, sessionId)

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

    // 启动 Agent Loop（不绑定 WebSocket，因为非流式）
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

// 获取会话历史消息（需要认证）
app.get('/api/sessions/:sessionId/messages', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { sessionId } = req.params
    const session = sessionManager.getSession(sessionId)

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

    const agentLoop = sessionManager.getAgentLoop(sessionId)
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
app.delete('/api/sessions/:sessionId/messages', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId } = req.params
    console.log('[API] Clear messages request for session:', sessionId, 'user:', req.user?.id)
    const session = sessionManager.getSession(sessionId)

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

    await sessionManager.clearSessionMessages(sessionId)
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

// ==================== 开发调试用路由 ====================

// 获取服务器统计（仅开发环境）
app.get('/debug/stats', (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ error: 'Not found' })
    return
  }

  res.json({
    instanceId: INSTANCE_ID,
    sessions: sessionManager.getStats(),
    websocket: wsGateway.getStats(),
    rateLimit: rateLimiter.getStats()
  })
})

// ==================== 错误处理 ====================

// 404 处理
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' })
})

// 全局错误处理
app.use((err: Error, _req: Request, res: Response, _next: any) => {
  console.error('[Server] Unhandled error:', err)
  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message
  })
})

// ==================== 启动服务器 ====================

const PORT = config.port || 3000

server.listen(PORT, () => {
  console.log(`
🚀 Auto Agent Server running
   Port: ${PORT}
   Instance: ${INSTANCE_ID}
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
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down gracefully')
  server.close(() => {
    console.log('[Server] Server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received, shutting down gracefully')
  server.close(() => {
    console.log('[Server] Server closed')
    process.exit(0)
  })
})
