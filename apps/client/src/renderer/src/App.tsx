import { useState, useEffect } from 'react'
import { ChatInterface } from './components/ChatInterface'
import { SettingsPanel, ModelConfig, PRESET_MODELS } from './components/SettingsPanel'
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

const STORAGE_KEY_API_KEY = 'anthropic_api_key'
const STORAGE_KEY_MODEL_CONFIG = 'agent_model_config'

function App(): JSX.Element {
  const [activeTab, setActiveTab] = useState<'chat' | 'settings'>('chat')
  const [messages, setMessages] = useState<Message[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [modelConfig, setModelConfig] = useState<ModelConfig>(PRESET_MODELS[0])
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Load saved config
    const savedApiKey = localStorage.getItem(STORAGE_KEY_API_KEY)
    const savedModelConfig = localStorage.getItem(STORAGE_KEY_MODEL_CONFIG)

    let config = PRESET_MODELS[0]
    if (savedModelConfig) {
      try {
        const parsed = JSON.parse(savedModelConfig)
        if (parsed.id === 'custom') {
          config = parsed
        } else {
          const preset = PRESET_MODELS.find(m => m.id === parsed.id)
          if (preset) config = preset
        }
      } catch {
        // ignore parse error
      }
    }

    setModelConfig(config)

    if (savedApiKey) {
      setApiKey(savedApiKey)
      initializeAgent(savedApiKey, config)
    }

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

  const initializeAgent = async (key: string, config: ModelConfig) => {
    const result = await window.api.agent.init({
      apiKey: key,
      modelConfig: config
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
    if (!isConnected) {
      setError('请先在设置中配置 API 密钥和模型')
      setActiveTab('settings')
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

  const handleSaveConfig = async (key: string, config: ModelConfig) => {
    localStorage.setItem(STORAGE_KEY_API_KEY, key)
    localStorage.setItem(STORAGE_KEY_MODEL_CONFIG, JSON.stringify(config))
    setApiKey(key)
    setModelConfig(config)
    await initializeAgent(key, config)
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
            {isConnected ? modelConfig.name : '未连接'}
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
          <SettingsPanel
            apiKey={apiKey}
            modelConfig={modelConfig}
            onSaveConfig={handleSaveConfig}
            isConnected={isConnected}
          />
        )}
      </main>
    </div>
  )
}

export default App
