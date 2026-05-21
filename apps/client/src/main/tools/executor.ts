import { BrowserWindow } from 'electron'
import { ws } from '../core/server-connection'
import { getCurrentSessionId } from '../core/session-manager'
import { parseBrowserInstruction } from '../services/browser/browser-instruction-parser'

/**
 * 工具执行器 - 统一管理工具的执行和清理
 */

// ==================== 工具执行 ====================

export async function executeToolAndReport(message: any, mainWindow: BrowserWindow | null): Promise<void> {
  const { toolCall } = message.payload
  const sessionId = message.sessionId

  // 验证 sessionId 有效性
  if (!sessionId) {
    console.error('[Main] Error: sessionId is missing in tool.execute message')
    sendToolError(toolCall.id, sessionId || 'unknown', 'sessionId is missing')
    return
  }

  console.log(`[Main] Executing tool: ${toolCall.name} for session: ${sessionId}`)

  try {
    const result = await executeTool(toolCall, sessionId)
    const success = result && typeof result.success === 'boolean' ? result.success : true

    sendToolResult(toolCall.id, sessionId, success, result)
  } catch (error) {
    console.error('[Main] Tool execution failed:', error)
    sendToolError(
      toolCall.id,
      sessionId,
      error instanceof Error ? error.message : String(error)
    )
  }
}

async function executeTool(toolCall: any, sessionId: string): Promise<any> {
  const { createBashTool } = await import('./bash/index.js')
  const { browserUse } = await import('./browser-use/index.js')

  let result: any

  switch (toolCall.name) {
    case 'bash':
      result = await executeBashTool(toolCall, sessionId, createBashTool)
      break

    case 'browser_get_context':
      result = await browserUse.getPageContext(sessionId)
      break

    case 'browser_ai_execute':
      result = await executeBrowserAction(toolCall, sessionId, browserUse)
      break

    case 'browser_get_current_url':
      result = { url: await browserUse.getCurrentUrl(sessionId) }
      break

    case 'browser_ai':
      result = await executeLegacyBrowserUse(toolCall, sessionId, browserUse)
      break

    default:
      throw new Error(`Unknown tool: ${toolCall.name}`)
  }

  return result
}

async function executeBashTool(toolCall: any, sessionId: string, createBashTool: any): Promise<any> {
  const bashTool = createBashTool(
    sessionId || `temp_${Date.now()}`,
    async (command: string, riskLevel: string) => {
      console.log(`[BashTool] High risk command requires confirmation: ${command}`)
      return true
    }
  )
  return await bashTool.execute(toolCall.arguments)
}

async function executeBrowserAction(toolCall: any, sessionId: string, browserUse: any): Promise<any> {
  const { action, actionIndex } = toolCall.arguments as { action: any; actionIndex?: number }
  console.log(`[Main] Executing browser_ai_execute for session ${sessionId}:`, action)

  // 获取执行前的页面状态
  const pageBefore = await browserUse.getCurrentUrl(sessionId)
  const domHashBefore = await browserUse.getDOMHash(sessionId)

  // 执行动作
  const actionResult = await browserUse.executeBrowserAction(sessionId, action)

  // 检测页面变化
  const pageAfter = await browserUse.getCurrentUrl(sessionId)
  const domHashAfter = await browserUse.getDOMHash(sessionId)

  const navigationOccurred = pageBefore !== pageAfter
  const domChanged = domHashBefore !== domHashAfter

  // 如果页面发生变化，刷新缓存
  if (domChanged || navigationOccurred) {
    console.log(`[Main] Page changed, refreshing context...`)
    await browserUse.refreshPageContext(sessionId)
  }

  return {
    result: actionResult.result,
    success: actionResult.success,
    navigationOccurred,
    domChanged,
    urlChanged: pageBefore !== pageAfter,
    actionIndex,
    actionType: action.type
  }
}

async function executeLegacyBrowserUse(toolCall: any, sessionId: string, browserUse: any): Promise<any> {
  const { instruction, ref } = toolCall.arguments

  if (ref !== undefined) {
    const actionResult = await browserUse.clickByIndex(sessionId, ref)
    return {
      result: actionResult.result,
      success: actionResult.success
    }
  } else if (instruction) {
    const action = parseBrowserInstruction(instruction)
    const actionResult = await browserUse.executeBrowserAction(sessionId, action)
    return {
      result: actionResult.result,
      success: actionResult.success
    }
  } else {
    throw new Error('browser_ai tool requires either "instruction" or "ref" parameter')
  }
}

function sendToolResult(messageId: string, sessionId: string, success: boolean, data: any): void {
  ws?.send(JSON.stringify({
    type: 'tool.result',
    messageId,
    timestamp: Date.now(),
    sessionId,
    payload: {
      toolCallId: messageId,
      success,
      data,
      executionTime: 0
    }
  }))
}

function sendToolError(messageId: string, sessionId: string, error: string): void {
  ws?.send(JSON.stringify({
    type: 'tool.error',
    messageId,
    timestamp: Date.now(),
    sessionId,
    payload: {
      toolCallId: messageId,
      success: false,
      error
    }
  }))
}

// ==================== 工具清理 ====================

export async function cleanupSessionTools(sessionId: string | undefined): Promise<void> {
  const targetSessionId = sessionId || getCurrentSessionId()
  
  if (!targetSessionId) {
    console.log('[Main] No session ID for cleanup, skipping')
    return
  }

  console.log(`[Main] Cleaning up tools for session: ${targetSessionId}`)

  try {
    // 导入并清理 bash session
    const { sessionManager } = await import('./bash/index.js')
    sessionManager.destroy(targetSessionId)
    console.log(`[Main] Bash session ${targetSessionId} destroyed`)

    // 清理会话的浏览器上下文
    const { browserUse } = await import('./browser-use/index.js')
    await browserUse.close(targetSessionId)
    console.log(`[Main] BrowserUse context closed for session ${targetSessionId}`)

    // 清理进程注册表
    const { processRegistry } = await import('./bash/process-registry.js')
    processRegistry.cleanupSession(targetSessionId)
    console.log(`[Main] Process registry cleaned for session ${targetSessionId}`)

    console.log(`[Main] Tools cleanup completed for session: ${targetSessionId}`)
  } catch (error) {
    console.error(`[Main] Failed to cleanup tools for session ${targetSessionId}:`, error)
  }
}

export async function cleanupAllTools(): Promise<void> {
  console.log('[Main] Cleaning up all tools')

  // 清理所有 shell 会话
  try {
    const { sessionManager } = await import('./bash/index.js')
    sessionManager.destroyAll()
    console.log('[Main] All shell sessions cleaned up')
  } catch (error) {
    console.error('[Main] Failed to cleanup shell sessions:', error)
  }

  // 清理所有浏览器会话
  try {
    const { browserUse } = await import('./browser-use/index.js')
    await browserUse.closeAll()
    console.log('[Main] All browser sessions cleaned up')
  } catch (error) {
    console.error('[Main] Failed to cleanup browser sessions:', error)
  }
}
