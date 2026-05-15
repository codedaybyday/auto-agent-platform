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
│  │  - sessionMessages: 各会话消息缓存(Map)                   │  │
│  └───────────────────────────┼──────────────────────────────┘  │
│                              │                                   │
│  ┌───────────────────────────┼──────────────────────────────┐  │
│  │                   IPC Main Process                       │  │
│  │  - 维护 WebSocket 连接                                   │  │
│  │  - 转发前后端消息                                        │  │
│  │  - 本地会话列表缓存（断网时可用）                           │  │
│  └───────────────────────────┼──────────────────────────────┘  │
└──────────────────────────────┼─────────────────────────────────┘
                               │ WebSocket
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                         后端 (Node.js)                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                 WebSocket Gateway                        │   │
│  │  - 处理 session.create/list/switch/delete/rename        │   │
│  │  - 管理客户端连接和订阅                                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│  ┌───────────────────────────┼──────────────────────────────┐   │
│  │                   SessionManager                         │   │
│  │  - localSessions: Map<sessionId, AgentLoop>             │   │
│  │  - sessionMetadata: Map<sessionId, Session>             │   │
│  │  - userSessions: Map<userId, Set<sessionId>>            │   │
│  └───────────────────────────┼──────────────────────────────┘   │
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
前端: 点击"新建" → IPC createSession → WebSocket session.create
后端: 创建 Session + AgentLoop → 返回 session.create_ack
前端: 添加到会话列表 → 切换到新会话 → 清空消息区域
```

### 2. 获取会话列表
```
前端: IPC getSessions → WebSocket session.list
后端: 返回用户所有会话元数据
前端: 更新 SessionPanel 列表
```

### 3. 切换会话
```
前端: 
  1. 保存当前会话消息到缓存
  2. IPC switchSession → WebSocket (通知后端)
  3. 从缓存加载目标会话消息
  4. 如果没有缓存 → 请求消息历史
```

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

## WebSocket 消息类型

| 类型 | 方向 | 说明 |
|------|------|------|
| `session.create` | C→S | 创建新会话 |
| `session.create_ack` | S→C | 会话创建成功 |
| `session.list` | C→S | 获取会话列表 |
| `state.sync` | S→C | 返回会话列表 |
| `session.switch` | C→S | 切换当前会话 |
| `session.messages.get` | C→S | 获取会话消息历史 |
| `session.messages.sync` | S→C | 返回消息历史 |
| `session.delete` | C→S | 删除会话 |
| `session.delete_ack` | S→C | 删除成功 |
| `session.rename` | C→S | 重命名会话 |
| `session.rename_ack` | S→C | 重命名成功 |

## 状态同步策略

### 前端状态
- `sessions`: 从服务端同步的会话列表
- `currentSessionId`: 当前活跃会话ID
- `sessionMessagesCache`: Map<sessionId, Message[]>

### 后端状态
- `SessionManager.localSessions`: 活跃会话实例
- `SessionManager.sessionMetadata`: 会话元数据
- `AgentLoop.state.messages`: 各会话的消息历史

### 同步时机
1. **初始化**: 前端启动时获取完整会话列表
2. **创建/删除/重命名**: 操作成功后广播更新
3. **切换会话**: 懒加载消息历史（首次切换时获取）
4. **定时同步**: 可选，用于多设备同步

## 实现优先级

1. **P0**: 基础会话管理（创建/列表/切换）
2. **P1**: 消息历史获取（解决切换丢失问题）
3. **P2**: 删除/重命名功能
4. **P3**: 持久化存储（PostgreSQL）
