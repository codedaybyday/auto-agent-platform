import { useState, useRef, useEffect } from 'react'
import './StepPanel.css'

export interface StepInfo {
  id: string
  index: number
  description: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolDuration?: number
  success?: boolean
  error?: string
  status: 'running' | 'completed' | 'failed'
  timestamp: number
}

interface StepPanelProps {
  steps: StepInfo[]
  isProcessing: boolean
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatArgs(args?: Record<string, unknown>): string {
  if (!args) return ''
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return String(args)
  }
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return ''
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function StepPanel({ steps, isProcessing }: StepPanelProps): JSX.Element | null {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [steps])

  if (steps.length === 0 && !isProcessing) return null

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <span className="step-spinner" />
      case 'completed':
        return <span className="step-icon-done">✓</span>
      case 'failed':
        return <span className="step-icon-error">✗</span>
      default:
        return null
    }
  }

  return (
    <div className="step-panel" ref={containerRef}>
      <div className="step-header">
        <span className="step-title">📋 处理步骤</span>
        {isProcessing && <span className="step-count-badge">进行中</span>}
        <span className="step-total">{steps.length} 步</span>
      </div>
      <div className="step-list">
        {steps.map((step) => {
          const isExpanded = expandedIds.has(step.id)

          return (
            <div
              key={step.id}
              className={`step-item ${step.status} ${isExpanded ? 'expanded' : ''}`}
            >
              <div className="step-item-header" onClick={() => toggleExpand(step.id)}>
                {statusIcon(step.status)}
                <span className="step-label">{step.description}</span>
                {step.toolDuration !== undefined && (
                  <span className="step-duration">{formatDuration(step.toolDuration)}</span>
                )}
                <span className="step-expand-icon">{isExpanded ? '▾' : '▸'}</span>
              </div>
              {isExpanded && (
                <div className="step-item-detail">
                  {step.toolName && (
                    <div className="step-detail-row">
                      <span className="step-detail-label">工具</span>
                      <code className="step-detail-value">{step.toolName}</code>
                    </div>
                  )}
                  {step.toolArgs && Object.keys(step.toolArgs).length > 0 && (
                    <div className="step-detail-section">
                      <div className="step-detail-label">参数</div>
                      <pre>{formatArgs(step.toolArgs)}</pre>
                    </div>
                  )}
                  {step.error && (
                    <div className="step-detail-section">
                      <div className="step-detail-label">错误信息</div>
                      <pre className="error">{step.error}</pre>
                    </div>
                  )}
                  <div className="step-detail-row">
                    <span className="step-detail-label">时间</span>
                    <span className="step-detail-value">{formatTime(step.timestamp)}</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
