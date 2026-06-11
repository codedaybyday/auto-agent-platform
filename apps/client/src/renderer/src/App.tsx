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
 */
const mergeMessages = (existing: Message[], incoming: Message[]): Message[] => {
  const messageMap = new Map<string, Message>()
  existing.forEach(msg => messageMap.set(msg.id, msg))
  incoming.forEach(msg => messageMap.set(msg.id, msg))
  return Array.from(messageMap.values()).sort((a, b) => a.timestamp - b.timestamp)
}

// 有界消息 ID 集合，防止重复处理
class BoundedMessageIdSet {
  private ids: string[] = []
  private maxSize: number

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize
  }

  has(id: string): boolean {
    return this.ids.includes(id)
  }

  add(id: string): void {
    if (this.has(id)) return
    this.ids.push(id)
    if (this.ids.length > this.maxSize) {
      this.ids.shift()
    }
  }
}

const processedMessageIds = new BoundedMessageIdSet(1000)

function App(): JSX.Element {
  const [view, setView] = useState<'chat' | 'settings'>('chat')
  const [messages, setMessages] = useState<Message[]>([])
  const [userInfo, setUserInfo] = useState<any>(null)
  const [processingMap, setProcessingMap] = useState<Map<string, boolean>>(new Map())
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [streamingContentMap, setStreamingContentMap] = useState<Map<string, string>>(new Map())
  const [isStreamingMap, setIsStreamingMap] = useState<Map<string, boolean>>(new Map())
  const [showUserMenu, setShowUserMenu] = useState(false)

  const messagesRef = useRef<Message[]>([])
  const processingMapRef = useRef<Map<string, boolean>>(new Map())
  const currentSessionIdRef = useRef<string | null>(null)
  const streamingContentMapRef = useRef<Map<string, string>>(new Map())
  const userMenuRef = useRef<HTMLDivElement>(null)

  const handleLogin = async () => {
    const check = await window.api.agent.whoami()
    if (check.success) return setUserInfo(check.data)

    const login = await window.api.agent.login()
    if (!login.success) return

    const retry = await window.api.agent.whoami()
    if (retry.success) setUserInfo(retry.data)
  }

  useEffect(() => {
    window.api.agent.whoami().then(result => {
      if (result.success) setUserInfo(result.data)
    }).catch(console.error)
  }, [])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    processingMapRef.current = processingMap
  }, [processingMap])

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId
  }, [currentSessionId])

  useEffect(() => {
    streamingContentMapRef.current = streamingContentMap
  }, [streamingContentMap])

  // 点击外部关闭用户菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const isProcessing = currentSessionId ? processingMap.get(currentSessionId) || false : false
  const streamingContent = currentSessionId ? streamingContentMap.get(currentSessionId) || '' : ''
  const isStreaming = currentSessionId ? isStreamingMap.get(currentSessionId) || false : false

  useEffect(() => {
    const initAndLoad = async () => {
      const result = await initializeAgent()
      if (result.success) await loadSessions()
    }
    initAndLoad().catch(console.error)

    const unsubscribeMessage = window.api.agent.onMessage((message: Message) => {
      if (processedMessageIds.has(message.id)) return
      processedMessageIds.add(message.id)

      const activeSessionId = currentSessionIdRef.current

      if (message.sessionId && message.sessionId !== activeSessionId) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === message.sessionId ? { ...s, unreadCount: (s.unreadCount || 0) + 1 } : s
          )
        )
        return
      }

      if (message.id?.startsWith('stream-')) return

      setMessages((prev) => {
        if (prev.some(m => m.id === message.id)) return prev
        return [...prev, message]
      })

      if (message.role === 'assistant') {
        const msgSessionId = message.sessionId || currentSessionIdRef.current
        if (msgSessionId && isStreamingMap.get(msgSessionId)) {
          setStreamingContentMap((prev) => {
            const newMap = new Map(prev)
            newMap.delete(msgSessionId)
            return newMap
          })
          setIsStreamingMap((prev) => {
            const newMap = new Map(prev)
            newMap.set(msgSessionId, false)
            return newMap
          })
        }
      }

      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId ? { ...s, messageCount: s.messageCount + 1, updatedAt: Date.now() } : s
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
      console.log('Tool started:', data.toolCall.name)
    })

    const unsubscribeToolResult = window.api.agent.onToolResult((data: { toolCall: ToolCall; result: ToolResult }) => {
      console.log('Tool result:', data.toolCall.name, data.result.is_error ? 'error' : 'success')
    })

    const unsubscribeStreamChunk = window.api.agent.onStreamChunk((data: { chunk: string; sessionId?: string }) => {
      const targetSessionId = data.sessionId || currentSessionIdRef.current
      if (!targetSessionId) return

      setStreamingContentMap((prev) => {
        const newMap = new Map(prev)
        const currentContent = newMap.get(targetSessionId) || ''
        newMap.set(targetSessionId, currentContent + data.chunk)
        return newMap
      })
      setIsStreamingMap((prev) => {
        const newMap = new Map(prev)
        newMap.set(targetSessionId, true)
        return newMap
      })
    })

    const unsubscribeStreamDone = window.api.agent.onStreamDone((data: { sessionId?: string }) => {
      const targetSessionId = data.sessionId || currentSessionIdRef.current
      if (!targetSessionId) return

      const finalContent = streamingContentMapRef.current.get(targetSessionId) || ''

      setIsStreamingMap((prev) => {
        const newMap = new Map(prev)
        newMap.set(targetSessionId, false)
        return newMap
      })

      if (finalContent) {
        if (targetSessionId === currentSessionIdRef.current) {
          const newMessage: Message = {
            id: `stream-${Date.now()}`,
            role: 'assistant',
            content: finalContent,
            timestamp: Date.now(),
            sessionId: targetSessionId
          }
          setMessages((prev) => [...prev, newMessage])
        }

        setSessions((prev) =>
          prev.map((s) =>
            s.id === targetSessionId ? { ...s, messageCount: s.messageCount + 1, updatedAt: Date.now() } : s
          )
        )

        setStreamingContentMap((prev) => {
          const newMap = new Map(prev)
          newMap.delete(targetSessionId)
          return newMap
        })
      }
    })

    const unsubscribeHistoryCleared = window.api.agent.onHistoryCleared(() => {
      setMessages([])
      setStreamingContentMap(new Map())
    })

    const unsubscribeSessionsUpdated = window.api.agent.onSessionsUpdated((updatedSessions: Session[]) => {
      setSessions(updatedSessions)
    })

    const unsubscribeSessionSwitched = window.api.agent.onSessionSwitched((sessionId: string) => {
      setCurrentSessionId(sessionId)
    })

    const unsubscribeSessionTitleUpdated = window.api.agent.onSessionTitleUpdated((data: { sessionId: string; title: string }) => {
      // 更新会话列表中的标题
      setSessions((prev) =>
        prev.map((s) =>
          s.id === data.sessionId ? { ...s, title: data.title } : s
        )
      )
    })

    return () => {
      unsubscribeMessage()
      unsubscribeProcessing()
      unsubscribeToolStart()
      unsubscribeToolResult()
      unsubscribeStreamChunk()
      unsubscribeStreamDone()
      unsubscribeHistoryCleared()
      unsubscribeSessionsUpdated()
      unsubscribeSessionSwitched()
      unsubscribeSessionTitleUpdated()
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
      if (result.sessionId) setCurrentSessionId(result.sessionId)
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
      if (result.sessions.length > 0 && !currentSessionIdRef.current) {
        const firstSession = result.sessions[0]

        // 先清空消息，再设置当前会话
        setMessages([])
        setCurrentSessionId(firstSession.id)
        currentSessionIdRef.current = firstSession.id

        // 加载第一个会话的消息
        const msgResult = await window.api.agent.getSessionMessages(firstSession.id)
        if (msgResult.success && msgResult.messages) {
          const uniqueMessages = Array.from(
            new Map(msgResult.messages.map((m: Message) => [m.id, m])).values()
          )
          setMessages(uniqueMessages)
        }
      }
    }
  }

  const handleCreateSession = async () => {
    const result = await window.api.agent.createSession()
    if (result.success && result.sessionId) {
      setCurrentSessionId(result.sessionId)
      currentSessionIdRef.current = result.sessionId
      setMessages([])
      setView('chat')
      await loadSessions()
    } else {
      setError(result.error || '创建会话失败')
    }
  }

  const handleSwitchSession = async (sessionId: string) => {
    const result = await window.api.agent.switchSession(sessionId)
    if (result.success) {
      // 先清空消息，避免在加载期间显示旧消息
      setMessages([])

      setCurrentSessionId(sessionId)
      currentSessionIdRef.current = sessionId
      setView('chat')

      setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, unreadCount: 0 } : s)))

      const msgResult = await window.api.agent.getSessionMessages(sessionId)
      if (msgResult.success && msgResult.messages) {
        const uniqueMessages = Array.from(
          new Map(msgResult.messages.map((m: Message) => [m.id, m])).values()
        )
        setMessages(uniqueMessages)
      } else {
        setMessages([])
      }
    } else {
      setError(result.error || '切换会话失败')
    }
  }

  const handleDeleteSession = async (sessionId: string) => {
    const result = await window.api.agent.deleteSession(sessionId)
    if (result.success) {
      await loadSessions()
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
    if (!result.success) setError(result.error || '发送消息失败')
  }

  const handleClearHistory = async () => {
    const result = await window.api.agent.clearHistory()
    if (result.success) {
      setMessages([])
      if (currentSessionId) {
        setStreamingContentMap((prev) => {
          const newMap = new Map(prev)
          newMap.delete(currentSessionId)
          return newMap
        })
        setIsStreamingMap((prev) => {
          const newMap = new Map(prev)
          newMap.set(currentSessionId, false)
          return newMap
        })
      }
    } else {
      setError(result.error || '清除历史失败')
    }
  }

  const handleLogout = async () => {
    const result = await window.api.agent.logout()
    if (result.success) {
      setUserInfo(null)
      setMessages([])
      setSessions([])
      setCurrentSessionId(null)
      setIsConnected(false)
      setError(null)
      setView('chat')
    } else {
      setError(result.error || '退出登录失败')
    }
  }

  const handleStop = async () => {
    if (!currentSessionId) return
    console.log('[App] Stopping agent for session:', currentSessionId)
    try {
      const result = await window.api.agent.stop()
      if (!result.success) {
        console.error('[App] Failed to stop agent:', result.error)
      }
    } catch (error) {
      console.error('[App] Error stopping agent:', error)
    }
  }

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
            <button className="login-btn" onClick={handleLogin}>登录</button>
            <p className="login-hint">点击登录以继续使用</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      {/* 左侧边栏：包含 Logo、新会话、会话列表、底部操作栏 */}
      <aside className="sidebar">
        {/* Logo */}
        <div className="sidebar-header">
          <div className="logo">
            <span className="logo-icon">🤖</span>
            <span className="logo-text">Auto Agent</span>
          </div>
        </div>

        {/* 新会话按钮 */}
        <div className="sidebar-actions">
          <button className="new-chat-btn" onClick={handleCreateSession}>
            <span className="btn-icon">+</span>
            <span className="btn-text">新会话</span>
          </button>
        </div>

        {/* 会话列表 */}
        <div className="sidebar-content">
          <SessionPanel
            sessions={sessions}
            currentSessionId={currentSessionId}
            onSwitchSession={handleSwitchSession}
            onCreateSession={handleCreateSession}
            onDeleteSession={handleDeleteSession}
            onRenameSession={handleRenameSession}
          />
        </div>

        {/* 底部操作栏 */}
        <div className="sidebar-footer">
          {/* 设置按钮 */}
          <button
            className={`footer-btn ${view === 'settings' ? 'active' : ''}`}
            onClick={() => setView(view === 'settings' ? 'chat' : 'settings')}
          >
            <span className="btn-icon">⚙️</span>
            <span className="btn-text">设置</span>
            {!isConnected && <span className="status-indicator error" />}
          </button>

          {/* 用户菜单 */}
          <div className="user-menu-container" ref={userMenuRef}>
            <button
              className={`footer-btn user-btn ${showUserMenu ? 'active' : ''}`}
              onClick={() => setShowUserMenu(!showUserMenu)}
            >
              <span className="btn-icon">👤</span>
              <span className="btn-text user-name">{userInfo?.name || '用户'}</span>
              <span className="btn-icon dropdown">▼</span>
            </button>

            {showUserMenu && (
              <div className="user-dropdown">
                <div className="dropdown-header">
                  <span className="user-name">{userInfo?.name}</span>
                  <span className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
                    {isConnected ? '已连接' : '未连接'}
                  </span>
                </div>
                <div className="dropdown-divider" />
                <button className="dropdown-item" onClick={handleLogout}>
                  <span className="item-icon">🚪</span>
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* 右侧主内容区：聊天或设置（互斥显示） */}
      <main className="main-content">
        {error && (
          <div className="error-banner">
            <span className="error-icon">⚠️</span>
            <span className="error-text">{error}</span>
            <button className="error-close" onClick={() => setError(null)}>×</button>
          </div>
        )}

        {view === 'chat' ? (
          <ChatPanel
            messages={messages}
            isProcessing={isProcessing}
            streamingContent={streamingContent}
            isStreaming={isStreaming}
            onSendMessage={handleSendMessage}
            onClearHistory={handleClearHistory}
            onStop={handleStop}
          />
        ) : (
          <SettingsPanel isConnected={isConnected} />
        )}
      </main>
    </div>
  )
}

export default App
