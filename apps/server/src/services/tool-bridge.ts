/**
 * Tool Bridge 服务
 * 工具代理层：判断工具在哪里执行并路由到正确的执行器
 */

import { ToolType, type ToolCall, type ToolResult, type WSConnection } from '../types/index.js'

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

export class ToolBridge {
  private sessionId: string
  private userId: string
  private wsClient: WSConnection | null = null
  private pendingRequests = new Map<string, { resolve: (value: ToolResult) => void; reject: (reason: Error) => void }>()

  constructor(sessionId: string, userId: string) {
    this.sessionId = sessionId
    this.userId = userId
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

    try {
      // 发送工具执行请求到客户端
      const response = await this.sendWebSocketRequest(requestId, {
        toolCall,
        timeout: 60000 // 60秒超时
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
