import { useState } from 'react'
import './SettingsPanel.css'

interface SettingsPanelProps {
  /** 是否已连接到服务器 */
  isConnected: boolean
}

/**
 * 设置面板组件
 * 显示工具说明和使用提示（模型配置已移至服务端）
 */
export function SettingsPanel({
  isConnected
}: SettingsPanelProps): JSX.Element {
  const [saved] = useState(false)

  return (
    <div className="settings-panel">
      <h2>设置</h2>

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

        <button
          className={`save-btn ${saved ? 'saved' : ''}`}
          disabled
        >
          {saved ? '✓ 已保存' : '服务端已配置'}
        </button>
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
    </div>
  )
}
