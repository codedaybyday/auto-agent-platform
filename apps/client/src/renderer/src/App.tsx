import { useState, useEffect } from 'react'
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
  const [isProcessing, setIsProcessing] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 多会话状态
  const [sessions, setSessions] = useState<Session[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)

  useEffect(() => {
    // 初始化 Agent
    initializeAgent()

    // 加载会话列表
    loadSessions()

    // Setup event listeners
    const unsubscribeMessage = window.api.agent.onMessage((message: Message) => {
      setMessages((prev) => [...prev, message])
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
    }
  }

  const handleCreateSession = async () => {
    const result = await window.api.agent.createSession()
    if (result.success) {
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
      setMessages([])
    } else {
      setError(result.error || '切换会话失败')
    }
  }

  const handleDeleteSession = async (sessionId: string) => {
    const result = await window.api.agent.deleteSession(sessionId)
    if (result.success) {
      // 重新加载会话列表
      await loadSessions()
      // 如果删除的是当前会话，清空当前会话ID
      if (sessionId === currentSessionId) {
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
    }
  }

  return (
    <div className="app">
      {/* 左侧会话面板 */}
      <SessionPanel
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSwitchSession={handleSwitchSession}
        onCreateSession={handleCreateSession}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
      />

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
