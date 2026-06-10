# 前端会话管理交互流程设计

## 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户交互层                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Sidebar    │  │ SessionPanel │  │     ChatInterface    │  │
│  │  (导航切换)   │  │ (会话列表管理) │  │    (消息展示/发送)    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
└─────────┼────────────────┼─────────────────────┼────────────────┘
          │                │                     │
          ▼                ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      App.tsx 状态管理层                           │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    核心状态                               │  │
│  │  - currentSessionId: string | null (当前活跃会话)          │  │
│  │  - sessions: Session[] (会话列表)                         │  │
│  │  - messages: Message[] (当前显示的消息)                    │  │
│  │  - sessionCache: Map<string, Message[]> (消息缓存)        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    交互处理器                              │  │
│  │  - handleCreateSession()                                 │  │
│  │  - handleSwitchSession()                                 │  │
│  │  - handleDeleteSession()                                 │  │
│  │  - handleRenameSession()                                 │  │
│  │  - handleSendMessage()                                   │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    IPC 通信层 (Main Process)                      │
│                                                                  │
│  渲染进程无法直接访问网络和系统资源，必须通过 IPC 与主进程通信     │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  HTTP 短连接 (会话管理)                                   │  │
│  │  ├─ getSessions()       GET  /api/sessions               │  │
│  │  ├─ createSession()     POST /api/sessions               │  │
│  │  ├─ deleteSession()     DELETE /api/sessions/:id         │  │
│  │  ├─ renameSession()     PATCH /api/sessions/:id          │  │
│  │  └─ getSessionMessages() GET /api/sessions/:id/messages  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  WebSocket 长连接 (实时通信)                              │  │
│  │  ├─ init()                  初始化连接                    │  │
│  │  ├─ sendMessage()           发送消息（流式响应）           │  │
│  │  ├─ onMessage()             接收 AI 回复                  │  │
│  │  ├─ onToolStart/End()       工具执行事件                  │  │
│  │  └─ onStreamChunk()         流式数据块                   │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                         后端服务器                               │
│                                                                  │
│  ┌──────────────────────┐      ┌─────────────────────────────┐ │
│  │   HTTP API           │      │   WebSocket Gateway         │ │
│  │   (Express Router)   │      │   (ws library)              │ │
│  └──────────────────────┘      └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## 通信协议规范

### 为什么会话管理使用 HTTP？

| 特性 | HTTP 短连接 | WebSocket 长连接 |
|------|-------------|------------------|
| 适用场景 | 请求-响应模式 | 双向实时通信 |
| 会话 CRUD | ✓ 适合（无实时性要求） | ✗  unnecessary |
| 流式消息 | ✗ 不适合 | ✓ 必须 |
| 工具调用 | ✗ 无法实现 | ✓ 需要双向通信 |
| 连接管理 | 简单（无状态） | 复杂（需保活） |

### 协议选择矩阵

| 操作 | 协议 | 端点 | 原因 |
|------|------|------|------|
| `getSessions` | HTTP | `GET /api/sessions` | 简单查询 |
| `createSession` | HTTP | `POST /api/sessions` | 创建资源 |
| `deleteSession` | HTTP | `DELETE /api/sessions/:id` | 删除资源 |
| `renameSession` | HTTP | `PATCH /api/sessions/:id` | 更新资源 |
| `getSessionMessages` | HTTP | `GET /api/sessions/:id/messages` | 获取历史 |
| `sendMessage` | WebSocket | `agent.run` | **流式响应必需** |
| `tool.execute` | WebSocket | `tool.execute` | **双向通信必需** |

## 交互流程详解

### 1. 创建会话流程

```
用户点击"新建"按钮
        │
        ▼
┌───────────────────┐
│ 1. 保存当前会话   │
│    消息到缓存     │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ 2. 显示 loading   │
│    按钮禁用       │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ IPC createSession │
│ 主进程 HTTP POST  │
│ /api/sessions     │
└─────────┬─────────┘
          │
      ┌───┴───┐
      │       │
    成功     失败
      │       │
      ▼       ▼
┌──────────┐ ┌────────────┐
│1.添加到  │ │显示错误提示│
│  列表    │ │按钮恢复   │
│2.设置当前│ └────────────┘
│  会话ID │
│3.清空UI │
│  消息   │
│4.清空缓存│
│  (新会话)│
└──────────┘
```

**为什么创建会话用 HTTP 而不是 WebSocket？**
- 创建会话是**一次性的资源创建操作**，不需要实时双向通信
- HTTP 有成熟的错误处理、重试机制
- 与 RESTful API 设计一致，便于理解和维护

**代码实现要点：**
```typescript
const handleCreateSession = async () => {
  setIsLoading(true)
  
  // 1. 保存当前会话消息到缓存
  if (currentSessionId) {
    saveToCache(currentSessionId, messages)
  }
  
  // 2. 调用后端创建
  const result = await window.api.agent.createSession()
  
  if (result.success) {
    // 3. 更新会话列表
    await loadSessions()
    
    // 4. 切换到新会话
    setCurrentSessionId(result.sessionId)
    setMessages([])
    
    // 5. 清空输入框
    clearInput()
  } else {
    showError(result.error)
  }
  
  setIsLoading(false)
}
```

---

### 2. 切换会话流程

```
用户点击会话项
        │
        ▼
┌───────────────────┐
│ 1. IPC switchSession
│    更新本地状态   │
│    currentSessionId
│    (不调用后端)   │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ 2. HTTP GET       │
│    /api/sessions/ │
│    :id/messages   │
│    (从服务端获取  │
│     最新数据)     │
└─────────┬─────────┘
          │
      ┌───┴───┐
      │       │
    成功     失败
      │       │
      ▼       ▼
┌──────────┐ ┌────────────┐
│显示消息  │ │显示空消息  │
│更新UI    │ │提示错误    │
└──────────┘ └────────────┘
```

**代码实现要点：**
```typescript
const handleSwitchSession = async (targetId: string) => {
  // 1. 立即更新当前会话ID（响应 UI）
  setCurrentSessionId(targetId)
  
  // 2. 从服务端获取最新消息（保证数据一致性）
  const result = await window.api.agent.getSessionMessages(targetId)
  
  if (result.success && result.messages) {
    // 3. 显示服务端返回的消息
    setMessages(result.messages)
  } else {
    // 4. 失败时显示空消息，提示用户
    setMessages([])
    showError('获取消息历史失败')
  }
  
  // 5. 滚动到底部
  scrollToBottom()
}
```

**设计原则：**
1. **服务端是唯一直实数据源**：切换会话时总是从服务端获取最新数据
2. **缓存后期考虑**：当前版本不使用前端缓存，简化逻辑，避免数据不一致
3. **失败降级**：获取失败时显示空消息，而不是显示可能过期的缓存数据

---

### 3. 删除会话流程

```
用户点击删除图标
        │
        ▼
┌───────────────────┐
│ 显示确认对话框    │
│ "确定删除此会话?" │
└─────────┬─────────┘
          │
     ┌────┴────┐
     │         │
    确认      取消
     │         │
     ▼         ▼
┌────────┐  ┌────────┐
│显示    │  │关闭    │
│loading │  │对话框  │
└───┬────┘  └────────┘
    │
    ▼
┌───────────────────┐
│ IPC deleteSession │
│ HTTP DELETE       │
│ /api/sessions/id  │
└─────────┬─────────┘
          │
      ┌───┴───┐
      │       │
    成功     失败
      │       │
      ▼       ▼
┌──────────┐ ┌────────┐
│1.从列表  │ │显示错误│
│  移除    │ └────────┘
│2.从缓存  │
│  移除    │
│3.如果是  │
│  当前会话│
│  →切换到 │
│   其他   │
└──────────┘
```

**代码实现要点：**
```typescript
const handleDeleteSession = async (sessionId: string) => {
  // 1. 确认对话框
  if (!confirm('确定要删除这个会话吗？')) return
  
  setIsDeleting(true)
  
  // 2. 调用后端删除
  const result = await window.api.agent.deleteSession(sessionId)
  
  if (result.success) {
    // 3. 从缓存删除
    sessionCache.delete(sessionId)
    
    // 4. 从列表移除
    setSessions(prev => prev.filter(s => s.id !== sessionId))
    
    // 5. 如果删除的是当前会话
    if (currentSessionId === sessionId) {
      setCurrentSessionId(null)
      setMessages([])
      
      // 6. 自动切换到第一个会话或新建
      const remaining = sessions.filter(s => s.id !== sessionId)
      if (remaining.length > 0) {
        await handleSwitchSession(remaining[0].id)
      }
    }
  } else {
    showError(result.error)
  }
  
  setIsDeleting(false)
}
```

---

### 4. 重命名会话流程

```
用户双击会话标题
        │
        ▼
┌───────────────────┐
│ 显示输入框        │
│ 聚焦 + 全选文字   │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ 用户输入新标题    │
└─────────┬─────────┘
          │
     ┌────┴────┐
     │         │
    Enter    ESC/Blur
     │         │
     ▼         ▼
┌────────┐  ┌────────┐
│保存    │  │取消    │
│新标题  │  │恢复原  │
│        │  │标题    │
└───┬────┘  └────────┘
    │
    ▼
┌───────────────────┐
│ IPC renameSession │
│ (本地更新 + 可选  │
│  HTTP API)        │
└─────────┬─────────┘
          │
      ┌───┴───┐
      │       │
    成功     失败
      │       │
      ▼       ▼
┌────────┐  ┌────────┐
│更新列表│  │恢复原  │
│显示    │  │标题    │
│新名称  │  │提示错误│
└────────┘  └────────┘
```

**代码实现要点：**
```typescript
const handleRenameSession = async (sessionId: string, newTitle: string) => {
  if (!newTitle.trim()) return
  
  // 1. 乐观更新 UI
  setSessions(prev => prev.map(s => 
    s.id === sessionId ? { ...s, title: newTitle } : s
  ))
  
  // 2. 调用后端
  const result = await window.api.agent.renameSession(sessionId, newTitle)
  
  if (!result.success) {
    // 3. 失败时恢复原标题
    showError(result.error)
    await loadSessions() // 重新加载
  }
}
```

---

### 5. 发送消息流程

```
用户输入消息并发送
        │
        ▼
┌───────────────────┐
│ 检查 currentSessionId │
└─────────┬─────────┘
          │
     ┌────┴────┐
     │         │
    有会话    无会话
     │         │
     ▼         ▼
┌────────┐  ┌─────────────┐
│继续    │  │提示"请先选择│
│        │  │或创建会话"  │
└───┬────┘  └─────────────┘
    │
    ▼
┌───────────────────┐
│ 1. 添加用户消息到 │
│    messages       │
│ 2. 同步到缓存     │
│ 3. 显示 loading   │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ IPC sendMessage   │
│ WebSocket 发送    │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ 监听 stream_chunk │
│ 实时更新 assistant│
│ 消息              │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ stream_complete   │
│ 或 stream_error   │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ 保存最终消息到    │
│ sessionCache      │
│ 取消 loading      │
└───────────────────┘
```

---

## 状态管理规范

### 状态更新顺序

1. **本地状态优先**：用户操作后立即更新 UI（乐观更新）
2. **API 调用**：异步请求后端
3. **错误回滚**：失败时恢复原状态
4. **缓存同步**：成功后更新缓存

### 状态更新策略

#### 基本流程

```typescript
// 所有数据从服务端获取，保证一致性
const loadSessions = async () => {
  const result = await window.api.agent.getSessions()
  if (result.success) {
    setSessions(result.sessions)
  }
}

const handleSwitchSession = async (sessionId: string) => {
  setCurrentSessionId(sessionId)
  const result = await window.api.agent.getSessionMessages(sessionId)
  if (result.success) {
    setMessages(result.messages || [])
  }
}
```

#### 跨会话消息去重（关键）

**场景**：用户在会话A提问后切换到会话B，会话A的回复到达时：
1. WebSocket 推送会话A的消息（用于未读提醒）
2. 切回会话A时，HTTP 拉取完整消息列表（包含同一条消息）
3. 需要合并去重，避免显示两次

```typescript
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

#### 跨会话消息处理流程

```typescript
// 收到 WebSocket 消息时
const handleMessage = (message: Message) => {
  // 验证消息归属
  if (message.sessionId !== currentSessionId) {
    // 非当前会话：增加未读计数，不显示在聊天区
    incrementUnread(message.sessionId)
    return
  }
  
  // 当前会话：添加到消息列表
  setMessages(prev => [...prev, message])
}

// 切换会话时
const handleSwitchSession = async (sessionId: string) => {
  setCurrentSessionId(sessionId)
  clearUnread(sessionId)
  
  // HTTP 拉取完整历史
  const result = await window.api.agent.getSessionMessages(sessionId)
  if (result.success && result.messages) {
    // 合并实时消息和拉取的消息，去重
    setMessages(prev => mergeMessages(prev, result.messages))
  }
}
```

### 并发控制

```typescript
// 防止重复提交
const [isProcessing, setIsProcessing] = useState(false)

const handleSendMessage = async () => {
  if (isProcessing) return  // 拦截重复点击
  
  setIsProcessing(true)
  try {
    await sendMessage()
  } finally {
    setIsProcessing(false)
  }
}
```

---

## 错误处理策略

### 错误类型

| 类型 | 场景 | 处理方式 |
|------|------|----------|
| 网络错误 | HTTP/WebSocket 断开 | 显示"连接失败，请检查网络" |
| 业务错误 | 会话不存在/无权访问 | 显示服务端返回的错误信息 |
| 超时错误 | 请求超过 10s | 显示"请求超时，请重试" |
| 未知错误 | 代码异常 | 显示"操作失败"，记录日志 |

### 错误边界

```typescript
// 全局错误捕获
useEffect(() => {
  const handleError = (error: Error) => {
    console.error('全局错误:', error)
    showToast('操作失败，请刷新页面重试')
  }
  
  window.addEventListener('error', handleError)
  return () => window.removeEventListener('error', handleError)
}, [])
```

---

## 性能优化

### 1. 虚拟列表
会话列表超过 50 个时使用虚拟滚动

### 2. 消息分页
单会话消息超过 100 条时分页加载

### 3. 防抖处理
搜索会话时 300ms 防抖

### 4. 懒加载
切换会话时按需加载消息历史

---

## 待实现功能

- [ ] 会话搜索
- [ ] 会话分组/标签
- [ ] 消息搜索
- [ ] 导出会话
- [ ] 多设备同步
