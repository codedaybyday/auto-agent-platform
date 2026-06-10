# 多会话管理设计方案

## 当前问题分析

1. **前端**：使用本地 Map 缓存会话消息，刷新页面丢失
2. **后端**：SessionManager 管理会话，但消息历史未持久化
3. **通信**：WebSocket 协议支持会话操作，但前后端未完全打通

## 设计方案

### 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         前端 (Electron)                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Sidebar    │  │ SessionPanel │  │     ChatInterface    │  │
│  │  (导航切换)   │  │ (会话列表管理) │  │    (消息展示/发送)    │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                              │                                   │
│  ┌───────────────────────────┼──────────────────────────────┐  │
│  │                      App.tsx                             │  │
│  │  - currentSessionId: 当前活跃会话ID                       │  │
│  │  - sessions: 会话列表（从服务端同步）                      │  │
│  │  - messages: 当前显示的消息（从服务端获取）               │  │
│  └───────────────────────────┼──────────────────────────────┘  │
│                              │                                   │
│  ┌───────────────────────────┼──────────────────────────────┐  │
│  │                   IPC Main Process                       │  │
│  │                                                          │  │
│  │  HTTP Client (短连接)        WebSocket Client (长连接)    │  │
│  │  ├─ GET /api/sessions        ├─ 连接管理                  │  │
│  │  ├─ POST /api/sessions       ├─ 发送消息                  │  │
│  │  ├─ DELETE /api/sessions/:id ├─ 接收流式响应              │  │
│  │  ├─ PATCH /api/sessions/:id  ├─ 工具调用                  │  │
│  │  └─ GET /api/sessions/:id/   └─ 心跳保活                  │  │
│  │       /messages                                          │  │
│  └───────────────────────────┼──────────────────────────────┘  │
└──────────────────────────────┼─────────────────────────────────┘
          │                    │
          │ HTTP               │ WebSocket
          │ (短连接)            │ (长连接)
          ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                         后端 (Node.js)                           │
│  ┌──────────────────────┐      ┌─────────────────────────────┐  │
│  │   HTTP API           │      │   WebSocket Gateway         │  │
│  │   (Express Router)   │      │   (ws library)              │  │
│  │                      │      │                             │  │
│  │ GET  /api/sessions   │      │ 事件: agent.run             │  │
│  │ POST /api/sessions   │      │ 事件: stream.chunk          │  │
│  │ DELETE /api/...      │      │ 事件: tool.execute          │  │
│  │ PATCH /api/...       │      │ 事件: tool.result           │  │
│  │ GET /api/.../messages│      │                             │  │
│  └──────────┬───────────┘      └─────────────┬───────────────┘  │
│             │                                │                  │
│             └────────────────┬───────────────┘                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   SessionManager                         │   │
│  │  - localSessions: Map<sessionId, AgentLoop>             │   │
│  │  - sessionMetadata: Map<sessionId, Session>             │   │
│  │  - userSessions: Map<userId, Set<sessionId>>            │   │
│  └───────────────────────────┬─────────────────────────────┘   │
│                              │                                   │
│  ┌───────────────────────────┼──────────────────────────────┐   │
│  │                    AgentLoop                             │   │
│  │  - state.messages: 消息历史（内存存储）                   │   │
│  │  - 多轮对话上下文管理                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 核心流程

### 1. 创建会话
```
前端: 点击"新建" → IPC createSession → HTTP POST /api/sessions
后端: 创建 Session + AgentLoop → 返回 session 数据
前端: 添加到会话列表 → 切换到新会话 → 清空消息区域
```

### 2. 获取会话列表
```
前端: IPC getSessions → HTTP GET /api/sessions
后端: 返回用户所有会话元数据
前端: 更新 SessionPanel 列表
```

### 3. 切换会话
```
前端:
  1. IPC switchSession → 仅更新本地状态（不通知后端）
  2. HTTP GET /api/sessions/:id/messages 获取最新历史
  3. 显示消息（服务端是唯一直实数据源）
```

**注意**：当前版本不使用前端缓存，每次切换都从服务端获取，保证数据一致性。缓存优化后期考虑。

### 4. 获取消息历史（新增）
```
前端: IPC getSessionMessages(sessionId) → WebSocket session.messages.get
后端: 返回 AgentLoop.state.messages
前端: 更新消息列表显示
```

### 5. 删除会话
```
前端: 点击删除 → IPC deleteSession → WebSocket session.delete
后端: 删除 Session + AgentLoop
前端: 从列表移除 → 如果当前会话被删 → 切换到其他会话或新建
```

### 6. 重命名会话
```
前端: 双击标题编辑 → IPC renameSession → WebSocket session.rename
后端: 更新 session.title
前端: 更新列表显示
```

## 数据模型

### Session (会话元数据)
```typescript
interface Session {
  id: string
  userId: string
  title: string
  status: 'active' | 'idle' | 'archived'
  createdAt: Date
  updatedAt: Date
  messageCount: number
  lastMessagePreview?: string
}
```

### Message (消息)
```typescript
interface Message {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  timestamp: number
}
```

## 通信协议规范

### HTTP API (短连接)

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/sessions` | 获取会话列表 |
| `POST` | `/api/sessions` | 创建新会话 |
| `DELETE` | `/api/sessions/:id` | 删除会话 |
| `PATCH` | `/api/sessions/:id` | 重命名会话 |
| `GET` | `/api/sessions/:id/messages` | 获取会话消息历史 |
| `POST` | `/api/sessions/:id/chat` | 发送消息（非流式）|

### WebSocket 消息类型 (长连接)

| 类型 | 方向 | 说明 |
|------|------|------|
| `connect` | C→S | 连接认证 |
| `connect_ack` | S→C | 认证成功 |
| `agent.run` | C→S | 发送消息并启动 Agent |
| `stream.chunk` | S→C | 流式响应数据块 |
| `stream.complete` | S→C | 流式响应完成 |
| `stream.error` | S→C | 流式响应错误 |
| `state.update` | S→C | 状态更新（工具执行等）|
| `tool.execute` | S→C | 请求客户端执行工具 |
| `tool.result` | C→S | 工具执行结果 |

### 协议选择原则

| 场景 | 协议 | 原因 |
|------|------|------|
| 会话 CRUD | HTTP | 请求-响应模式，无实时性要求 |
| 消息历史获取 | HTTP | 一次性查询 |
| 发送消息 | WebSocket | 需要流式接收 AI 回复 |
| 工具执行 | WebSocket | 需要双向通信（后端请求客户端执行）|

## 状态管理策略

### 数据源原则
**服务端是唯一直实数据源**，前端不维护长期缓存，每次操作后重新获取数据。

### 前端状态
- `sessions`: 会话列表（从服务端获取）
- `currentSessionId`: 当前活跃会话ID（本地 UI 状态）
- `messages`: 当前显示的消息（从服务端获取）

### 后端状态
- `SessionManager.localSessions`: 活跃会话实例
- `SessionManager.sessionMetadata`: 会话元数据
- `AgentLoop.state.messages`: 各会话的消息历史

### 数据流
1. **初始化**: 前端启动时获取完整会话列表
2. **创建/删除/重命名**: 操作成功后重新加载会话列表
3. **切换会话**: 立即从服务端获取该会话的最新消息
4. **发送消息**: WebSocket 流式响应，实时更新 UI

### 关于缓存（未来考虑）
当前版本不使用前端缓存，简化数据一致性逻辑。后续如需优化可考虑：
- 乐观更新（发送消息后立即显示在 UI）
- 离线缓存（PWA 场景）
- 消息分页加载（单会话消息量大时）

## 实现优先级与状态

### 已完成 ✓
- [x] HTTP API 获取会话列表 (`GET /api/sessions`)
- [x] HTTP API 删除会话 (`DELETE /api/sessions/:id`)
- [x] HTTP API 获取消息历史 (`GET /api/sessions/:id/messages`)
- [x] WebSocket 消息流 (`agent.run`, `stream.chunk`)
- [x] `createSession` 改为 HTTP POST
- [x] 修复切换会话消息加载竞态条件
- [x] 消息添加 `sessionId` 字段

### 待实现
- [ ] **P0**: 后端用户维度消息推送（详见 [session-message-sync.md](./session-message-sync.md)）
- [ ] **P0**: 前端消息去重合并 (`mergeMessages`)
- [ ] **P0**: 前端未读消息计数和展示
- [ ] **P1**: `renameSession` 后端 API（当前仅本地缓存）
- [ ] **P3**: 持久化存储（PostgreSQL）

## 相关文档

- [前端会话管理交互流程](./frontend-session-interaction.md) - 前端交互细节
- [多会话消息同步方案](./session-message-sync.md) - 跨会话消息推送设计
