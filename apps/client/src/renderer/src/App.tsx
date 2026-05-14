import { useState, useEffect } from 'react'
import { ChatInterface } from './components/ChatInterface'
import { SettingsPanel } from './components/SettingsPanel'
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

  useEffect(() => {
    // 初始化 Agent（服务端已配置模型）
    initializeAgent()

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

    return () => {
      unsubscribeMessage()
      unsubscribeProcessing()
      unsubscribeToolStart()
      unsubscribeToolResult()
      unsubscribeHistoryCleared()
    }
  }, [])

  const initializeAgent = async () => {
    // 服务端已配置模型，前端无需传递 apiKey 和 modelConfig
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
    } else {
      setIsConnected(false)
      setError(result.error || '初始化 Agent 失败')
    }
  }

  const handleSendMessage = async (content: string) => {
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
