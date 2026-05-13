/**
 * Auto Agent Server
 *
 * 产品级服务端架构，后续实现：
 * - WebSocket Gateway (实时通信)
 * - Agent Manager (会话管理)
 * - Tool Registry (工具注册)
 * - Auth Service (认证授权)
 * - Rate Limiting (限流)
 */

import express from 'express'
import cors from 'cors'
import { config } from './config/index.js'

const app = express()

// 中间件
app.use(cors())
app.use(express.json())

// 健康检查
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// TODO: 后续实现 WebSocket Server
// TODO: 后续实现 Agent Manager
// TODO: 后续实现认证路由

const PORT = config.port || 3000

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📡 WebSocket will be available on ws://localhost:${PORT}`)
})
