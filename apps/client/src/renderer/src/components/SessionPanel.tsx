import { useState, useEffect } from 'react'
import './SessionPanel.css'

export interface Session {
  id: string
  title: string
  updatedAt: number
  messageCount: number
  unreadCount?: number
}

interface SessionPanelProps {
  sessions: Session[]
  currentSessionId: string | null
  onSwitchSession: (sessionId: string) => void
  onCreateSession: () => void
  onDeleteSession: (sessionId: string) => void
  onRenameSession: (sessionId: string, title: string) => void
}

interface PreviewMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } else if (days === 1) {
    return '昨天'
  } else if (days < 7) {
    return `${days}天前`
  } else {
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }
}

function truncateContent(content: string, maxLen: number = 80): string {
  if (content.length <= maxLen) return content
  return content.slice(0, maxLen) + '...'
}

export function SessionPanel({
  sessions,
  currentSessionId,
  onSwitchSession,
  onCreateSession,
  onDeleteSession,
  onRenameSession
}: SessionPanelProps): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  // 展开状态：记录哪些任务已展开
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  // 缓存已加载的消息预览
  const [messageCache, setMessageCache] = useState<Map<string, PreviewMessage[]>>(new Map())
  // 正在加载消息的任务
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())

  const handleStartEdit = (session: Session) => {
    setEditingId(session.id)
    setEditTitle(session.title)
  }

  const handleSaveEdit = () => {
    if (editingId && editTitle.trim()) {
      onRenameSession(editingId, editTitle.trim())
      setEditingId(null)
      setEditTitle('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      setEditingId(null)
      setEditTitle('')
    }
  }

  // 切换展开/折叠
  const toggleExpand = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()

    const isCurrentlyExpanded = expandedIds.has(sessionId)

    setExpandedIds(prev => {
      const next = new Set(prev)
      if (isCurrentlyExpanded) {
        next.delete(sessionId)
      } else {
        next.add(sessionId)
      }
      return next
    })

    // 展开时加载消息（如果还没缓存）
    if (!isCurrentlyExpanded && !messageCache.has(sessionId)) {
      setLoadingIds(prev => new Set(prev).add(sessionId))
      try {
        const result = await window.api.agent.getSessionMessages(sessionId)
        if (result.success && result.messages) {
          // 取最近的 5 条消息，只保留 user 和 assistant 角色
          const messages = result.messages
            .filter((m: any) => m.role === 'user' || m.role === 'assistant')
            .slice(-5) as PreviewMessage[]
          setMessageCache(prev => new Map(prev).set(sessionId, messages))
        } else {
          setMessageCache(prev => new Map(prev).set(sessionId, []))
        }
      } catch {
        setMessageCache(prev => new Map(prev).set(sessionId, []))
      } finally {
        setLoadingIds(prev => {
          const next = new Set(prev)
          next.delete(sessionId)
          return next
        })
      }
    }
  }

  return (
    <div className="session-panel">
      {/* 任务菜单标题 */}
      <div className="task-menu-header">
        <span className="task-menu-title">📋 任务</span>
        {sessions.length > 0 && (
          <span className="task-menu-count">{sessions.length}</span>
        )}
      </div>

      {/* 任务列表 */}
      <div className="session-list">
        {sessions.length === 0 ? (
          <div className="empty-sessions">
            <span className="empty-icon">📋</span>
            <p>暂无任务</p>
            <button className="empty-action" onClick={onCreateSession}>
              新建任务
            </button>
          </div>
        ) : (
          sessions.map((session) => {
            const isExpanded = expandedIds.has(session.id)
            const isLoading = loadingIds.has(session.id)
            const previewMessages = messageCache.get(session.id)

            return (
              <div
                key={session.id}
                className={`session-item ${session.id === currentSessionId ? 'active' : ''} ${isExpanded ? 'expanded' : ''}`}
              >
                <div
                  className="session-content"
                  onClick={() => onSwitchSession(session.id)}
                >
                  {/* 展开/折叠按钮 */}
                  <button
                    className="task-expand-btn"
                    onClick={(e) => toggleExpand(session.id, e)}
                    title={isExpanded ? '收起' : '展开'}
                  >
                    {isExpanded ? '▾' : '▸'}
                  </button>
                  <div className="session-icon">📋</div>
                  <div className="session-info">
                    {editingId === session.id ? (
                      <input
                        className="session-title-input"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onBlur={handleSaveEdit}
                        onKeyDown={handleKeyDown}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <div
                          className="session-title"
                          onDoubleClick={(e) => {
                            e.stopPropagation()
                            handleStartEdit(session)
                          }}
                          title={session.title}
                        >
                          {session.title}
                        </div>
                        <div className="session-meta">
                          <span>{session.messageCount} 条消息</span>
                          <span className="separator">·</span>
                          <span>{formatTime(session.updatedAt)}</span>
                        </div>
                      </>
                    )}
                  </div>
                  {session.unreadCount && session.unreadCount > 0 && (
                    <span className="unread-badge">{session.unreadCount}</span>
                  )}
                </div>

                {/* 删除按钮 */}
                <button
                  className="delete-session-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm('确定要删除这个任务吗？')) {
                      onDeleteSession(session.id)
                    }
                  }}
                  title="删除任务"
                >
                  ×
                </button>

                {/* 展开的消息预览 */}
                {isExpanded && (
                  <div className="task-preview">
                    {isLoading ? (
                      <div className="task-preview-loading">
                        <span className="loading-dot" />
                        <span className="loading-dot" />
                        <span className="loading-dot" />
                      </div>
                    ) : previewMessages && previewMessages.length > 0 ? (
                      <>
                        {previewMessages.map((msg) => (
                          <div key={msg.id} className={`task-preview-item ${msg.role}`}>
                            <span className="task-preview-role">
                              {msg.role === 'user' ? '👤' : '🤖'}
                            </span>
                            <span className="task-preview-text">
                              {truncateContent(msg.content)}
                            </span>
                          </div>
                        ))}
                        <div
                          className="task-view-all"
                          onClick={() => onSwitchSession(session.id)}
                        >
                          查看全部 →
                        </div>
                      </>
                    ) : (
                      <div className="task-preview-empty">暂无消息</div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* 提示 */}
      {sessions.length > 0 && (
        <div className="session-hint">
          <p>💡 双击任务名称可重命名，点击 ▸ 展开预览</p>
        </div>
      )}
    </div>
  )
}
