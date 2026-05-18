import { useState, useEffect, useRef } from 'react'
import { ChatPanel } from './components/ChatPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { SessionPanel } from './components/SessionPanel'
import type { Session } from './components/SessionPanel'
import './App.css'

interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

interface ToolResult {
  tool_use_id: string
  content: string
  is_error?: boolean
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  sessionId?: string
  tool_calls?: ToolCall[]
  tool_results?: ToolResult[]
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

// 全局消息 ID 集合，防止 React StrictMode 导致的重复处理
const processedMessageIds = new Set<string>()

function App(): JSX.Element {
  // ==================== 所有 State 必须在最顶层声明 ====================
  const [activeTab, setActiveTab] = useState<'chat' | 'settings'>('chat')
  const [messages, setMessages] = useState<Message[]>([])
  const [userInfo, setUserInfo] = useState<any>(null)
  const [processingMap, setProcessingMap] = useState<Map<string, boolean>>(new Map())
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)

  // ==================== 所有 Ref 必须在最顶层声明 ====================
  const messagesRef = useRef<Message[]>([])
  const processingMapRef = useRef<Map<string, boolean>>(new Map())
  const currentSessionIdRef = useRef<string | null>(null)

  // ==================== 所有 Effects 必须在最顶层声明 ====================
  const handleLogin = async () => {
    const check = await window.api.agent.whoami()
    console.log('app check result: ', check)
    if (check.success) return setUserInfo(check.data)

    const login = await window.api.agent.login()
    console.log('app login result: ', login)
    if (!login.success) return

    const retry = await window.api.agent.whoami()
    if (retry.success) setUserInfo(retry.data)
  }

  useEffect(() => {
    // 组件挂载时检查登录状态，但不自动触发登录
    window.api.agent.whoami().then(result => {
      if (result.success) {
        setUserInfo(result.data)
      }
    }).catch(console.error)
  }, [])

  // 同步 ref 和 state
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    processingMapRef.current = processingMap
  }, [processingMap])

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId
  }, [currentSessionId])

  // ==================== 计算属性（在 Hooks 之后）====================
  const isProcessing = currentSessionId ? processingMap.get(currentSessionId) || false : false

  useEffect(() => {
    // 初始化 Agent，完成后加载会话列表
    const initAndLoad = async () => {
      const result = await initializeAgent()
      if (result.success) {
        await loadSessions()
      }
    }
    initAndLoad().catch(console.error)

    // Setup event listeners
    const unsubscribeMessage = window.api.agent.onMessage((message: Message) => {
      // 防重：检查消息是否已处理（React StrictMode 可能导致重复）
      if (processedMessageIds.has(message.id)) {
        console.log('[App] 重复消息，忽略:', message.id)
        return
      }
      processedMessageIds.add(message.id)

      const activeSessionId = currentSessionIdRef.current

      // 验证消息归属
      if (message.sessionId && message.sessionId !== activeSessionId) {
        // 非当前会话：增加未读计数
        console.log('[App] 非当前会话消息:', message.sessionId, '当前:', activeSessionId)
        setSessions((prev) =>
          prev.map((s) =>
            s.id === message.sessionId
              ? { ...s, unreadCount: (s.unreadCount || 0) + 1 }
              : s
          )
        )
        return
      }

      // 当前会话：添加到消息列表
      setMessages((prev) => {
        const newMessages = [...prev, message]
        console.log('[App] 添加消息到当前会话:', activeSessionId, '消息数:', newMessages.length)
        return newMessages
      })

      // 更新当前会话的消息计数
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId
            ? { ...s, messageCount: s.messageCount + 1, updatedAt: Date.now() }
            : s
        )
      )
    })

    const unsubscribeProcessing = window.api.agent.onProcessing((data: { processing: boolean; sessionId?: string }) => {
      const sessionId = data.sessionId || currentSessionIdRef.current
      if (sessionId) {
        setProcessingMap((prev) => {
          const newMap = new Map(prev)
          newMap.set(sessionId, data.processing)
          return newMap
        })
      }
    })

    const unsubscribeToolStart = window.api.agent.onToolStart((data: { toolCall: ToolCall }) => {
      console.log('Tool started:', data.toolCall.name, data.toolCall.input)
    })

    const unsubscribeToolResult = window.api.agent.onToolResult((data: { toolCall: ToolCall; result: ToolResult }) => {
      console.log('Tool result:', data.toolCall.name, data.result.is_error ? 'error' : 'success')
    })

    const unsubscribeHistoryCleared = window.api.agent.onHistoryCleared(() => {
      setMessages([])
    })

    // 监听会话列表更新
    const unsubscribeSessionsUpdated = window.api.agent.onSessionsUpdated((updatedSessions: Session[]) => {
      setSessions(updatedSessions)
    })

    // 监听会话切换（仅更新当前会话ID，不操作消息）
    // 消息加载由 handleSwitchSession 统一管理
    const unsubscribeSessionSwitched = window.api.agent.onSessionSwitched((sessionId: string) => {
      setCurrentSessionId(sessionId)
    })

    return () => {
      unsubscribeMessage()
      unsubscribeProcessing()
      unsubscribeToolStart()
      unsubscribeToolResult()
      unsubscribeHistoryCleared()
      unsubscribeSessionsUpdated()
      unsubscribeSessionSwitched()
    }
  }, [])

  const initializeAgent = async () => {
    const result = await window.api.agent.init({
      apiKey: '',
      modelConfig: {
        id: 'server-configured',
        name: '服务端内置模型',
        model: '',
        baseURL: '',
        protocol: 'openai-chat-completion'
      }
    })
    if (result.success) {
      setIsConnected(true)
      setError(null)
      if (result.sessionId) {
        setCurrentSessionId(result.sessionId)
      }
    } else {
      setIsConnected(false)
      setError(result.error || '初始化 Agent 失败')
    }
    return result
  }

  const loadSessions = async () => {
    const result = await window.api.agent.getSessions()
    if (result.success && result.sessions) {
      setSessions(result.sessions)

      // 如果有会话但没有当前会话，自动选中第一个
      if (result.sessions.length > 0 && !currentSessionIdRef.current) {
        const firstSession = result.sessions[0]
        setCurrentSessionId(firstSession.id)
        currentSessionIdRef.current = firstSession.id
      }
    }
  }

  const handleCreateSession = async () => {
    const result = await window.api.agent.createSession()
    if (result.success && result.sessionId) {
      // 设置新会话为当前会话
      setCurrentSessionId(result.sessionId)
      currentSessionIdRef.current = result.sessionId
      // 新会话为空消息列表
      setMessages([])
      // 重新加载会话列表
      await loadSessions()
    } else {
      setError(result.error || '创建会话失败')
    }
  }

  const handleSwitchSession = async (sessionId: string) => {
    const result = await window.api.agent.switchSession(sessionId)
    if (result.success) {
      setCurrentSessionId(sessionId)
      currentSessionIdRef.current = sessionId

      // 清零未读计数
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, unreadCount: 0 } : s))
      )

      // 从服务端获取最新消息（保证数据一致性）
      console.log('[App] 从服务端获取消息:', sessionId)
      const msgResult = await window.api.agent.getSessionMessages(sessionId)
      if (msgResult.success && msgResult.messages) {
        // 去重：按消息 ID 去重
        const uniqueMessages = Array.from(
          new Map(msgResult.messages.map((m: Message) => [m.id, m])).values()
        )
        if (uniqueMessages.length !== msgResult.messages.length) {
          console.log('[App] 发现重复消息，去重前:', msgResult.messages.length, '去重后:', uniqueMessages.length)
        }
        // 打印所有消息 ID 便于调试
        console.log('[App] 消息 ID 列表:', uniqueMessages.map((m: Message) => ({ id: m.id, role: m.role, content: m.content.substring(0, 30) })))
        setMessages(uniqueMessages)
        console.log('[App] 切换到会话:', sessionId, '消息数:', uniqueMessages.length)
      } else {
        setMessages([])
        console.log('[App] 获取消息失败，显示空消息')
      }
    } else {
      setError(result.error || '切换会话失败')
    }
  }

  const handleDeleteSession = async (sessionId: string) => {
    const result = await window.api.agent.deleteSession(sessionId)
    if (result.success) {
      // 重新加载会话列表
      await loadSessions()
      // 如果删除的是当前会话，清空当前会话ID和消息
      if (sessionId === currentSessionIdRef.current) {
        setCurrentSessionId(null)
        setMessages([])
      }
    } else {
      setError(result.error || '删除会话失败')
    }
  }

  const handleRenameSession = async (sessionId: string, title: string) => {
    const result = await window.api.agent.renameSession(sessionId, title)
    if (result.success) {
      // 重新加载会话列表
      await loadSessions()
    } else {
      setError(result.error || '重命名会话失败')
    }
  }

  const handleSendMessage = async (content: string) => {
    if (!currentSessionId) {
      setError('请先创建或选择一个会话')
      return
    }
    setError(null)
    const result = await window.api.agent.sendMessage(content)
    if (!result.success) {
      setError(result.error || '发送消息失败')
    }
  }

  const handleClearHistory = async () => {
    console.log('[App] Clearing history...')
    const result = await window.api.agent.clearHistory()
    console.log('[App] clearHistory result:', result)
    if (result.success) {
      setMessages([])
      console.log('[App] Messages cleared locally')
    } else {
      console.error('[App] Failed to clear history:', result.error)
      setError(result.error || '清除历史失败')
    }
  }

  const handleLogout = async () => {
    const result = await window.api.agent.logout()
    if (result.success) {
      // 重置所有状态
      setUserInfo(null)
      setMessages([])
      setSessions([])
      setCurrentSessionId(null)
      setIsConnected(false)
      setError(null)
      console.log('[App] Logout successful')
    } else {
      setError(result.error || '退出登录失败')
    }
  }

  // ==================== 条件渲染（在所有 Hooks 之后）====================
  if (!userInfo) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="login-logo">
            <div className="login-icon">🤖</div>
            <h1 className="login-title">Auto Agent</h1>
            <p className="login-subtitle">智能自动化助手</p>
          </div>
          <div className="login-content">
            <button className="login-btn" onClick={handleLogin}>
              登录
            </button>
            <p className="login-hint">点击登录以继续使用</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>🤖 Auto Agent</h1>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-btn ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            <span className="nav-icon">💬</span>
            <span>对话</span>
            {isProcessing && <span className="nav-indicator">●</span>}
          </button>

          <button
            className={`nav-btn ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <span className="nav-icon">⚙️</span>
            <span>设置</span>
            {!isConnected && <span className="nav-warning">⚠️</span>}
          </button>
        </nav>

        <div className="sidebar-footer">
          {/* 用户信息 */}
          {userInfo?.name && (
            <div className="user-info">
              <span className="user-avatar">👤</span>
              <span className="user-name" title={userInfo.name}>
                {userInfo.name}
              </span>
              <button
                className="logout-btn"
                onClick={handleLogout}
                title="退出登录"
              >
                退出
              </button>
            </div>
          )}

          {/* 连接状态 */}
          <div className="connection-status">
            <div className={`connection-dot ${isConnected ? 'connected' : 'disconnected'}`} />
            <span className="connection-text">
              {isConnected ? '已连接' : '未连接'}
            </span>
          </div>
        </div>
      </aside>

      {/* 会话列表面板 */}
      <SessionPanel
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSwitchSession={handleSwitchSession}
        onCreateSession={handleCreateSession}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
      />

      <main className="main-content">
        {error && (
          <div className="error-banner">
            <span className="error-icon">⚠️</span>
            <span className="error-text">{error}</span>
            <button className="error-close" onClick={() => setError(null)}>×</button>
          </div>
        )}

        {activeTab === 'chat' ? (
          <ChatPanel
            messages={messages}
            isProcessing={isProcessing}
            onSendMessage={handleSendMessage}
            onClearHistory={handleClearHistory}
          />
        ) : (
          <SettingsPanel isConnected={isConnected} />
        )}
      </main>
    </div>
  )
}

export default App
