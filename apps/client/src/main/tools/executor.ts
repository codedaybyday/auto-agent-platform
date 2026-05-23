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

    await sendToolResult(toolCall.id, sessionId, success, result)
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

    case 'file_read':
      result = await executeFileRead(toolCall)
      break

    case 'file_write':
      result = await executeFileWrite(toolCall)
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

/**
 * 文件读取工具
 */
async function executeFileRead(toolCall: any): Promise<any> {
  try {
    const { path } = toolCall.arguments

    if (!path) {
      console.error('[FileRead] File path is required')
      return {
        success: false,
        error: 'File path is required'
      }
    }

    console.log(`[FileRead] Reading file: ${path}`)
    const { readFileSync } = await import('fs')
    const content = readFileSync(path, 'utf-8')

    console.log(`[FileRead] Successfully read ${content.length} characters from ${path}`)
    return {
      success: true,
      content,
      size: content.length
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error(`[FileRead] Error reading file: ${errorMsg}`)
    return {
      success: false,
      error: errorMsg
    }
  }
}

/**
 * 文件写入工具
 */
async function executeFileWrite(toolCall: any): Promise<any> {
  try {
    const { path, content } = toolCall.arguments

    if (!path) {
      console.error('[FileWrite] File path is required')
      return {
        success: false,
        error: 'File path is required'
      }
    }

    if (content === undefined) {
      console.error('[FileWrite] File content is required')
      return {
        success: false,
        error: 'File content is required'
      }
    }

    console.log(`[FileWrite] Writing ${(content as string).length} characters to ${path}`)
    const { writeFileSync, mkdirSync, existsSync } = await import('fs')
    const { dirname } = await import('path')
    
    // 确保父目录存在
    const dir = dirname(path)
    if (!existsSync(dir)) {
      console.log(`[FileWrite] Creating directory: ${dir}`)
      mkdirSync(dir, { recursive: true })
    }
    
    writeFileSync(path, content, 'utf-8')

    console.log(`[FileWrite] Successfully wrote file: ${path}`)
    return {
      success: true,
      message: `File written successfully: ${path}`,
      size: (content as string).length
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error(`[FileWrite] Error writing file: ${errorMsg}`)
    return {
      success: false,
      error: errorMsg
    }
  }
}

async function sendToolResult(messageId: string, sessionId: string, success: boolean, data: any): Promise<void> {
  // 改进的截图处理逻辑，添加详细日志和错误处理
  if (data?.screenshot) {
    console.log(`[Executor] Screenshot result detected:`, {
      type: typeof data.screenshot,
      length: typeof data.screenshot === 'string' ? data.screenshot.length : 'N/A',
      isBase64: typeof data.screenshot === 'string' && data.screenshot.startsWith('iVBO'),
      preview: typeof data.screenshot === 'string' ? data.screenshot.substring(0, 20) : 'N/A'
    })

    if (typeof data.screenshot === 'string' && data.screenshot.length > 0) {
      try {
        console.log(`[Executor] Processing screenshot (${data.screenshot.length} chars)...`)
        
        // 上传截图到服务器，无论大小
        if (data.screenshot.length > 10000) {
          console.log(`[Executor] Uploading screenshot to server (${data.screenshot.length} chars)...`)
          const screenshotFileUrl = await uploadScreenshotFile(sessionId, data.screenshot)
          console.log(`[Executor] Screenshot uploaded successfully: ${screenshotFileUrl}`)
          data.screenshotUrl = screenshotFileUrl
          delete data.screenshot // 删除原始的 base64，节省带宽
        } else {
          // 小截图保留在返回值中
          console.log(`[Executor] Screenshot is small (${data.screenshot.length} chars), keeping in response`)
          data.screenshotUrl = undefined
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        console.error(`[Executor] Screenshot processing error: ${errorMsg}`)
        
        // Fallback: 如果上传失败，尝试保留原始 base64（较小时）
        if (data.screenshot.length <= 500000) {
          console.log(`[Executor] Fallback: keeping base64 in response (${data.screenshot.length} chars)`)
          data.screenshotUrl = undefined
        } else {
          console.warn(`[Executor] Screenshot too large to fallback (${data.screenshot.length} chars), removing`)
          delete data.screenshot
        }
      }
    } else if (data.screenshot) {
      console.warn(`[Executor] Screenshot is not a valid string:`, {
        type: typeof data.screenshot,
        length: (data.screenshot as any)?.length
      })
    }
  }

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

/**
 * 将 base64 截图上传到服务器文件存储
 */
async function uploadScreenshotFile(sessionId: string, base64Data: string): Promise<string> {
  const buffer = Buffer.from(base64Data, 'base64')

  const response = await fetch(`http://localhost:3000/api/files/upload`, {
    method: 'POST',
    body: buffer,
    headers: {
      'Content-Type': 'image/png',
      'x-session-id': sessionId,
      'x-filename': `screenshot-${Date.now()}.png`
    }
  })

  if (!response.ok) {
    throw new Error(`Failed to upload screenshot: ${response.statusText}`)
  }

  const result = await response.json() as { id: string; url: string }
  return result.url
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
