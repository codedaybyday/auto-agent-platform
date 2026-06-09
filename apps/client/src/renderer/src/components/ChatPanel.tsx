import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './ChatPanel.css'

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

interface ChatPanelProps {
  messages: Message[]
  isProcessing: boolean
  streamingContent?: string
  isStreaming?: boolean
  onSendMessage: (content: string) => void
  onClearHistory: () => void
  onStop?: () => void
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function ToolCallDisplay({ toolCall }: { toolCall: ToolCall }): JSX.Element {
  return (
    <div className="tool-call">
      <div className="tool-call-header">
        <span className="tool-icon">🔧</span>
        <span className="tool-name">{toolCall.name}</span>
      </div>
      <div className="tool-input">
        <pre>{JSON.stringify(toolCall.input, null, 2)}</pre>
      </div>
    </div>
  )
}

function ToolResultDisplay({ result }: { result: ToolResult }): JSX.Element {
  return (
    <div className={`tool-result ${result.is_error ? 'error' : ''}`}>
      <div className="tool-result-header">
        <span className="tool-icon">{result.is_error ? '❌' : '✅'}</span>
        <span className="tool-result-label">结果</span>
      </div>
      <div className="tool-result-content">
        <pre>{result.content}</pre>
      </div>
    </div>
  )
}

function MessageBubble({ message, isLoading, isStreaming }: { message: Message; isLoading?: boolean; isStreaming?: boolean }): JSX.Element {
  const isUser = message.role === 'user'

  return (
    <div className={`message-bubble ${isUser ? 'user' : 'assistant'}`}>
      <div className="message-header">
        <span className="message-role">{isUser ? '👤 你' : '🤖 助手'}</span>
        <span className="message-time">{formatTime(message.timestamp)}</span>
      </div>

      {message.content ? (
        <div className={`message-content ${isStreaming ? 'streaming' : ''}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
          {isStreaming && <span className="streaming-cursor">▋</span>}
        </div>
      ) : isLoading ? (
        <div className="message-content loading">
          <span className="loading-dot"></span>
          <span className="loading-dot"></span>
          <span className="loading-dot"></span>
        </div>
      ) : null}

      {message.tool_calls && message.tool_calls.length > 0 && (
        <div className="tool-calls">
          {message.tool_calls.map((toolCall) => (
            <ToolCallDisplay key={toolCall.id} toolCall={toolCall} />
          ))}
        </div>
      )}

      {message.tool_results && message.tool_results.length > 0 && (
        <div className="tool-results">
          {message.tool_results.map((result) => (
            <ToolResultDisplay key={result.tool_use_id} result={result} />
          ))}
        </div>
      )}
    </div>
  )
}

export function ChatPanel({
  messages,
  isProcessing,
  streamingContent = '',
  isStreaming = false,
  onSendMessage,
  onClearHistory,
  onStop
}: ChatPanelProps): JSX.Element {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isComposingRef = useRef(false)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSubmit = () => {
    if (!input.trim() || isProcessing) return
    onSendMessage(input.trim())
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 中文输入法组合中，不处理回车（让输入法自行处理）
    if (e.key === 'Enter' && !e.shiftKey && !isComposingRef.current) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleCompositionStart = () => {
    isComposingRef.current = true
  }

  const handleCompositionEnd = () => {
    isComposingRef.current = false
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = e.target.scrollHeight + 'px'
  }

  return (
    <div className="chat-interface">
      <div className="chat-header">
        <h2>Agent 对话</h2>
        <div className="chat-actions">
          {isProcessing && (
            <span className="processing-indicator">
              <span className="processing-spinner"></span>
              AI 思考中
            </span>
          )}
          <button className="clear-btn" onClick={onClearHistory} disabled={isProcessing}>
            清除历史
          </button>
        </div>
      </div>

      <div className="messages-container">
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🤖</div>
            <h3>欢迎使用 Auto Agent</h3>
            <p>开始与 AI 助手对话。</p>
            <p>你可以让它：</p>
            <ul>
              <li>执行 bash 命令</li>
              <li>控制浏览器</li>
              <li>自主执行复杂任务</li>
            </ul>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {/* 流式消息显示（逐字输出） */}
            {isStreaming && streamingContent && (
              <MessageBubble
                key="streaming"
                message={{
                  id: 'streaming',
                  role: 'assistant',
                  content: streamingContent,
                  timestamp: Date.now()
                }}
                isStreaming={true}
              />
            )}
            {/* 非流式加载状态 */}
            {isProcessing && !isStreaming && messages[messages.length - 1]?.role !== 'assistant' && (
              <MessageBubble
                key="loading"
                message={{
                  id: 'loading',
                  role: 'assistant',
                  content: '',
                  timestamp: Date.now()
                }}
                isLoading={true}
              />
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-container">
        <div className="input-wrapper">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder={isProcessing ? 'AI 正在思考...' : '输入消息... (按 Enter 发送，Shift+Enter 换行)'}
            disabled={isProcessing}
            rows={1}
          />
          {isProcessing ? (
            <button
              className="send-btn stop-btn"
              onClick={onStop}
              title="停止生成"
            >
              ⏹
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={handleSubmit}
              disabled={!input.trim()}
            >
              ➤
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
