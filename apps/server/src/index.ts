/**
 * Auto Agent Server
 *
 * 基于 Express + WebSocket 的 Agent 后端服务
 * - Agent Loop 在后端运行（ReAct 范式）
 * - 工具执行通过 WebSocket 反向调用客户端
 * - 支持多用户、多会话并发
 */

import { startServer } from './server.js'

// 启动服务器
startServer()
