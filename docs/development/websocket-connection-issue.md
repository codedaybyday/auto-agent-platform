# WebSocket 连接失败问题分析

## 问题现象

Electron 客户端连接服务端后，调用 `agent:init` 初始化会话时：
1. 客户端发送 `session.create` 消息
2. 服务端立即关闭连接，提示 `Not authenticated`
3. 客户端超时后报错 `No active session`

## 根本原因

服务端 `handleAuth` 函数在认证完成后，创建了新连接对象但没有更新原始的 `tempConnection` 引用，导致后续消息处理时无法识别已认证状态。

### 代码问题位置

```typescript
// apps/server/src/websocket/server.ts
private handleAuth(tempConnection: Partial<WSConnection>, message: WSMessage): void {
  // ... 认证逻辑 ...
  
  const conn: WSConnection = {
    id: connectionId,
    userId,
    socket: tempConnection.socket!,
    // ...
  }
  
  // ❌ 错误：只是将 conn 存入 Map，没有更新 tempConnection
  this.connections.set(connectionId, conn)
  
  // ✅ 修复：需要更新 tempConnection 使其持有 id
  Object.assign(tempConnection, conn)
}
```

## 消息处理流程

```
┌─────────────────────────────────────────────────────────────────┐
│                     正常流程（修复后）                            │
└─────────────────────────────────────────────────────────────────┘

  Client                              Server
    │                                    │
    │ ────────── WebSocket 连接 ─────────>│
    │                                    │
    │ ────── {type:"connect"...} ───────>│
    │                                    │
    │        ┌─────────────────┐         │
    │        │  handleAuth()   │         │
    │        │                 │         │
    │        │ 1. 创建 conn    │         │
    │        │ 2. 存入 Map     │         │
    │        │ 3. 更新 tempConn│◄── 新增  │
    │        └─────────────────┘         │
    │                                    │
    │ <────── {type:"connect_ack"} ──────│
    │                                    │
    │ ───── {type:"session.create"} ────>│
    │                                    │
    │        ┌─────────────────┐         │
    │        │ tempConn.id?    │         │
    │        │ ✅ 存在，已认证  │         │
    │        └─────────────────┘         │
    │                                    │
    │        ┌─────────────────┐         │
    │        │ handleMessage() │         │
    │        │                 │         │
    │        │ 处理业务消息     │         │
    │        └─────────────────┘         │
    │                                    │
    │ <─── {type:"session.create_ack"} ──│
    │                                    │
```

```
┌─────────────────────────────────────────────────────────────────┐
│                     异常流程（修复前）                            │
└─────────────────────────────────────────────────────────────────┘

  Client                              Server
    │                                    │
    │ ────────── WebSocket 连接 ─────────>│
    │                                    │
    │ ────── {type:"connect"...} ───────>│
    │                                    │
    │        ┌─────────────────┐         │
    │        │  handleAuth()   │         │
    │        │                 │         │
    │        │ 1. 创建 conn    │         │
    │        │ 2. 存入 Map     │         │
    │        │ ❌ 未更新 tempConn       │
    │        └─────────────────┘         │
    │                                    │
    │ <────── {type:"connect_ack"} ──────│
    │                                    │
    │ ───── {type:"session.create"} ────>│
    │                                    │
    │        ┌─────────────────┐         │
    │        │ tempConn.id?    │         │
    │        │ ❌ undefined    │         │
    │        │ 未认证！        │         │
    │        └─────────────────┘         │
    │                                    │
    │        ┌─────────────────┐         │
    │        │  close(4002)    │         │
    │        │ Not authenticated        │
    │        └─────────────────┘         │
    │                                    │
    │ <──────── 连接被关闭 ──────────────│
    │                                    │
```

## 修复方案

### 服务端修复

```typescript
private handleAuth(tempConnection: Partial<WSConnection>, message: WSMessage): void {
  const { userId } = message.payload || {}
  
  if (!userId) {
    tempConnection.socket!.close(4003, 'Missing userId')
    return
  }

  const connectionId = this.generateId()
  const conn: WSConnection = {
    id: connectionId,
    userId,
    socket: tempConnection.socket!,
    connectedAt: new Date(),
    lastPingAt: new Date(),
    isAlive: true,
    subscriptions: new Set()
  }

  // ✅ 关键修复：更新 tempConnection，使闭包中的引用也能获取到 id
  Object.assign(tempConnection, conn)

  this.connections.set(connectionId, conn)
  
  // 发送认证成功响应
  this.sendToConnection(connectionId, {
    type: 'connect_ack' as MessageType,
    messageId: this.generateId(),
    timestamp: Date.now(),
    payload: { connectionId, instanceId: this.instanceId }
  })
}
```

### 客户端优化

除服务端修复外，客户端也添加了以下优化：

1. **等待 `connect_ack` 后再 resolve**
   ```typescript
   pendingConnectResolve = () => {
     pendingConnectResolve = null
     resolve()
   }
   ```

2. **防止并发初始化**
   ```typescript
   let isInitializing = false
   let initPromise: Promise<...> | null = null
   
   if (isInitializing && initPromise) {
     return initPromise  // 复用已有 Promise
   }
   ```

3. **断开时清理状态**
   ```typescript
   ws.on('close', () => {
     if (pendingSessionResolve) {
       pendingSessionResolve = null
     }
     isInitializing = false
     initPromise = null
   })
   ```

## 关键教训

1. **闭包中的对象引用**：在 JavaScript 中，对象赋值是引用传递。当在闭包中捕获对象后，如果函数内部创建了新对象，必须更新原始对象引用，否则闭包中的引用仍然是旧的。

2. **认证状态传递**：WebSocket 认证流程中，需要确保认证后的状态能被后续的消息处理器正确识别。

3. **防御性编程**：对于这种生命周期管理，应该：
   - 添加足够的日志记录
   - 使用不可变的方式管理状态
   - 考虑使用 Map/Set 等数据结构而不是对象引用

## 相关文件

- `apps/server/src/websocket/server.ts` - WebSocket 服务端
- `apps/client/src/main/index.ts` - Electron 主进程
