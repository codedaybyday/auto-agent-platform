import { useState, useEffect, useMemo } from 'react'
import './SettingsPanel.css'

interface SettingsPanelProps {
  /** 是否已连接到服务器 */
  isConnected: boolean
}

interface MCPUserConfig {
  builtInTools: {
    browser: boolean
    bash: boolean
    file: boolean
  }
  userTools: Array<{
    name: string
    description: string
    command?: string
    args?: string[]
    workingDir?: string
    script?: string
    function?: string
  }>
}

type SettingCategory = 'general' | 'builtin-tools' | 'custom-tools'

/**
 * 设置面板组件 - VSCode 风格
 * 左右分栏布局，左侧导航，右侧内容
 */
export function SettingsPanel({
  isConnected
}: SettingsPanelProps): JSX.Element {
  const [config, setConfig] = useState<MCPUserConfig>({
    builtInTools: {
      browser: true,
      bash: true,
      file: true
    },
    userTools: []
  })
  const [originalConfig, setOriginalConfig] = useState<MCPUserConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [activeCategory, setActiveCategory] = useState<SettingCategory>('general')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedTool, setExpandedTool] = useState<string | null>(null)

  // 加载 MCP 配置
  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const result = await window.api.agent.getMCPConfig()
      if (result.success && result.config) {
        setConfig(result.config)
        setOriginalConfig(JSON.parse(JSON.stringify(result.config)))
      }
    } catch (error) {
      console.error('Failed to load MCP config:', error)
    } finally {
      setLoading(false)
    }
  }

  const saveConfig = async () => {
    setSaving(true)
    try {
      const result = await window.api.agent.saveMCPConfig(config)
      if (result.success) {
        setOriginalConfig(JSON.parse(JSON.stringify(config)))
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } else {
        alert('保存失败: ' + result.error)
      }
    } catch (error) {
      console.error('Failed to save MCP config:', error)
      alert('保存失败')
    } finally {
      setSaving(false)
    }
  }

  // 检查是否有未保存的更改
  const hasChanges = useMemo(() => {
    if (!originalConfig) return false
    return JSON.stringify(config) !== JSON.stringify(originalConfig)
  }, [config, originalConfig])

  // 检查内置工具是否被修改
  const isBuiltInToolModified = (tool: keyof MCPUserConfig['builtInTools']) => {
    if (!originalConfig) return false
    return config.builtInTools[tool] !== originalConfig.builtInTools[tool]
  }

  const toggleBuiltInTool = (tool: keyof MCPUserConfig['builtInTools']) => {
    setConfig(prev => ({
      ...prev,
      builtInTools: {
        ...prev.builtInTools,
        [tool]: !prev.builtInTools[tool]
      }
    }))
  }

  const addUserTool = () => {
    setConfig(prev => ({
      ...prev,
      userTools: [
        ...prev.userTools,
        {
          name: '',
          description: '',
          command: '',
          args: []
        }
      ]
    }))
    // 展开新添加的工具
    setTimeout(() => {
      const newIndex = config.userTools.length
      setExpandedTool(`custom-${newIndex}`)
    }, 0)
  }

  const updateUserTool = (index: number, field: string, value: string | string[]) => {
    setConfig(prev => ({
      ...prev,
      userTools: prev.userTools.map((tool, i) =>
        i === index ? { ...tool, [field]: value } : tool
      )
    }))
  }

  const removeUserTool = (index: number) => {
    setConfig(prev => ({
      ...prev,
      userTools: prev.userTools.filter((_, i) => i !== index)
    }))
  }

  // 过滤自定义工具
  const filteredUserTools = useMemo(() => {
    if (!searchQuery.trim()) return config.userTools
    const query = searchQuery.toLowerCase()
    return config.userTools.filter(tool =>
      tool.name.toLowerCase().includes(query) ||
      tool.description.toLowerCase().includes(query)
    )
  }, [config.userTools, searchQuery])

  // 是否显示搜索无结果
  const showNoResults = searchQuery.trim() &&
    !['general', 'builtin', 'custom'].some(cat =>
      cat.includes(searchQuery.toLowerCase())
    ) &&
    filteredUserTools.length === 0

  if (loading) {
    return (
      <div className="settings-container">
        <div className="loading">加载中...</div>
      </div>
    )
  }

  return (
    <div className="settings-container">
      {/* 左侧导航栏 */}
      <aside className="settings-sidebar">
        <div className="sidebar-header">
          <h2>设置</h2>
        </div>
        <nav className="sidebar-nav">
          <button
            className={`nav-item ${activeCategory === 'general' ? 'active' : ''}`}
            onClick={() => setActiveCategory('general')}
          >
            <span className="nav-icon">⚙️</span>
            <span className="nav-label">常规</span>
          </button>
          <button
            className={`nav-item ${activeCategory === 'builtin-tools' ? 'active' : ''}`}
            onClick={() => setActiveCategory('builtin-tools')}
          >
            <span className="nav-icon">🛠️</span>
            <span className="nav-label">内置工具</span>
            {(['browser', 'bash', 'file'] as const).some(isBuiltInToolModified) && (
              <span className="nav-modified-indicator" />
            )}
          </button>
          <button
            className={`nav-item ${activeCategory === 'custom-tools' ? 'active' : ''}`}
            onClick={() => setActiveCategory('custom-tools')}
          >
            <span className="nav-icon">🔧</span>
            <span className="nav-label">自定义工具</span>
            {config.userTools.length > 0 && (
              <span className="nav-badge">{config.userTools.length}</span>
            )}
          </button>
        </nav>
      </aside>

      {/* 右侧内容区 */}
      <main className="settings-content">
        {/* 顶部工具栏 */}
        <div className="settings-toolbar">
          <div className="search-box">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              placeholder="搜索设置..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="search-clear" onClick={() => setSearchQuery('')}>
                ×
              </button>
            )}
          </div>
          <div className="toolbar-actions">
            {hasChanges && (
              <span className="unsaved-indicator">有未保存的更改</span>
            )}
            <button
              className={`save-btn ${saved ? 'saved' : ''} ${saving ? 'saving' : ''}`}
              onClick={saveConfig}
              disabled={saving || !hasChanges}
            >
              {saving ? '保存中...' : saved ? '✓ 已保存' : '保存'}
            </button>
          </div>
        </div>

        {/* 设置内容 */}
        <div className="settings-scroll-area">
          {showNoResults ? (
            <div className="no-results">
              <span className="no-results-icon">🔍</span>
              <p>没有找到匹配 "{searchQuery}" 的设置</p>
            </div>
          ) : (
            <>
              {/* 常规设置 */}
              {(activeCategory === 'general' || searchQuery.includes('general') || searchQuery.includes('常规')) && (
                <section className="settings-section">
                  <h3 className="section-title">常规</h3>

                  {/* 连接状态 */}
                  <div className="setting-item">
                    <div className="setting-header">
                      <span className="setting-title">连接状态</span>
                    </div>
                    <p className="setting-description">
                      AI 模型由服务端统一管理配置
                    </p>
                    <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
                      <span className="status-dot" />
                      <span className="status-text">
                        {isConnected ? '已连接 - 服务端内置模型' : '未连接'}
                      </span>
                    </div>
                  </div>

                  {/* 使用提示 */}
                  <div className="setting-item">
                    <div className="setting-header">
                      <span className="setting-title">使用提示</span>
                    </div>
                    <ul className="tips-list">
                      <li>描述越清晰，AI 执行效果越好</li>
                      <li>AI 可以自动串联多个工具完成复杂任务</li>
                      <li>使用 "清除历史" 可以开始新的对话</li>
                    </ul>
                  </div>
                </section>
              )}

              {/* 内置工具 */}
              {(activeCategory === 'builtin-tools' || searchQuery.includes('tool') || searchQuery.includes('工具')) && (
                <section className="settings-section">
                  <h3 className="section-title">内置工具</h3>
                  <p className="section-description">
                    启用或禁用内置工具。修改后需要重新启动应用生效。
                  </p>

                  <div className="setting-items-list">
                    {/* 浏览器工具 */}
                    <div className={`setting-item-card ${isBuiltInToolModified('browser') ? 'modified' : ''}`}>
                      <div className="setting-item-content">
                        <div className="setting-item-main">
                          <div className="setting-item-icon">🌐</div>
                          <div className="setting-item-info">
                            <div className="setting-item-title-row">
                              <span className="setting-item-title">浏览器自动化</span>
                              {isBuiltInToolModified('browser') && (
                                <span className="modified-badge">已修改</span>
                              )}
                            </div>
                            <p className="setting-item-desc">
                              导航、点击、输入、截图、获取页面内容
                            </p>
                          </div>
                        </div>
                        <label className="toggle-switch">
                          <input
                            type="checkbox"
                            checked={config.builtInTools.browser}
                            onChange={() => toggleBuiltInTool('browser')}
                          />
                          <span className="toggle-slider" />
                        </label>
                      </div>
                    </div>

                    {/* 终端工具 */}
                    <div className={`setting-item-card ${isBuiltInToolModified('bash') ? 'modified' : ''}`}>
                      <div className="setting-item-content">
                        <div className="setting-item-main">
                          <div className="setting-item-icon">🖥️</div>
                          <div className="setting-item-info">
                            <div className="setting-item-title-row">
                              <span className="setting-item-title">终端命令</span>
                              {isBuiltInToolModified('bash') && (
                                <span className="modified-badge">已修改</span>
                              )}
                            </div>
                            <p className="setting-item-desc">
                              执行系统命令和脚本
                            </p>
                          </div>
                        </div>
                        <label className="toggle-switch">
                          <input
                            type="checkbox"
                            checked={config.builtInTools.bash}
                            onChange={() => toggleBuiltInTool('bash')}
                          />
                          <span className="toggle-slider" />
                        </label>
                      </div>
                    </div>

                    {/* 文件工具 */}
                    <div className={`setting-item-card ${isBuiltInToolModified('file') ? 'modified' : ''}`}>
                      <div className="setting-item-content">
                        <div className="setting-item-main">
                          <div className="setting-item-icon">📁</div>
                          <div className="setting-item-info">
                            <div className="setting-item-title-row">
                              <span className="setting-item-title">文件操作</span>
                              {isBuiltInToolModified('file') && (
                                <span className="modified-badge">已修改</span>
                              )}
                            </div>
                            <p className="setting-item-desc">
                              读取和写入文件
                            </p>
                          </div>
                        </div>
                        <label className="toggle-switch">
                          <input
                            type="checkbox"
                            checked={config.builtInTools.file}
                            onChange={() => toggleBuiltInTool('file')}
                          />
                          <span className="toggle-slider" />
                        </label>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* 自定义工具 */}
              {(activeCategory === 'custom-tools' || searchQuery.includes('custom') || searchQuery.includes('自定义')) && (
                <section className="settings-section">
                  <div className="section-header-with-action">
                    <div>
                      <h3 className="section-title">自定义工具</h3>
                      <p className="section-description">
                        添加自定义命令行工具。AI 将能够通过命令调用这些工具。
                      </p>
                    </div>
                    <button className="add-btn" onClick={addUserTool}>
                      <span className="add-btn-icon">+</span>
                      添加工具
                    </button>
                  </div>

                  {config.userTools.length === 0 ? (
                    <div className="empty-state">
                      <span className="empty-icon">🔧</span>
                      <p>还没有自定义工具</p>
                      <button className="add-btn secondary" onClick={addUserTool}>
                        添加第一个工具
                      </button>
                    </div>
                  ) : (
                    <div className="custom-tools-list">
                      {filteredUserTools.map((tool, index) => (
                        <div
                          key={index}
                          className={`custom-tool-card ${!tool.name ? 'incomplete' : ''}`}
                        >
                          <div
                            className="custom-tool-header"
                            onClick={() => setExpandedTool(
                              expandedTool === `custom-${index}` ? null : `custom-${index}`
                            )}
                          >
                            <div className="custom-tool-title-area">
                              <span className="custom-tool-icon">🔧</span>
                              <div className="custom-tool-title-info">
                                <span className="custom-tool-name">
                                  {tool.name || '未命名工具'}
                                </span>
                                {tool.description && (
                                  <span className="custom-tool-preview">{tool.description}</span>
                                )}
                              </div>
                            </div>
                            <div className="custom-tool-actions">
                              <button
                                className="icon-btn delete"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  removeUserTool(index)
                                }}
                                title="删除工具"
                              >
                                🗑️
                              </button>
                              <span className={`expand-icon ${expandedTool === `custom-${index}` ? 'expanded' : ''}`}>
                                ▼
                              </span>
                            </div>
                          </div>

                          {expandedTool === `custom-${index}` && (
                            <div className="custom-tool-form">
                              <div className="form-row">
                                <label className="form-label">
                                  工具名称
                                  <span className="required">*</span>
                                </label>
                                <input
                                  type="text"
                                  placeholder="例如: my-script"
                                  value={tool.name}
                                  onChange={(e) => updateUserTool(index, 'name', e.target.value)}
                                  className="form-input"
                                />
                              </div>

                              <div className="form-row">
                                <label className="form-label">
                                  描述
                                  <span className="required">*</span>
                                </label>
                                <input
                                  type="text"
                                  placeholder="描述这个工具的作用"
                                  value={tool.description}
                                  onChange={(e) => updateUserTool(index, 'description', e.target.value)}
                                  className="form-input"
                                />
                              </div>

                              <div className="form-row">
                                <label className="form-label">
                                  命令
                                  <span className="required">*</span>
                                </label>
                                <input
                                  type="text"
                                  placeholder="例如: python, bash, node"
                                  value={tool.command || ''}
                                  onChange={(e) => updateUserTool(index, 'command', e.target.value)}
                                  className="form-input"
                                />
                              </div>

                              <div className="form-row">
                                <label className="form-label">参数</label>
                                <input
                                  type="text"
                                  placeholder="空格分隔的参数 (可选)"
                                  value={tool.args?.join(' ') || ''}
                                  onChange={(e) => updateUserTool(index, 'args', e.target.value.split(' ').filter(Boolean))}
                                  className="form-input"
                                />
                              </div>

                              <div className="form-row">
                                <label className="form-label">工作目录</label>
                                <input
                                  type="text"
                                  placeholder="可选，默认为当前目录"
                                  value={tool.workingDir || ''}
                                  onChange={(e) => updateUserTool(index, 'workingDir', e.target.value)}
                                  className="form-input"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      ))}

                      {filteredUserTools.length === 0 && searchQuery && (
                        <div className="no-results">
                          <p>没有找到匹配 "{searchQuery}" 的自定义工具</p>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
