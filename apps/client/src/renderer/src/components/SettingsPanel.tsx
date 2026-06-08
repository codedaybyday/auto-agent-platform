import { useState, useEffect } from 'react'
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

/**
 * 设置面板组件
 * 显示工具说明、MCP 配置和使用提示
 */
export function SettingsPanel({
  isConnected
}: SettingsPanelProps): JSX.Element {
  const [saved, setSaved] = useState(false)
  const [config, setConfig] = useState<MCPUserConfig>({
    builtInTools: {
      browser: true,
      bash: true,
      file: true
    },
    userTools: []
  })
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'general' | 'mcp'>('general')

  // 加载 MCP 配置
  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const result = await window.api.agent.getMCPConfig()
      if (result.success && result.config) {
        setConfig(result.config)
      }
    } catch (error) {
      console.error('Failed to load MCP config:', error)
    } finally {
      setLoading(false)
    }
  }

  const saveConfig = async () => {
    try {
      const result = await window.api.agent.saveMCPConfig(config)
      if (result.success) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } else {
        alert('保存失败: ' + result.error)
      }
    } catch (error) {
      console.error('Failed to save MCP config:', error)
      alert('保存失败')
    }
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

  if (loading) {
    return (
      <div className="settings-panel">
        <h2>设置</h2>
        <div className="loading">加载中...</div>
      </div>
    )
  }

  return (
    <div className="settings-panel">
      <h2>设置</h2>

      {/* Tab 切换 */}
      <div className="settings-tabs">
        <button
          className={`tab-btn ${activeTab === 'general' ? 'active' : ''}`}
          onClick={() => setActiveTab('general')}
        >
          常规
        </button>
        <button
          className={`tab-btn ${activeTab === 'mcp' ? 'active' : ''}`}
          onClick={() => setActiveTab('mcp')}
        >
          MCP 工具
        </button>
      </div>

      {activeTab === 'general' ? (
        <>
          {/* 连接状态 */}
          <div className="setting-group">
            <label>连接状态</label>
            <p className="setting-description">
              AI 模型由服务端统一管理配置
            </p>

            {isConnected ? (
              <div className="connection-status connected">
                <span className="status-dot"></span>
                <span>已连接 - 服务端内置模型</span>
              </div>
            ) : (
              <div className="connection-status disconnected">
                <span className="status-dot"></span>
                <span>未连接</span>
              </div>
            )}
          </div>

          {/* 可用工具说明 */}
          <div className="setting-group">
            <h3>可用工具</h3>
            <div className="tools-list">
              <div className="tool-item">
                <div className="tool-item-header">
                  <span className="tool-icon">🖥️</span>
                  <span className="tool-name">终端</span>
                </div>
                <p className="tool-description">
                  在本地系统执行 bash 命令。可以浏览目录、运行脚本、查看文件等。
                </p>
              </div>

              <div className="tool-item">
                <div className="tool-item-header">
                  <span className="tool-icon">🌐</span>
                  <span className="tool-name">浏览器</span>
                </div>
                <p className="tool-description">
                  控制浏览器访问网页、点击元素、输入文字、截图、提取信息等。
                </p>
              </div>
            </div>
          </div>

          {/* 使用提示 */}
          <div className="setting-group">
            <h3>使用提示</h3>
            <ul className="tips-list">
              <li>描述越清晰，AI 执行效果越好</li>
              <li>AI 可以自动串联多个工具完成复杂任务</li>
              <li>使用 "清除历史" 可以开始新的对话</li>
            </ul>
          </div>
        </>
      ) : (
        <>
          {/* MCP 内置工具配置 */}
          <div className="setting-group">
            <h3>内置工具</h3>
            <p className="setting-description">
              启用或禁用内置工具。修改后需要重新启动应用生效。
            </p>

            <div className="tool-toggles">
              <label className="tool-toggle">
                <input
                  type="checkbox"
                  checked={config.builtInTools.browser}
                  onChange={() => toggleBuiltInTool('browser')}
                />
                <span className="toggle-label">
                  <span className="tool-icon">🌐</span>
                  浏览器自动化
                </span>
                <span className="toggle-description">
                  导航、点击、输入、截图、获取页面内容
                </span>
              </label>

              <label className="tool-toggle">
                <input
                  type="checkbox"
                  checked={config.builtInTools.bash}
                  onChange={() => toggleBuiltInTool('bash')}
                />
                <span className="toggle-label">
                  <span className="tool-icon">🖥️</span>
                  终端命令
                </span>
                <span className="toggle-description">
                  执行系统命令和脚本
                </span>
              </label>

              <label className="tool-toggle">
                <input
                  type="checkbox"
                  checked={config.builtInTools.file}
                  onChange={() => toggleBuiltInTool('file')}
                />
                <span className="toggle-label">
                  <span className="tool-icon">📁</span>
                  文件操作
                </span>
                <span className="toggle-description">
                  读取和写入文件
                </span>
              </label>
            </div>
          </div>

          {/* 用户自定义工具 */}
          <div className="setting-group">
            <h3>自定义工具</h3>
            <p className="setting-description">
              添加自定义命令行工具。AI 将能够通过命令调用这些工具。
            </p>

            <div className="user-tools-list">
              {config.userTools.map((tool, index) => (
                <div key={index} className="user-tool-item">
                  <div className="user-tool-header">
                    <input
                      type="text"
                      placeholder="工具名称"
                      value={tool.name}
                      onChange={(e) => updateUserTool(index, 'name', e.target.value)}
                      className="tool-input tool-name-input"
                    />
                    <button
                      className="remove-tool-btn"
                      onClick={() => removeUserTool(index)}
                      title="删除工具"
                    >
                      ×
                    </button>
                  </div>

                  <input
                    type="text"
                    placeholder="工具描述"
                    value={tool.description}
                    onChange={(e) => updateUserTool(index, 'description', e.target.value)}
                    className="tool-input"
                  />

                  <input
                    type="text"
                    placeholder="命令 (如: python, bash)"
                    value={tool.command || ''}
                    onChange={(e) => updateUserTool(index, 'command', e.target.value)}
                    className="tool-input"
                  />

                  <input
                    type="text"
                    placeholder="参数 (空格分隔)"
                    value={tool.args?.join(' ') || ''}
                    onChange={(e) => updateUserTool(index, 'args', e.target.value.split(' ').filter(Boolean))}
                    className="tool-input"
                  />

                  <input
                    type="text"
                    placeholder="工作目录 (可选)"
                    value={tool.workingDir || ''}
                    onChange={(e) => updateUserTool(index, 'workingDir', e.target.value)}
                    className="tool-input"
                  />
                </div>
              ))}

              <button className="add-tool-btn" onClick={addUserTool}>
                + 添加自定义工具
              </button>
            </div>
          </div>

          {/* 保存按钮 */}
          <div className="setting-group">
            <button
              className={`save-btn ${saved ? 'saved' : ''}`}
              onClick={saveConfig}
            >
              {saved ? '✓ 已保存' : '保存配置'}
            </button>
            <p className="save-hint">
              保存后需要重新启动应用才能生效
            </p>
          </div>
        </>
      )}
    </div>
  )
}
