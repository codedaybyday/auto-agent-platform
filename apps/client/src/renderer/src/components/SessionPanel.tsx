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

  return (
    <div className="session-panel">
      {/* 会话列表 */}
      <div className="session-list">
        {sessions.length === 0 ? (
          <div className="empty-sessions">
            <span className="empty-icon">💬</span>
            <p>暂无会话</p>
            <button className="empty-action" onClick={onCreateSession}>
              创建新会话
            </button>
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={`session-item ${session.id === currentSessionId ? 'active' : ''}`}
              onClick={() => onSwitchSession(session.id)}
            >
              <div className="session-content">
                <div className="session-icon">💬</div>
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
              <button
                className="delete-session-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm('确定要删除这个会话吗？')) {
                    onDeleteSession(session.id)
                  }
                }}
                title="删除会话"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      {/* 提示 */}
      {sessions.length > 0 && (
        <div className="session-hint">
          <p>💡 双击会话名称可重命名</p>
        </div>
      )}
    </div>
  )
}
