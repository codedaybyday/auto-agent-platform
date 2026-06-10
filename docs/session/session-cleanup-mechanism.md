# 会话关闭时工具进程清理机制

## 问题背景

之前的实现存在的问题：
- 服务端关闭会话时，只修改了 AgentLoop 状态，没有清理 ToolBridge 的 pending 请求
- 服务端没有通知客户端清理本地工具资源
- 客户端的 bash session 和浏览器进程可能残留

## 解决方案

实现了双向清理机制：

```
┌─────────────────┐     TOOL_CLEANUP      ┌─────────────────┐
│  Server         │ ─────────────────────> │  Client         │
│  (AgentLoop)    │                        │  (Bash/Browser) │
│                 │                        │                 │
│  1. cleanup()   │                        │  1. 接收消息    │
│  2. 清理pending │                        │  2. 销毁session │
│  3. 发送通知    │                        │  3. 关闭浏览器  │
└─────────────────┘                        └─────────────────┘
```

## 代码实现

### 1. 服务端 - ToolBridge
```typescript
// 清理所有 pending 请求
cleanup(): void {
  for (const [requestId, pending] of this.pendingRequests) {
    pending.reject(new Error('Session closed, tool execution cancelled'))
  }
  this.pendingRequests.clear()
  this.wsClient = null
}
```

### 2. 服务端 - AgentLoop
```typescript
async cleanup(): Promise<void> {
  // 1. 停止循环
  this.stop()
  
  // 2. 清理 ToolBridge
  this.toolBridge.cleanup()
  
  // 3. 通知客户端
  await this.notifyClientCleanup()
  
  // 4. 移除监听器
  this.removeAllListeners()
}

private async notifyClientCleanup(): Promise<void> {
  const cleanupMessage = {
    type: 'tool.cleanup',
    sessionId: this.state.sessionId,
    payload: { reason: 'session_closed' }
  }
  this.wsClient.socket?.send(JSON.stringify(cleanupMessage))
}
```

### 3. 服务端 - SessionManager
```typescript
async deleteSession(sessionId: string): Promise<void> {
  const agentLoop = this.localSessions.get(sessionId)
  if (agentLoop) {
    await agentLoop.cleanup()  // 调用 cleanup 而不是 stop
  }
  // ... 其他清理
}
```

### 4. 客户端 - 接收清理消息
```typescript
case 'tool.cleanup':
  console.log('[Main] Server requested tool cleanup')
  await cleanupSessionTools(message.sessionId)
  break
```

### 5. 客户端 - 执行清理
```typescript
async function cleanupSessionTools(sessionId: string): Promise<void> {
  // 1. 销毁 bash session
  sessionManager.destroy(sessionId)
  
  // 2. 关闭浏览器
  await browserTool.close()
  
  // 3. 清理进程注册表
  processRegistry.cleanupSession(sessionId)
}
```

### 6. 客户端 - 应用关闭时清理
```typescript
app.on('before-quit', async () => {
  // 清理所有 shell 会话
  sessionManager.destroyAll()
})
```

## 消息类型

新增 `TOOL_CLEANUP` 消息类型：
```typescript
export enum MessageType {
  // ... 其他类型
  TOOL_CLEANUP = 'tool.cleanup',  // 服务端 -> 客户端：清理工具资源
}
```

## 日志输出

服务端日志：
```
[AgentLoop session-xxx] Starting cleanup...
[AgentLoop session-xxx] Notifying client to cleanup tools
[AgentLoop session-xxx] Cleanup notification sent to client
[AgentLoop session-xxx] Cleanup completed
```

客户端日志：
```
[Main] Server requested tool cleanup for session: session-xxx
[Main] Bash session session-xxx destroyed
[Main] Browser closed for session session-xxx
[Main] Process registry cleaned for session session-xxx
[Main] Tools cleanup completed for session: session-xxx
```

## 测试验证

测试场景：
1. 创建一个会话并执行长时间运行的命令
2. 关闭会话或删除会话
3. 验证：
   - 服务端日志显示 cleanup 流程
   - 客户端日志显示收到清理消息
   - bash 进程被终止（`ps aux | grep bash`）
   - 浏览器进程被关闭

## 边界情况处理

- **WebSocket 未绑定**：如果 cleanup 时 WebSocket 未绑定，跳过通知，仅清理服务端资源
- **客户端已离线**：服务端发送消息可能失败，记录错误但不影响清理流程
- **重复清理**：多次调用 cleanup 是幂等的，pending 请求只会被清理一次
