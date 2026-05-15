import { useState, useEffect, useRef } from 'react'
import { ChatInterface } from './components/ChatInterface'
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
  tool_calls?: ToolCall[]
  tool_results?: ToolResult[]
}

function App(): JSX.Element {
  const [activeTab, setActiveTab] = useState<'chat' | 'settings'>('chat')
  const [messages, setMessages] = useState<Message[]>([])
  const messagesRef = useRef<Message[]>([])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const [isProcessing, setIsProcessing] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 多会话状态
  const [sessions, setSessions] = useState<Session[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const currentSessionIdRef = useRef<string | null>(null)

  // 会话消息缓存：sessionId -> Message[]
  const [sessionMessagesCache, setSessionMessagesCache] = useState<Map<string, Message[]>>(new Map())
  const sessionMessagesCacheRef = useRef<Map<string, Message[]>>(new Map())

  // 同步 ref 和 state
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId
  }, [currentSessionId])

  useEffect(() => {
    sessionMessagesCacheRef.current = sessionMessagesCache
  }, [sessionMessagesCache])

  useEffect(() => {
    // 初始化 Agent
    initializeAgent()

    // 加载会话列表
    loadSessions()

    // Setup event listeners
    const unsubscribeMessage = window.api.agent.onMessage((message: Message) => {
      setMessages((prev) => {
        const newMessages = [...prev, message]
        // 使用 ref 获取最新的会话 ID，避免闭包问题
        const activeSessionId = currentSessionIdRef.current
        if (activeSessionId) {
          const newCache = new Map(sessionMessagesCacheRef.current)
          newCache.set(activeSessionId, newMessages)
          sessionMessagesCacheRef.current = newCache
          setSessionMessagesCache(newCache)
        }
        return newMessages
      })
    })

    const unsubscribeProcessing = window.api.agent.onProcessing((processing: boolean) => {
      setIsProcessing(processing)
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

    // 监听会话切换
    const unsubscribeSessionSwitched = window.api.agent.onSessionSwitched((sessionId: string) => {
      setCurrentSessionId(sessionId)
      setMessages([]) // 清空消息显示
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
    // 保存当前会话的消息到缓存（使用 ref 获取最新值）
    const activeSessionId = currentSessionIdRef.current
    if (activeSessionId) {
      // 使用 messagesRef 获取最新的消息列表
      const currentMessages = messagesRef.current
      const newCache = new Map(sessionMessagesCacheRef.current)
      newCache.set(activeSessionId, currentMessages)
      sessionMessagesCacheRef.current = newCache
      setSessionMessagesCache(newCache)
    }

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
    // 先保存当前会话的消息到缓存（使用 ref 获取最新值）
    const activeSessionId = currentSessionIdRef.current
    if (activeSessionId) {
      // 使用 messagesRef 获取最新的消息列表
      const currentMessages = messagesRef.current
      const newCache = new Map(sessionMessagesCacheRef.current)
      newCache.set(activeSessionId, currentMessages)
      sessionMessagesCacheRef.current = newCache
      setSessionMessagesCache(newCache)
    }

    const result = await window.api.agent.switchSession(sessionId)
    if (result.success) {
      setCurrentSessionId(sessionId)
      // 优先从缓存加载消息
      let targetMessages = sessionMessagesCacheRef.current.get(sessionId)

      // 如果缓存中没有，从服务端获取
      if (!targetMessages || targetMessages.length === 0) {
        const msgResult = await window.api.agent.getSessionMessages(sessionId)
        if (msgResult.success && msgResult.messages) {
          targetMessages = msgResult.messages
          // 更新缓存
          const newCache = new Map(sessionMessagesCacheRef.current)
          newCache.set(sessionId, targetMessages)
          sessionMessagesCacheRef.current = newCache
          setSessionMessagesCache(newCache)
        }
      }

      setMessages(targetMessages || [])
    } else {
      setError(result.error || '切换会话失败')
    }
  }

  const handleDeleteSession = async (sessionId: string) => {
    const result = await window.api.agent.deleteSession(sessionId)
    if (result.success) {
      // 从缓存中删除该会话的消息
      const newCache = new Map(sessionMessagesCacheRef.current)
      newCache.delete(sessionId)
      sessionMessagesCacheRef.current = newCache
      setSessionMessagesCache(newCache)
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
    const result = await window.api.agent.clearHistory()
    if (result.success) {
      setMessages([])
      // 同时清空缓存中的当前会话消息（使用 ref）
      const activeSessionId = currentSessionIdRef.current
      if (activeSessionId) {
        const newCache = new Map(sessionMessagesCacheRef.current)
        newCache.set(activeSessionId, [])
        sessionMessagesCacheRef.current = newCache
        setSessionMessagesCache(newCache)
      }
    }
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
          <div className={`connection-dot ${isConnected ? 'connected' : 'disconnected'}`} />
          <span className="connection-text">
            {isConnected ? '已连接' : '未连接'}
          </span>
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
          <ChatInterface
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
