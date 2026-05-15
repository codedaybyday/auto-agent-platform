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
│  HTTP 短连接 (会话管理)              WebSocket (实时消息)         │
│  ├─ getSessions()                   ├─ init()                    │
│  ├─ createSession()                 ├─ sendMessage()             │
│  ├─ deleteSession()                 ├─ onMessage()               │
│  ├─ renameSession()                 ├─ onToolStart/End()         │
│  └─ getSessionMessages()            └─ onStreamChunk()           │
└─────────────────────────────────────────────────────────────────┘
```

## 交互流程详解

### 1. 创建会话流程

```
用户点击"新建"按钮
        │
        ▼
┌───────────────┐
│ 显示 loading  │
│  按钮禁用     │
└───────┬───────┘
        │
        ▼
┌───────────────────────┐
│ IPC createSession()   │
│ 调用后端 HTTP POST    │
│ /api/sessions         │
└───────┬───────────────┘
        │
    ┌───┴───┐
    │       │
  成功     失败
    │       │
    ▼       ▼
┌────────┐  ┌────────────┐
│1.添加新 │  │显示错误提示│
│  会话到 │  │按钮恢复   │
│  列表   │  └────────────┘
│2.自动  │
│  切换   │
│3.清空  │
│  消息区 │
└────────┘
```

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
│ 保存当前会话消息   │
│ 到 sessionCache   │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ IPC switchSession │
│ (仅前端状态切换)  │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ 从缓存加载消息?   │
└─────────┬─────────┘
          │
     ┌────┴────┐
     │         │
    有缓存    无缓存
     │         │
     ▼         ▼
┌────────┐  ┌─────────────────┐
│直接显示│  │HTTP GET 获取历史│
│缓存消息│  │/api/sessions/id │
└────────┘  │/messages        │
            └────────┬────────┘
                     │
                     ▼
              ┌────────────┐
              │更新缓存    │
              │显示消息    │
              └────────────┘
```

**代码实现要点：**
```typescript
const handleSwitchSession = async (targetId: string) => {
  // 1. 保存当前会话
  if (currentSessionId) {
    saveToCache(currentSessionId, messages)
  }
  
  // 2. 更新当前会话ID
  setCurrentSessionId(targetId)
  
  // 3. 尝试从缓存加载
  let targetMessages = sessionCache.get(targetId)
  
  // 4. 缓存未命中，从后端获取
  if (!targetMessages) {
    const result = await window.api.agent.getSessionMessages(targetId)
    if (result.success) {
      targetMessages = result.messages
      saveToCache(targetId, targetMessages)
    }
  }
  
  // 5. 显示消息
  setMessages(targetMessages || [])
  
  // 6. 滚动到底部
  scrollToBottom()
}
```

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

### 缓存策略

```typescript
interface CacheStrategy {
  // 1. 缓存读取
  read: (sessionId: string) => Message[] | undefined
  
  // 2. 缓存写入
  write: (sessionId: string, messages: Message[]) => void
  
  // 3. 缓存失效
  invalidate: (sessionId: string) => void
  
  // 4. 缓存清理（内存告警时）
  cleanup: (maxSize: number) => void
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
