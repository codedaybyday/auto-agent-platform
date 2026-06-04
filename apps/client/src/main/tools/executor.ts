import { BrowserWindow } from 'electron'
import { ws } from '../core/server-connection'
import { getCurrentSessionId } from '../core/session-manager'
import { log } from '@auto-agent/shared-utils'
import type { BrowserController } from './browser-use/index.js'

/**
 * 工具执行器 - 统一管理工具的执行和清理
 */

// ==================== 工具执行 ====================

export async function executeToolAndReport(message: any, mainWindow: BrowserWindow | null): Promise<void> {
  const { toolCall } = message.payload
  const sessionId = message.sessionId

  if (!sessionId) {
    log.error('Main', 'sessionId is missing in tool.execute message')
    sendToolError(toolCall.id, sessionId || 'unknown', 'sessionId is missing')
    return
  }

  log.info('Main', `Executing tool: ${toolCall.name}`)

  try {
    const result = await executeTool(toolCall, sessionId)
    const success = result && typeof result.success === 'boolean' ? result.success : true

    await sendToolResult(toolCall.id, sessionId, success, result)
  } catch (error) {
    log.error('Main', 'Tool execution failed', error)
    sendToolError(
      toolCall.id,
      sessionId,
      error instanceof Error ? error.message : String(error)
    )
  }
}

async function executeTool(toolCall: any, sessionId: string): Promise<any> {
  const { createBashTool } = await import('./bash/index.js')
  const { browserController } = await import('./browser-use/index.js') as { browserController: BrowserController }

  switch (toolCall.name) {
    case 'bash':
      return executeBashTool(toolCall, sessionId, createBashTool)

    case 'browser_get_context':
      return browserController.getPageContext(sessionId)

    case 'browser_ai_execute':
      return executeBrowserAction(toolCall, sessionId, browserController)

    case 'browser_get_current_url': {
      const state = await browserController.getPageState(sessionId)
      return { url: state.url }
    }

    case 'browser_ai':
      return executeLegacyBrowserUse(toolCall, sessionId, browserController)

    case 'file_read':
      return executeFileRead(toolCall)

    case 'file_write':
      return executeFileWrite(toolCall)

    default:
      throw new Error(`Unknown tool: ${toolCall.name}`)
  }
}

async function executeBashTool(toolCall: any, sessionId: string, createBashTool: any): Promise<any> {
  const bashTool = createBashTool(
    sessionId || `temp_${Date.now()}`,
    async (command: string, riskLevel: string) => {
      log.warn('BashTool', `High risk command requires confirmation`)
      return true
    }
  )
  return await bashTool.execute(toolCall.arguments)
}

async function executeBrowserAction(
  toolCall: any,
  sessionId: string,
  browserController: BrowserController
): Promise<any> {
  const { action, actionIndex } = toolCall.arguments as { action: any; actionIndex?: number }
  log.debug('Main', `Executing browser_ai_execute action=${action?.type}${actionIndex !== undefined ? ` index=${actionIndex}` : ''}`)

  // 获取执行前的页面状态
  const stateBefore = await browserController.getPageState(sessionId)
  const urlBefore = stateBefore.url

  // 执行动作
  const actionResult = await browserController.executeAction(sessionId, action)

  // 对于可能触发导航的动作（click），给页面一点时间开始导航
  if (action.type === 'click') {
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  // 获取执行后的状态
  const stateAfter = await browserController.getPageState(sessionId)
  const urlAfter = stateAfter.url

  const navigationOccurred = urlBefore !== urlAfter

  return {
    result: actionResult.message,
    success: actionResult.success,
    navigationOccurred,
    urlChanged: navigationOccurred,
    actionIndex,
    actionType: action.type
  }
}

async function executeLegacyBrowserUse(
  toolCall: any,
  sessionId: string,
  browserController: BrowserController
): Promise<any> {
  const { instruction, ref } = toolCall.arguments

  if (ref !== undefined) {
    const actionResult = await browserController.executeAction(sessionId, {
      type: 'click',
      index: ref
    })
    return {
      result: actionResult.message,
      success: actionResult.success
    }
  } else if (instruction) {
    // 解析指令并执行
    const action = parseInstruction(instruction)
    const actionResult = await browserController.executeAction(sessionId, action)
    return {
      result: actionResult.message,
      success: actionResult.success
    }
  } else {
    throw new Error('browser_ai tool requires either "instruction" or "ref" parameter')
  }
}

/**
 * 简单指令解析
 */
function parseInstruction(instruction: string): any {
  const lower = instruction.toLowerCase()

  if (lower.includes('click') || lower.includes('点击')) {
    return { type: 'click', index: 0 } // 需要 LLM 提供具体 index
  }
  if (lower.includes('type') || lower.includes('输入')) {
    return { type: 'type', index: 0, text: '' }
  }
  if (lower.includes('scroll')) {
    return { type: 'scroll', direction: 'down', amount: 500 }
  }

  return { type: 'wait', ms: 1000 }
}

/**
 * 文件读取工具
 */
async function executeFileRead(toolCall: any): Promise<any> {
  try {
    const { path } = toolCall.arguments

    if (!path) {
      return { success: false, error: 'File path is required' }
    }

    const { readFileSync } = await import('fs')
    const content = readFileSync(path, 'utf-8')

    return {
      success: true,
      content,
      size: content.length
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * 文件写入工具
 */
async function executeFileWrite(toolCall: any): Promise<any> {
  try {
    const { path, content } = toolCall.arguments

    if (!path || content === undefined) {
      return {
        success: false,
        error: 'File path and content are required'
      }
    }

    const { writeFileSync, mkdirSync, existsSync } = await import('fs')
    const { dirname } = await import('path')

    const dir = dirname(path)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    writeFileSync(path, content, 'utf-8')

    return {
      success: true,
      message: `File written successfully: ${path}`,
      size: (content as string).length
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function sendToolResult(messageId: string, sessionId: string, success: boolean, data: any): Promise<void> {
  if (data?.screenshot) {
    try {
      if (data.screenshot.length > 10000) {
        const screenshotFileUrl = await uploadScreenshotFile(sessionId, data.screenshot)
        data.screenshotUrl = screenshotFileUrl
        delete data.screenshot
      }
    } catch (error) {
      log.error('Executor', 'Screenshot upload failed', error)
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
      data
    }
  }))
}

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

  const result = await response.json() as { url: string }
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
    return
  }

  try {
    const { sessionManager } = await import('./bash/index.js')
    sessionManager.destroy(targetSessionId)

    const { browserController } = await import('./browser-use/index.js') as { browserController: BrowserController }
    await browserController.close(targetSessionId)

    const { processRegistry } = await import('./bash/process-registry.js')
    processRegistry.cleanupSession(targetSessionId)
  } catch (error) {
    log.error('Main', 'Failed to cleanup tools', error)
  }
}

export async function cleanupAllTools(): Promise<void> {
  try {
    const { sessionManager } = await import('./bash/index.js')
    sessionManager.destroyAll()

    const { browserController } = await import('./browser-use/index.js') as { browserController: BrowserController }
    await browserController.closeAll()
  } catch (error) {
    log.error('Main', 'Failed to cleanup tools', error)
  }
}
