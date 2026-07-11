import { useState, useEffect } from 'react'
import './SchedulePanel.css'

interface ScheduleItem {
  id: string
  name: string
  instruction: string
  cronExpr: string
  description: string
  enabled: boolean
  lastRunAt?: number
  nextRunAt: number
  sessionId?: string
  createdAt: number
}

const PRESETS = [
  { label: '每 5 分钟', expr: '*/5 * * * *' },
  { label: '每小时', expr: '0 * * * *' },
  { label: '每天 8:00', expr: '0 8 * * *' },
  { label: '每天 9:00', expr: '0 9 * * *' },
  { label: '每天 18:00', expr: '0 18 * * *' },
  { label: '每周一 8:00', expr: '0 8 * * 1' },
  { label: '每月 1 号', expr: '0 3 1 * *' },
]

function formatTime(ts?: number): string {
  if (!ts) return '从未执行'
  const d = new Date(ts)
  return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function SchedulePanel(): JSX.Element {
  const [schedules, setSchedules] = useState<ScheduleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formInstruction, setFormInstruction] = useState('')
  const [formCron, setFormCron] = useState('0 9 * * *')

  const loadSchedules = async () => {
    setLoading(true)
    try {
      const result = await window.api.agent.getSchedules()
      if (result.success && result.schedules) {
        setSchedules(result.schedules)
      }
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { loadSchedules() }, [])

  const resetForm = () => {
    setShowForm(false)
    setEditId(null)
    setFormName('')
    setFormInstruction('')
    setFormCron('0 9 * * *')
  }

  const handleSave = async () => {
    if (!formName.trim() || !formInstruction.trim()) return
    const data = { name: formName.trim(), instruction: formInstruction.trim(), cronExpr: formCron }

    if (editId) {
      await window.api.agent.updateSchedule({ id: editId, ...data })
    } else {
      await window.api.agent.createSchedule(data)
    }
    resetForm()
    loadSchedules()
  }

  const handleEdit = (s: ScheduleItem) => {
    setEditId(s.id)
    setFormName(s.name)
    setFormInstruction(s.instruction)
    setFormCron(s.cronExpr)
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除这个定时任务？')) return
    await window.api.agent.deleteSchedule(id)
    loadSchedules()
  }

  const handleToggle = async (id: string, enabled: boolean) => {
    await window.api.agent.toggleSchedule(id, enabled)
    loadSchedules()
  }

  return (
    <div className="schedule-panel">
      <div className="schedule-header">
        <div>
          <h3>⚡ 定时任务</h3>
          <p className="schedule-desc">创建定时自动执行的任务，Agent 会在指定时间自动运行</p>
        </div>
        <button className="schedule-add-btn" onClick={() => { resetForm(); setShowForm(true) }}>
          + 新建定时任务
        </button>
      </div>

      {showForm && (
        <div className="schedule-form-overlay" onClick={(e) => e.target === e.currentTarget && resetForm()}>
          <div className="schedule-form">
            <h4>{editId ? '编辑定时任务' : '新建定时任务'}</h4>

            <label>任务名称</label>
            <input
              type="text"
              value={formName}
              onChange={e => setFormName(e.target.value)}
              placeholder="如：每日新闻摘要"
            />

            <label>Agent 指令</label>
            <textarea
              value={formInstruction}
              onChange={e => setFormInstruction(e.target.value)}
              placeholder="输入 Agent 要执行的指令，如：打开百度搜索今日热点并总结"
              rows={3}
            />

            <label>执行时间</label>
            <div className="schedule-presets">
              {PRESETS.map(p => (
                <button
                  key={p.expr}
                  className={`preset-btn ${formCron === p.expr ? 'active' : ''}`}
                  onClick={() => setFormCron(p.expr)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              className="cron-input"
              value={formCron}
              onChange={e => setFormCron(e.target.value)}
              placeholder="或输入 cron: 分 时 日 月 周"
            />

            <div className="schedule-form-actions">
              <button className="cancel-btn" onClick={resetForm}>取消</button>
              <button className="save-btn" onClick={handleSave} disabled={!formName.trim() || !formInstruction.trim()}>
                {editId ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="schedule-list">
        {loading ? (
          <div className="schedule-empty">加载中...</div>
        ) : schedules.length === 0 ? (
          <div className="schedule-empty">
            <span className="empty-icon">⏰</span>
            <p>暂无定时任务</p>
            <p className="empty-hint">点击上方按钮创建你的第一个定时任务</p>
          </div>
        ) : (
          schedules.map(s => (
            <div key={s.id} className={`schedule-card ${s.enabled ? '' : 'disabled'}`}>
              <div className="schedule-card-header">
                <div className="schedule-card-name">
                  <span className={`status-dot ${s.enabled ? 'on' : 'off'}`} />
                  {s.name}
                </div>
                <div className="schedule-card-actions">
                  <button
                    className={`toggle-btn ${s.enabled ? 'on' : 'off'}`}
                    onClick={() => handleToggle(s.id, !s.enabled)}
                  >
                    {s.enabled ? '🟢 启用' : '🔴 禁用'}
                  </button>
                  <button className="icon-btn" onClick={() => handleEdit(s)} title="编辑">✏️</button>
                  <button className="icon-btn danger" onClick={() => handleDelete(s.id)} title="删除">🗑</button>
                </div>
              </div>

              <div className="schedule-card-body">
                <div className="schedule-info-row">
                  <span className="info-label">📋 指令</span>
                  <span className="info-value">{s.instruction}</span>
                </div>
                <div className="schedule-info-row">
                  <span className="info-label">⏰ 时间</span>
                  <span className="info-value">
                    <code>{s.cronExpr}</code>
                    <span className="info-desc">（{s.description}）</span>
                  </span>
                </div>
                <div className="schedule-info-row">
                  <span className="info-label">⬆ 上次</span>
                  <span className="info-value">{formatTime(s.lastRunAt)}</span>
                </div>
                <div className="schedule-info-row">
                  <span className="info-label">⬇ 下次</span>
                  <span className="info-value">{formatTime(s.nextRunAt)}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
