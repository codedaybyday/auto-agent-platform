# 多会话消息同步方案

## 背景

用户场景：
1. 在会话1提问，切换到会话2等待
2. 会话1的回复到达时，需要感知（未读标记）
3. 切回会话1时，消息要完整显示且不重复

## 架构设计

### 消息推送模型（中央事件总线）

```
┌─────────────────────────────────────────────────────────────────┐
│                         后端 (Event Bus + WebSocket Gateway)      │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  中央事件总线（程序启动时初始化，全局唯一）                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 接收所有 AgentLoop 的事件                                 │   │
│  │                                                         │   │
│  │  AgentLoop(1) ──┐                                       │   │
│  │  AgentLoop(2) ──┼──▶ 总线接收事件 ──▶ 路由层            │   │
│  │  AgentLoop(3) ──┘                    (session→user→conn)│   │
│  │                                                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                    │
│                              ▼                                    │
│  路由表（新建会话时注册，记录映射关系）                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ sessionUserMap: Map<sessionId, userId>                  │   │
│  │   - 会话1 → 用户A                                       │   │
│  │   - 会话2 → 用户A                                       │   │
│  │   - 会话3 → 用户B                                       │   │
│  │                                                         │   │
│  │ userConnections: Map<userId, Set<connectionId>>         │   │
│  │   - 用户A: [conn-001, conn-002]  (多设备在线)            │   │
│  │   - 用户B: [conn-003]                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                    │
│                              ▼                                    │
│  WebSocket Gateway（推送层）                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 根据路由表找到目标用户的所有连接，推送消息                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 关键设计决策

| 设计点 | 方案 | 原因 |
|--------|------|------|
| 事件总线 | 中央总线模式 | 程序启动时初始化，统一管理所有会话事件 |
| 订阅粒度 | 用户维度 | 用户只接收自己会话的消息，隔离其他用户 |
| 推送范围 | 该用户的所有连接 | 支持多设备同步 |
| 会话注册 | 新建时注册到路由表 | 不是绑定监听器，而是记录 session→user 映射 |
| 未读管理 | 前端维护 | 减少后端状态复杂度 |
| 消息去重 | 前端按 messageId 去重 | 兼顾实时推送和完整拉取 |

## 数据流

### 场景：跨会话消息接收

```
1. 用户在会话1提问
   前端 ──WebSocket──▶ 后端: agent.run(sessionId=1)
   后端: 总线已初始化，会话1已注册到路由表

2. 用户切换到会话2
   前端 ──HTTP──▶ 后端: GET /api/sessions/2/messages
   前端: 显示会话2的消息

3. 会话1的回复到达（用户在会话2页面）
   LLM ──▶ AgentLoop(1) ──事件──▶ 中央事件总线
   总线: 查路由表 session1 → userA
   总线 ──▶ WebSocket Gateway: 推送给 userA 的所有连接
   Gateway ──▶ 用户A的所有连接: stream.chunk(sessionId=1)

4. 前端处理（当前显示会话2）
   收到消息: {sessionId: 1, content: "..."}
   判断: sessionId !== currentSessionId(2)
   动作: 会话1的未读计数+1，显示红点

5. 用户点击会话1
   前端: 清零未读计数
   前端 ──HTTP──▶ 后端: GET /api/sessions/1/messages
   后端: 返回完整消息列表（包含刚收到的回复）
   前端: 使用 mergeMessages 去重合并
```

## 前端实现

### 1. 消息去重合并

```typescript
interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  sessionId?: string
}

/**
 * 合并消息列表，按 messageId 去重
 * 用于 WebSocket 实时消息和 HTTP 拉取消息合并
 */
const mergeMessages = (existing: Message[], incoming: Message[]): Message[] => {
  const messageMap = new Map<string, Message>()
  
  // 先放入已有消息（WebSocket 实时接收的）
  existing.forEach(msg => messageMap.set(msg.id, msg))
  
  // 再放入新消息（HTTP 拉取的），相同 id 会覆盖
  incoming.forEach(msg => messageMap.set(msg.id, msg))
  
  // 按时间排序返回
  return Array.from(messageMap.values()).sort((a, b) => a.timestamp - b.timestamp)
}
```

### 2. 消息处理逻辑

```typescript
const handleMessage = (message: Message) => {
  // 验证消息归属
  if (message.sessionId !== currentSessionIdRef.current) {
    // 非当前会话：增加未读计数，不显示在聊天区
    incrementUnread(message.sessionId)
    return
  }
  
  // 当前会话：添加到消息列表
  setMessages(prev => [...prev, message])
}

const handleSwitchSession = async (sessionId: string) => {
  setCurrentSessionId(sessionId)
  clearUnread(sessionId)
  
  // HTTP 拉取完整消息历史
  const result = await window.api.agent.getSessionMessages(sessionId)
  if (result.success && result.messages) {
    // 使用 mergeMessages 合并（处理 WebSocket 已收到的消息）
    setMessages(prev => mergeMessages(prev, result.messages))
  }
}
```

### 3. 会话列表显示未读

```typescript
interface Session {
  id: string
  title: string
  updatedAt: number
  messageCount: number
  unreadCount: number  // 未读消息数
}

// SessionPanel.tsx 显示红点
{session.unreadCount > 0 && (
  <span className="unread-badge">{session.unreadCount}</span>
)}
```

## 后端实现

### 1. 中央事件总线（程序启动时初始化）

```typescript
class EventBus {
  // 会话 → 用户 的路由表（新建会话时注册）
  private sessionUserMap = new Map<string, string>()
  
  // 用户 → 连接 的映射
  private userConnections = new Map<string, Set<string>>()
  
  // WebSocket Gateway 引用（用于推送）
  private gateway: WebSocketGateway

  constructor(gateway: WebSocketGateway) {
    this.gateway = gateway
    this.setupGlobalListeners()
  }

  // 程序启动时设置全局监听
  private setupGlobalListeners() {
    // 方式1: 如果 AgentLoop 有全局事件总线
    globalAgentEventBus.on('stream_chunk', (event) => {
      this.handleAgentEvent(event)
    })
    
    // 方式2: 或者 AgentLoop 主动上报到 EventBus
    // 由 SessionManager 在创建 AgentLoop 时注入 EventBus
  }

  // 处理 AgentLoop 事件
  private handleAgentEvent(event: AgentEvent) {
    const { sessionId, type, data } = event
    
    // 查找该会话属于哪个用户
    const userId = this.sessionUserMap.get(sessionId)
    if (!userId) return
    
    // 通过 Gateway 推送给该用户的所有连接
    this.gateway.sendToUser(userId, {
      type,
      sessionId,
      payload: data
    })
  }

  // 注册会话到路由表（新建会话时调用）
  registerSession(sessionId: string, userId: string) {
    this.sessionUserMap.set(sessionId, userId)
  }

  // 注册用户连接（WebSocket 连接时调用）
  registerConnection(userId: string, connectionId: string) {
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set())
    }
    this.userConnections.get(userId)!.add(connectionId)
  }
}
```

### 2. WebSocket Gateway（推送层）

```typescript
class WebSocketGateway {
  private connections = new Map<string, WSConnection>()
  private eventBus: EventBus

  constructor(server: Server, sessionManager: SessionManager) {
    // 初始化事件总线
    this.eventBus = new EventBus(this)
    
    this.setupServer()
  }

  // 用户认证后，注册连接到事件总线
  private handleAuth(connection: WSConnection, userId: string) {
    // 注册用户的所有会话到事件总线
    const sessions = this.sessionManager.getUserSessions(userId)
    for (const session of sessions) {
      this.eventBus.registerSession(session.id, userId)
    }
    
    // 注册用户连接
    this.eventBus.registerConnection(userId, connection.id)
  }

  // 推送给用户的所有连接
  sendToUser(userId: string, message: WSMessage) {
    const connectionIds = this.eventBus.getUserConnections(userId)
    if (!connectionIds) return
    
    for (const connId of connectionIds) {
      this.sendToConnection(connId, message)
    }
  }

  private sendToConnection(connectionId: string, message: WSMessage) {
    const conn = this.connections.get(connectionId)
    if (conn && conn.socket.readyState === WebSocket.OPEN) {
      conn.socket.send(JSON.stringify(message))
    }
  }
}
```

### 3. 新建会话时注册到事件总线

```typescript
private async handleSessionCreate(connection: WSConnection, message: WSMessage): Promise<void> {
  const session = await this.sessionManager.createSession(connection.userId, message.payload?.title)
  
  // 【关键】注册会话到事件总线的路由表
  this.eventBus.registerSession(session.id, connection.userId)
  
  this.sendToConnection(connection.id, {
    type: 'session.create_ack',
    messageId: this.generateId(),
    timestamp: Date.now(),
    sessionId: session.id,
    payload: { session }
  })
}
```

## 消息格式

### WebSocket 推送消息

```typescript
// stream.chunk
{
  type: 'stream.chunk',
  messageId: '1684723412345-abc123',
  timestamp: 1684723412345,
  sessionId: 'session-001',  // 关键：标识消息归属
  payload: {
    content: '这是AI回复的内容...'
  }
}

// state.update (工具执行)
{
  type: 'state.update',
  messageId: '1684723412350-def456',
  timestamp: 1684723412350,
  sessionId: 'session-001',
  payload: {
    type: 'tool_start',
    toolCall: { id: '...', name: 'bash', input: {...} }
  }
}
```

## 待实现清单

- [ ] **后端**: 创建 `EventBus` 中央事件总线类
- [ ] **后端**: 修改 `WebSocketGateway`，集成 EventBus
- [ ] **后端**: 新建会话时调用 `eventBus.registerSession()` 注册到路由表
- [ ] **后端**: 用户连接时注册其所有会话到 EventBus
- [ ] **主进程**: 转发消息时携带 `sessionId`
- [ ] **前端**: 实现 `mergeMessages` 去重函数
- [ ] **前端**: 区分当前会话和非当前会话的消息处理
- [ ] **前端**: 添加 `unreadCount` 到 Session 类型和 UI
- [ ] **前端**: 切换会话时清零未读计数
