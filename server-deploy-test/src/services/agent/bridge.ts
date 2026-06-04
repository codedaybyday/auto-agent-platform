/**
 * Tool Bridge 服务
 * 工具代理层：判断工具在哪里执行并路由到正确的执行器
 */

import { ToolType, type ToolCall, type ToolResult, type WSConnection } from '../../types/index.js'
import { BrowserAIParser, type ParsedBrowserAction, type SingleBrowserAction, type BatchBrowserAction } from '../llm/parser.js'
import { LLMClient } from '../llm/client.js'

interface ToolExecuteRequest {
  toolCall: ToolCall
  timeout: number
}

interface ToolExecuteResponse {
  success: boolean
  data?: any
  error?: string
  executionTime: number
  metadata?: {
    screenshot?: string
    logs?: string[]
  }
}

interface BrowserAIExecuteRequest {
  action: ParsedBrowserAction
  timeout: number
}

interface BatchActionResult {
  actionIndex: number
  action: SingleBrowserAction
  success: boolean
  result?: string
  error?: string
  domChanged?: boolean
  navigationOccurred?: boolean
}

interface BatchExecutionSummary {
  totalActions: number
  completedActions: number
  failedActions: number
  stoppedReason: 'completed' | 'dom_changed' | 'navigation' | 'popup' | 'error' | 'max_actions'
  results: BatchActionResult[]
  finalUrl?: string
}

export class ToolBridge {
  private sessionId: string
  private userId: string
  private wsClient: WSConnection | null = null
  private pendingRequests = new Map<string, { resolve: (value: ToolResult) => void; reject: (reason: Error) => void }>()
  private browserAIParser: BrowserAIParser | null = null

  constructor(sessionId: string, userId: string, llmClient?: LLMClient) {
    this.sessionId = sessionId
    this.userId = userId
    if (llmClient) {
      this.browserAIParser = new BrowserAIParser(llmClient)
    }
  }

  /**
   * 设置 LLMClient（用于 browser_ai 语义解析）
   */
  setLLMClient(llmClient: LLMClient): void {
    this.browserAIParser = new BrowserAIParser(llmClient)
  }

  /**
   * 绑定 WebSocket 客户端（用于调用本地工具）
   */
  bindWebSocket(wsClient: WSConnection): void {
    this.wsClient = wsClient
  }

  /**
   * 判断工具类型
   */
  private classifyTool(toolName: string): ToolType {
    const localTools = ['browser', 'browser_ai', 'bash', 'file_read', 'file_write']
    const remoteTools = ['http_request', 'search_api', 'weather']

    if (localTools.includes(toolName)) return ToolType.LOCAL
    if (remoteTools.includes(toolName)) return ToolType.REMOTE
    return ToolType.HYBRID
  }

  /**
   * 执行工具的主入口
   */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    // 特殊处理 browser_ai：服务端先解析语义，再发送结构化动作到客户端
    if (toolCall.name === 'browser_ai') {
      return this.executeBrowserAI(toolCall)
    }

    const toolType = this.classifyTool(toolCall.name)

    switch (toolType) {
      case ToolType.LOCAL:
        return this.executeLocalTool(toolCall)
      case ToolType.REMOTE:
        return this.executeRemoteTool(toolCall)
      case ToolType.HYBRID:
        // 优先尝试本地，如果客户端不在线则回退到远程
        if (this.wsClient?.isAlive) {
          return this.executeLocalTool(toolCall)
        } else {
          return this.executeRemoteTool(toolCall)
        }
      default:
        throw new Error(`Unknown tool: ${toolCall.name}`)
    }
  }

  /**
   * 执行 browser_ai 工具
   * 支持批量动作规划与执行，减少 DOM 获取和 LLM 调用次数
   */
  private async executeBrowserAI(toolCall: ToolCall): Promise<ToolResult> {
    const startTime = Date.now()
    const { instruction, ref, useBatch = true } = toolCall.arguments as { instruction?: string; ref?: string; useBatch?: boolean }

    // 如果有 ref，直接透传给客户端执行（简单场景）
    if (ref) {
      return this.executeLocalTool({
        ...toolCall,
        name: 'browser_ai_execute',
        arguments: { action: { type: 'click', ref: parseInt(ref) } }
      })
    }

    // 没有指令，返回错误
    if (!instruction) {
      return {
        toolCallId: toolCall.id,
        success: false,
        error: 'browser_ai requires either "instruction" or "ref" parameter',
        executionTime: Date.now() - startTime
      }
    }

    // 检查是否有语义解析器
    if (!this.browserAIParser) {
      return {
        toolCallId: toolCall.id,
        success: false,
        error: 'BrowserAI parser not initialized (LLMClient required)',
        executionTime: Date.now() - startTime
      }
    }

    // 步骤 1: 获取页面上下文（只获取一次）
    console.log(`[ToolBridge] Getting page context for: ${instruction}`)
    const contextResult = await this.getPageContext()

    if (!contextResult.success) {
      console.log(`[ToolBridge] No page context, trying navigation parse`)
      return this.executeSimpleBrowserAI(toolCall, instruction, startTime)
    }

    console.log(`[ToolBridge] Context loaded: ${contextResult.context?.elements?.length || 0} elements`)

    // 步骤 2: 使用批量规划（如果启用）
    if (useBatch) {
      console.log(`[ToolBridge] Using batch planning for: ${instruction}`)
      const batchResult = await this.executeBatchBrowserAI(
        toolCall,
        instruction,
        contextResult.context!,
        startTime
      )
      return batchResult
    }

    // 降级为单动作执行
    return this.executeSimpleBrowserAI(toolCall, instruction, startTime, contextResult.context)
  }

  /**
   * 批量执行 browser_ai 动作
   * 执行一次批量计划，当因弹窗/DOM变化停止时，返回给LLM重新决策
   * 不自动继续，让Agent Loop决定下一步
   */
  private async executeBatchBrowserAI(
    toolCall: ToolCall,
    instruction: string,
    context: any,
    startTime: number
  ): Promise<ToolResult> {
    // 批量规划动作
    const planResult = await this.browserAIParser!.planBatchActions(
      instruction,
      context,
      5
    )

    if (!planResult.success || !planResult.batchAction) {
      // 降级为单动作执行
      if (planResult.action) {
        const singleResult = await this.executeLocalTool({
          ...toolCall,
          name: 'browser_ai_execute',
          arguments: { action: planResult.action }
        })
        return {
          toolCallId: toolCall.id,
          success: singleResult.success,
          data: {
            batchExecution: true,
            iterations: 1,
            totalActions: 1,
            successfulActions: singleResult.success ? 1 : 0,
            failedActions: singleResult.success ? 0 : 1,
            lastStoppedReason: singleResult.success ? 'completed' : 'error',
            results: [{
              actionIndex: 0,
              action: planResult.action as SingleBrowserAction,
              success: singleResult.success,
              result: singleResult.data?.result,
              error: singleResult.error
            }],
            completed: singleResult.success
          },
          error: singleResult.error,
          executionTime: Date.now() - startTime
        }
      }

      return {
        toolCallId: toolCall.id,
        success: false,
        error: planResult.error || 'Failed to plan actions',
        executionTime: Date.now() - startTime
      }
    }

    // 执行批量动作
    const batchResult = await this.executeBatchActions(
      toolCall,
      planResult.batchAction,
      context.url
    )

    const actionTypes = batchResult.results.map(r => r.action.type).join(', ')
    console.log(`[Batch] 执行 [${actionTypes}] → ${batchResult.stoppedReason}`)

    const successCount = batchResult.results.filter(r => r.success).length
    const executionTime = Date.now() - startTime

    // browser-use 风格：只返回执行结果，不预设下一步该做什么
    // 让 LLM 基于新的 DOM 状态自己决策
    return {
      toolCallId: toolCall.id,
      success: successCount === batchResult.results.length && batchResult.results.length > 0,
      data: {
        batchExecution: true,
        totalActions: batchResult.results.length,
        successfulActions: successCount,
        failedActions: batchResult.results.length - successCount,
        stoppedReason: batchResult.stoppedReason,
        results: batchResult.results
      },
      error: successCount < batchResult.results.length
        ? `${batchResult.results.length - successCount} actions failed`
        : undefined,
      executionTime
    }
  }

  /**
   * 判断任务是否完成
   * 基于已执行的动作和当前页面状态简单判断
   */
  private isTaskCompleted(task: string, results: BatchActionResult[]): boolean {
    // 简单启发式：如果有动作成功执行，且最后没有错误，认为可能完成
    // 实际应由 LLM 在下一步判断
    const hasSuccess = results.some(r => r.success)
    const lastFailed = results.length > 0 && !results[results.length - 1].success

    // 如果最后一个动作失败，可能需要重试
    if (lastFailed) return false

    // 否则让 LLM 基于新的 DOM 状态决定
    return false
  }

  /**
   * 执行批量动作
   */
  private async executeBatchActions(
    toolCall: ToolCall,
    batchAction: BatchBrowserAction,
    initialUrl: string
  ): Promise<BatchExecutionSummary> {
    const results: BatchActionResult[] = []
    const actions = batchAction.actions.slice(0, batchAction.stopConditions?.maxActions || 5)

    let stoppedReason: BatchExecutionSummary['stoppedReason'] = 'completed'

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i]
      console.log(`[ToolBridge] Executing action ${i + 1}/${actions.length}: ${action.type}`)

      // 执行单个动作
      const actionToolCall: ToolCall = {
        ...toolCall,
        id: `${toolCall.id}-${i}`,
        name: 'browser_ai_execute',
        arguments: { action, actionIndex: i }
      }

      const result = await this.executeLocalTool(actionToolCall)

      // 检查执行结果
      const actionResult: BatchActionResult = {
        actionIndex: i,
        action,
        success: result.success,
        result: result.data?.result || result.data,
        error: result.error
      }

      // 检查是否触发停止条件
      if (result.data?.domChanged && batchAction.stopConditions?.onDOMChange) {
        actionResult.domChanged = true
        stoppedReason = 'dom_changed'
        results.push(actionResult)
        console.log(`[ToolBridge] Stopping batch: DOM changed`)
        break
      }

      if (result.data?.navigationOccurred && batchAction.stopConditions?.onNavigation) {
        actionResult.navigationOccurred = true
        stoppedReason = 'navigation'
        results.push(actionResult)
        console.log(`[ToolBridge] Stopping batch: Navigation occurred`)
        break
      }

      if (result.data?.hasPopup && batchAction.stopConditions?.onPopup) {
        stoppedReason = 'popup'
        results.push(actionResult)
        console.log(`[ToolBridge] Stopping batch: Popup detected`)
        break
      }

      results.push(actionResult)

      // 如果动作失败，停止执行
      if (!result.success) {
        stoppedReason = 'error'
        console.log(`[ToolBridge] Stopping batch: Action failed`)
        break
      }
    }

    // 获取最终 URL
    const finalUrlResult = await this.executeLocalTool({
      id: this.generateId(),
      name: 'browser_get_current_url',
      arguments: {}
    })

    return {
      totalActions: actions.length,
      completedActions: results.filter(r => r.success).length,
      failedActions: results.filter(r => !r.success).length,
      stoppedReason,
      results,
      finalUrl: finalUrlResult.data?.url
    }
  }

  /**
   * 简单的单动作 browser_ai 执行（降级方案）
   */
  private async executeSimpleBrowserAI(
    toolCall: ToolCall,
    instruction: string,
    startTime: number,
    context?: any
  ): Promise<ToolResult> {
    const parseResult = await this.browserAIParser!.parseInstruction(instruction, context)

    if (!parseResult.success || !parseResult.action) {
      return {
        toolCallId: toolCall.id,
        success: false,
        error: `Failed to parse instruction: ${parseResult.error}`,
        executionTime: Date.now() - startTime
      }
    }

    const actionToolCall: ToolCall = {
      ...toolCall,
      name: 'browser_ai_execute',
      arguments: {
        action: parseResult.action,
        originalInstruction: instruction
      }
    }

    return this.executeLocalTool(actionToolCall)
  }

  /**
   * 获取页面上下文（DOM 信息）
   */
  private async getPageContext(): Promise<{ success: boolean; context?: any }> {
    console.log('[ToolBridge] Requesting page context from client...')
    try {
      const toolCallId = this.generateId()
      console.log(`[ToolBridge] Generated tool call ID: ${toolCallId}`)

      const result = await this.executeLocalTool({
        id: toolCallId,
        name: 'browser_get_context',
        arguments: {}
      })

      console.log(`[ToolBridge] Page context result:`, {
        success: result.success,
        hasData: !!result.data,
        dataType: result.data ? typeof result.data : 'none',
        elementCount: result.data?.elements?.length || 0
      })

      if (result.success && result.data) {
        return { success: true, context: result.data }
      }
      return { success: false }
    } catch (error) {
      console.error('[ToolBridge] Failed to get page context:', error)
      return { success: false }
    }
  }

  /**
   * 根据工具类型获取超时时间
   */
  private getToolTimeout(toolName: string): number {
    const timeouts: Record<string, number> = {
      'browser': 60000,           // 浏览器操作60s
      'browser_ai': 90000,        // AI浏览器操作90s（包含语义解析时间）
      'browser_ai_execute': 60000,
      'browser_get_context': 30000,
      'bash': 30000,              // 命令行30s
      'file_read': 5000,          // 文件读取5s
      'file_write': 5000          // 文件写入5s
    }
    return timeouts[toolName] || 30000
  }

  /**
   * 执行本地工具（通过 WebSocket 发送到客户端）
   */
  private async executeLocalTool(toolCall: ToolCall): Promise<ToolResult> {
    if (!this.wsClient || !this.wsClient.isAlive) {
      return {
        toolCallId: toolCall.id,
        success: false,
        error: 'Client offline, cannot execute local tool',
        executionTime: 0
      }
    }

    const startTime = Date.now()
    // 使用 toolCall.id 作为 requestId，以便客户端返回时能正确匹配
    const requestId = toolCall.id

    // 根据工具类型获取超时时间
    const timeout = this.getToolTimeout(toolCall.name)

    try {
      // 发送工具执行请求到客户端
      const response = await this.sendWebSocketRequest(requestId, {
        toolCall,
        timeout
      })

      return {
        toolCallId: toolCall.id,
        success: response.success,
        data: response.data,
        error: response.error,
        executionTime: Date.now() - startTime,
        metadata: response.metadata
      }
    } catch (error) {
      return {
        toolCallId: toolCall.id,
        success: false,
        error: error instanceof Error ? error.message : 'Tool execution failed',
        executionTime: Date.now() - startTime
      }
    }
  }

  /**
   * 执行远程工具（在后端直接执行）
   */
  private async executeRemoteTool(toolCall: ToolCall): Promise<ToolResult> {
    const startTime = Date.now()

    try {
      let result: any

      switch (toolCall.name) {
        case 'http_request':
          result = await this.executeHttpRequest(toolCall.arguments)
          break
        case 'search_api':
          result = await this.executeSearch(toolCall.arguments)
          break
        case 'weather':
          result = await this.executeWeatherQuery(toolCall.arguments)
          break
        default:
          throw new Error(`Remote tool ${toolCall.name} not implemented`)
      }

      return {
        toolCallId: toolCall.id,
        success: true,
        data: result,
        executionTime: Date.now() - startTime
      }
    } catch (error) {
      return {
        toolCallId: toolCall.id,
        success: false,
        error: error instanceof Error ? error.message : 'Remote tool execution failed',
        executionTime: Date.now() - startTime
      }
    }
  }

  /**
   * 通过 WebSocket 发送请求并等待响应
   */
  private async sendWebSocketRequest(
    requestId: string,
    request: ToolExecuteRequest
  ): Promise<ToolExecuteResponse> {
    return new Promise((resolve, reject) => {
      // 设置超时
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error('Tool execution timeout'))
      }, request.timeout)

      // 存储 pending 请求
      this.pendingRequests.set(requestId, {
        resolve: (result: ToolResult) => {
          clearTimeout(timeoutId)
          resolve({
            success: result.success,
            data: result.data,
            error: result.error,
            executionTime: result.executionTime,
            metadata: result.metadata
          })
        },
        reject: (error: Error) => {
          clearTimeout(timeoutId)
          reject(error)
        }
      })

      // 发送请求到客户端
      this.wsClient?.socket.send(JSON.stringify({
        type: 'tool.execute',
        messageId: requestId,
        timestamp: Date.now(),
        sessionId: this.sessionId,
        payload: {
          toolCall: request.toolCall,
          timeout: request.timeout
        }
      }))
    })
  }

  /**
   * 处理客户端返回的工具执行结果
   */
  handleToolResult(requestId: string, result: ToolResult): void {
    const pending = this.pendingRequests.get(requestId)
    if (pending) {
      pending.resolve(result)
      this.pendingRequests.delete(requestId)
    }
  }

  /**
   * 处理客户端返回的工具执行错误
   */
  handleToolError(requestId: string, error: string): void {
    const pending = this.pendingRequests.get(requestId)
    if (pending) {
      pending.reject(new Error(error))
      this.pendingRequests.delete(requestId)
    }
  }

  /**
   * 清理所有 pending 请求
   */
  cleanup(): void {
    console.log(`[ToolBridge ${this.sessionId}] Cleaning up ${this.pendingRequests.size} pending requests`)

    // 拒绝所有挂起的请求
    for (const [requestId, pending] of this.pendingRequests) {
      pending.reject(new Error('Session closed, tool execution cancelled'))
    }
    this.pendingRequests.clear()

    // 解绑 WebSocket
    this.wsClient = null
  }

  // ==================== 远程工具实现 ====================

  private async executeHttpRequest(args: any): Promise<any> {
    const { url, method = 'GET', headers = {}, body } = args

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    })

    const contentType = response.headers.get('content-type')
    let data: any

    if (contentType?.includes('application/json')) {
      data = await response.json()
    } else {
      data = await response.text()
    }

    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      data
    }
  }

  private async executeSearch(args: any): Promise<any> {
    // 集成搜索引擎 API（如 SerpAPI、Bing Search）
    const { query } = args

    // TODO: 实现实际的搜索 API 调用
    return {
      query,
      results: [],
      note: 'Search API not configured'
    }
  }

  private async executeWeatherQuery(args: any): Promise<any> {
    // 集成天气 API
    const { location } = args

    // TODO: 实现实际的天气 API 调用
    return {
      location,
      temperature: null,
      note: 'Weather API not configured'
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}
