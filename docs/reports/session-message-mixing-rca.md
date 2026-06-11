# 会话消息串扰问题 - 根因分析报告

## 问题描述

用户报告：只有两个会话，切换会话后，消息串会话了，之前的会话消息为 0。

## 时间线分析

从日志中提取的关键事件序列：

```
[15:31:11.199] 用户 desktop-user 认证成功，注册 2 个会话
[15:31:11.791] 收到 session.create，复用会话 1781160458576-7faphyfav
[15:31:25.776] 收到 agent.run
[15:31:25.776] SessionManager 复用会话: 1781160458576-7faphyfav  ← 服务器选择的会话
[15:31:25.782] EventBus 绑定 AgentLoop: 1781150258321-nfdiehh6a  ← 实际绑定的会话（错误！）
[15:31:25.782] AgentLoop 会话ID: 1781160458576-7faphyfav
[15:31:30.xxx] 所有 stream_chunk 事件发送到: 1781150258321-nfdiehh6a
```

## 根因分析

### 核心问题：AgentLoop 绑定到了错误的会话 ID

在 `apps/server/src/websocket/server.ts` 的 `handleAgentRun` 方法中：

```typescript
private async handleAgentRun(connection: WSConnection, message: WSMessage): Promise<void> {
  const sessionId = message.sessionId || message.payload?.sessionId  // ← 使用消息中的 sessionId
  // ...
  const { agentLoop, session } = await this.sessionManager.getOrCreateSession(connection.userId, sessionId)
  // ...
  // 绑定 AgentLoop 事件到事件总线
  if (sessionId) {
    this.eventBus.bindAgentLoop(agentLoop, sessionId)  // ← 用消息中的 sessionId 绑定
  }
}
```

**问题**：`getOrCreateSession` 返回的 `agentLoop` 实际属于会话 `1781160458576-7faphyfav`，但 `bindAgentLoop` 却使用消息中的 `sessionId` (`1781150258321-nfdiehh6a`) 进行绑定。

### 深层原因：前端当前会话与服务器最新会话不一致

1. **初始化阶段** (`loadSessions`):
   - 前端调用 `fetchAndSyncSessions()` 获取会话列表
   - 服务器返回按时间排序的会话，第一个是 `1781160458576-7faphyfav`（最新）
   - 前端设置 `currentSessionId = firstSession.id`

2. **创建新会话阶段** (`createNewSession`):
   - 前端通过 HTTP 创建新会话，得到 `1781150258321-nfdiehh6a`
   - 前端设置 `currentSessionId = 1781150258321-nfdiehh6a`
   - 前端发送 `session.create` WebSocket 消息，携带 `sessionId: 1781150258321-nfdiehh6a`

3. **发送消息阶段**:
   - 前端发送 `agent.run`，携带 `sessionId: 1781150258321-nfdiehh6a`（当前会话）
   - 服务器 `getOrCreateSession` 发现没有该会话的 AgentLoop，检查用户最新会话
   - 服务器返回 `1781160458576-7faphyfav`（数据库中该用户最新会话）
   - 但 `bindAgentLoop` 仍用消息中的 `1781150258321-nfdiehh6a` 绑定

### 根本原因：`getOrCreateSession` 逻辑缺陷

在 `apps/server/src/services/agent/session.ts` 中：

```typescript
async getOrCreateSession(userId: string, sessionId?: string): Promise<{ session: Session; agentLoop: AgentLoop }> {
  if (sessionId) {
    const session = this.getSession(sessionId)
    const agentLoop = this.getAgentLoop(sessionId)
    if (session && agentLoop) {  // ← 如果 session 存在但 agentLoop 不存在，会返回 null
      return { session, agentLoop }
    }
  }

  // 没有指定 sessionId，或 session/agentLoop 不存在
  // 尝试获取用户最新的已有会话
  const userSessions = this.getUserSessions(userId)
  if (userSessions.length > 0) {
    const latestSession = userSessions[0]  // ← 返回数据库中最新的会话（可能不是请求的）
    // ...
    return { session: latestSession, agentLoop }
  }
  // ...
}
```

**问题**：当请求一个不存在的 sessionId 时，服务器静默返回另一个会话，而不是报错或创建新会话。

### 触发条件

1. 用户有多个会话
2. HTTP 创建的会话和 WebSocket 使用的会话 ID 不一致
3. `getOrCreateSession` 找不到请求的会话时，返回数据库中最新的会话
4. `bindAgentLoop` 使用消息中的 sessionId 而不是实际 AgentLoop 的 sessionId

## 影响分析

1. **消息显示错误**：用户在一个会话发送消息，但回复显示在另一个会话
2. **消息丢失**：切换会话后，原会话显示消息数为 0（因为 stream 事件发送到错误的会话 ID）
3. **数据不一致**：前端显示的消息与后端存储的消息不匹配

## 修复建议

### 方案 1：修正 bindAgentLoop 调用（推荐）

使用 `session.id` 而不是 `message.sessionId` 来绑定 AgentLoop：

```typescript
// apps/server/src/websocket/server.ts:handleAgentRun
const { agentLoop, session } = await this.sessionManager.getOrCreateSession(connection.userId, sessionId)

// 绑定 AgentLoop 事件到事件总线（使用实际的 session.id）
if (session) {
  this.eventBus.bindAgentLoop(agentLoop, session.id)  // ← 使用 session.id 而非 sessionId
}
```

### 方案 2：getOrCreateSession 严格模式

当请求的 sessionId 不存在时，抛出错误而不是返回其他会话：

```typescript
async getOrCreateSession(userId: string, sessionId?: string): Promise<{ session: Session; agentLoop: AgentLoop }> {
  if (sessionId) {
    const session = this.getSession(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    let agentLoop = this.getAgentLoop(sessionId)
    if (!agentLoop) {
      // 创建新的 AgentLoop 用于已有会话
      agentLoop = new AgentLoop(session.id, userId, { ... })
      // ...
    }
    return { session, agentLoop }
  }
  // ...
}
```

### 方案 3：会话同步机制

在切换会话时，前端明确通知服务器当前活动会话：

1. 添加 `session.switch` WebSocket 消息类型
2. 服务器维护 `userId -> currentSessionId` 映射
3. 确保事件发送到正确的会话

## 验证步骤

1. 创建两个会话
2. 在第一个会话发送消息
3. 切换到第二个会话
4. 在第二个会话发送消息
5. 验证：
   - 每个会话只显示自己的消息
   - 消息计数正确
   - stream 事件发送到正确的会话

## 相关代码文件

- `apps/server/src/websocket/server.ts` - WebSocket 消息处理
- `apps/server/src/services/agent/session.ts` - 会话管理
- `apps/server/src/websocket/event-bus.ts` - 事件总线
- `apps/client/src/main/core/session-manager.ts` - 前端会话管理
- `apps/client/src/renderer/src/App.tsx` - 前端会话切换逻辑

## 变更记录

| 日期 | 作者 | 变更内容 |
|------|------|----------|
| 2025-06-11 | Claude | 创建根因分析报告 |
