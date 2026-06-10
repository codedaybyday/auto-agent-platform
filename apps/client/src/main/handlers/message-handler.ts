import { BrowserWindow } from 'electron'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { resolve } from 'path'
import {
  getCurrentSessionId,
  setCurrentSessionId,
  addSession,
  notifySessionsUpdated
} from '../core/session-manager'
import { cleanupSessionTools } from '../tools/executor'
import { generateId, getPendingConnectResolve, setPendingConnectResolve, getPendingSessionResolve, setPendingSessionResolve, sendMessage } from '../core/server-connection'
import { log } from '@auto-agent/shared-utils'

/**
 * MCP Client 实例（每个会话一个）
 */
const mcpClients = new Map<string, Client>()
const mcpTransports = new Map<string, StdioClientTransport>()

/**
 * 获取或创建 MCP Client
 */
async function getOrCreateMCPClient(sessionId: string): Promise<Client> {
  if (mcpClients.has(sessionId)) {
    return mcpClients.get(sessionId)!
  }

  log.info('MCP', `Creating MCP Client for session: ${sessionId}`)

  // 启动本地 MCP Server
  const isDev = process.env.NODE_ENV !== 'production'
  const mcpServerPath = isDev
    ? resolve(process.cwd(), 'src/main/service/mcp/server.ts')
    : resolve(process.cwd(), 'out/main/service/mcp/server.js')

  const transport = new StdioClientTransport({
    command: isDev ? 'npx' : 'node',
    args: isDev
      ? ['tsx', mcpServerPath]
      : ['--experimental-specifier-resolution=node', mcpServerPath],
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'development',
      MCP_SESSION_ID: sessionId,
      AUTOAGENT_USER_ID: 'desktop-user', // TODO: 从主进程获取实际用户ID
      AUTOAGENT_WORKSPACE_PATH: process.env.AUTOAGENT_WORKSPACE_PATH
    }
  })

  const client = new Client({
    name: 'auto-agent-client',
    version: '1.0.0'
  })

  await client.connect(transport)

  mcpClients.set(sessionId, client)
  mcpTransports.set(sessionId, transport)

  log.info('MCP', `MCP Client connected for session: ${sessionId}`)

  return client
}

/**
 * 清理 MCP Client
 */
async function cleanupMCPClient(sessionId: string): Promise<void> {
  const client = mcpClients.get(sessionId)
  if (client) {
    await client.close()
    mcpClients.delete(sessionId)
    mcpTransports.delete(sessionId)
    log.info('MCP', `MCP Client cleaned up for session: ${sessionId}`)
  }
}

/**
 * 服务器消息处理
 */

export async function handleServerMessage(message: any, mainWindow: BrowserWindow | null) {
  console.log('[Main] Received:', message.type)

  switch (message.type) {
    case 'connect_ack':
      handleConnectAck()
      break

    case 'stream.chunk':
      handleStreamChunk(message, mainWindow)
      break

    case 'stream.complete':
      handleStreamComplete(message, mainWindow)
      break

    case 'stream.error':
      handleStreamError(message, mainWindow)
      break

    case 'state.update':
      handleStateUpdate(message, mainWindow)
      break

    case 'mcp.listTools':
      await handleMCPListTools(message)
      break

    case 'mcp.callTool':
      await handleMCPCallTool(message)
      break

    case 'tool.cleanup':
      await handleToolCleanup(message)
      break

    case 'session.create_ack':
      await handleSessionCreateAck(message, mainWindow)
      break
  }
}

/**
 * 处理 MCP listTools 请求
 */
async function handleMCPListTools(message: any): Promise<void> {
  const { messageId, sessionId } = message

  try {
    const client = await getOrCreateMCPClient(sessionId)
    const result = await client.listTools()

    // 详细记录返回值的结构
    log.info('MCP', 'listTools raw result', {
      result,
      type: typeof result,
      isArray: Array.isArray(result),
      keys: result && typeof result === 'object' ? Object.keys(result) : null,
      hasTools: result && typeof result === 'object' ? 'tools' in result : false,
      toolsType: result?.tools ? typeof result.tools : null,
      toolsIsArray: Array.isArray(result?.tools),
      toolsLength: result?.tools?.length
    })

    sendMessage({
      type: 'mcp.response',
      messageId,
      sessionId,
      payload: { result }
    })
  } catch (error) {
    log.error('MCP', 'listTools failed:', error)
    sendMessage({
      type: 'mcp.error',
      messageId,
      sessionId,
      payload: { error: error instanceof Error ? error.message : 'listTools failed' }
    })
  }
}

/**
 * 处理 MCP callTool 请求
 */
async function handleMCPCallTool(message: any): Promise<void> {
  const { messageId, sessionId, payload } = message

  try {
    const client = await getOrCreateMCPClient(sessionId)

    log.info('MCP', `Calling tool: ${payload.name}`, payload.arguments)

    const result = await client.callTool({
      name: payload.name,
      arguments: payload.arguments
    })

    sendMessage({
      type: 'mcp.response',
      messageId,
      sessionId,
      payload: { result }
    })
  } catch (error) {
    log.error('MCP', 'callTool failed:', error)
    sendMessage({
      type: 'mcp.error',
      messageId,
      sessionId,
      payload: { error: error instanceof Error ? error.message : 'callTool failed' }
    })
  }
}

function handleConnectAck() {
  console.log('[Main] Server acknowledged connection')
  const resolve = getPendingConnectResolve()
  if (resolve) {
    resolve()
    setPendingConnectResolve(null)
  }
}

function handleStreamChunk(message: any, mainWindow: BrowserWindow | null) {
  console.log(`[Main] Forwarding stream.chunk for session ${message.sessionId}`, message.payload?.type)

  // 处理 SSE 格式流式消息
  if (message.payload?.type === 'sse') {
    const { event, data } = message.payload

    if (event === 'content') {
      // 逐字内容 - 使用专门的流式事件
      mainWindow?.webContents.send('agent:stream_chunk', {
        chunk: data,
        sessionId: message.sessionId
      })
      return
    }

    if (event === 'done') {
      // 流式结束
      mainWindow?.webContents.send('agent:stream_done', {
        sessionId: message.sessionId
      })
      return
    }
  }

  // 兼容旧格式（非 SSE）
  mainWindow?.webContents.send('agent:message', {
    id: message.messageId || generateId(),
    role: 'assistant',
    content: message.payload?.content || '',
    timestamp: Date.now(),
    sessionId: message.sessionId
  })
}

function handleStreamComplete(message: any, mainWindow: BrowserWindow | null) {
  mainWindow?.webContents.send('agent:processing', { 
    processing: false, 
    sessionId: message.sessionId 
  })
}

function handleStreamError(message: any, mainWindow: BrowserWindow | null) {
  mainWindow?.webContents.send('agent:error', message.payload?.error)
  mainWindow?.webContents.send('agent:processing', { 
    processing: false, 
    sessionId: message.sessionId 
  })
}

function handleStateUpdate(message: any, mainWindow: BrowserWindow | null) {
  if (message.payload?.type === 'tool_start') {
    mainWindow?.webContents.send('agent:tool_start', {
      toolCall: message.payload.toolCall
    })
  } else if (message.payload?.type === 'tool_end') {
    mainWindow?.webContents.send('agent:tool_result', {
      toolCall: message.payload.toolCall,
      result: message.payload.result
    })
  }
}

async function handleToolCleanup(message: any) {
  console.log('[Main] Server requested tool cleanup for session:', message.sessionId)
  await cleanupSessionTools(message.sessionId)
}

async function handleSessionCreateAck(message: any, mainWindow: BrowserWindow | null) {
  if (message.payload?.session?.id) {
    const session = message.payload.session
    const sessionId = session.id
    
    setCurrentSessionId(sessionId)
    console.log('[Main] Session created:', sessionId)

    // 添加到本地会话缓存
    addSession({
      id: session.id,
      title: session.title || `会话 ${Date.now()}`,
      updatedAt: new Date(session.updatedAt).getTime(),
      messageCount: session.messages?.length || 0
    })

    // 通知渲染进程更新会话列表
    notifySessionsUpdated(mainWindow)

    // 通知等待的 init 调用
    const resolve = getPendingSessionResolve()
    if (resolve && sessionId) {
      resolve(sessionId)
      setPendingSessionResolve(null)
    }
  }
}
