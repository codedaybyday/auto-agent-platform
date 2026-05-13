import { useState, useEffect } from 'react'
import './SettingsPanel.css'
import type { ModelConfig, ApiProtocol } from '@auto-agent/shared-types'

export type { ModelConfig, ApiProtocol } from '@auto-agent/shared-types'

/**
 * 预设模型配置列表
 * 内置常用模型的默认配置
 */
export const PRESET_MODELS: ModelConfig[] = [
  {
    id: 'claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    model: 'claude-3-5-sonnet-20241022',
    baseURL: 'https://api.anthropic.com',
    protocol: 'anthropic-messages',
    description: 'Anthropic 官方 API - Claude 3.5 Sonnet (推荐)'
  },
  {
    id: 'claude-3-opus',
    name: 'Claude 3 Opus',
    model: 'claude-3-opus-20240229',
    baseURL: 'https://api.anthropic.com',
    protocol: 'anthropic-messages',
    description: 'Anthropic 官方 API - Claude 3 Opus (最强性能)'
  },
  {
    id: 'claude-3-5-haiku',
    name: 'Claude 3.5 Haiku',
    model: 'claude-3-5-haiku-20241022',
    baseURL: 'https://api.anthropic.com',
    protocol: 'anthropic-messages',
    description: 'Anthropic 官方 API - Claude 3.5 Haiku (快速)'
  }
]

/** 自定义配置标识 */
export const CUSTOM_MODEL_ID = 'custom'

interface SettingsPanelProps {
  /** 当前保存的 API Key */
  apiKey: string
  /** 当前保存的模型配置 */
  modelConfig: ModelConfig
  /** 保存配置的回调函数 */
  onSaveConfig: (apiKey: string, modelConfig: ModelConfig) => void
  /** 是否已连接到 LLM */
  isConnected: boolean
}

/**
 * 设置面板组件
 * 用于配置 API Key 和模型参数
 */
export function SettingsPanel({
  apiKey,
  modelConfig,
  onSaveConfig,
  isConnected
}: SettingsPanelProps): JSX.Element {
  const [inputKey, setInputKey] = useState(apiKey)
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState(modelConfig.id || PRESET_MODELS[0].id)
  const [customConfig, setCustomConfig] = useState<ModelConfig>({
    id: CUSTOM_MODEL_ID,
    name: 'Custom',
    model: modelConfig.model || '',
    baseURL: modelConfig.baseURL || '',
    protocol: modelConfig.protocol || 'openai-chat-completion',
    description: 'Custom API configuration'
  })

  // 当外部配置变化时更新本地状态
  useEffect(() => {
    if (modelConfig.id === CUSTOM_MODEL_ID) {
      setCustomConfig(modelConfig)
    }
  }, [modelConfig])

  /**
   * 处理保存配置
   */
  const handleSave = () => {
    const config = selectedModelId === CUSTOM_MODEL_ID
      ? customConfig
      : PRESET_MODELS.find(m => m.id === selectedModelId) || PRESET_MODELS[0]

    onSaveConfig(inputKey.trim(), config)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // 验证配置是否有效
  const isValid = inputKey.trim() && (
    selectedModelId !== CUSTOM_MODEL_ID ||
    (customConfig.model.trim() && customConfig.baseURL.trim())
  )

  return (
    <div className="settings-panel">
      <h2>设置</h2>

      {/* API Key 配置 */}
      <div className="setting-group">
        <label>API 密钥</label>
        <p className="setting-description">
          输入你的 API Key 用于访问 AI 服务。密钥仅存储在本地。
        </p>

        <div className="api-key-input-group">
          <input
            type={showKey ? 'text' : 'password'}
            value={inputKey}
            onChange={(e) => setInputKey(e.target.value)}
            placeholder="sk-ant-api03-... 或 sk-..."
            className="api-key-input"
          />
          <button
            className="toggle-visibility-btn"
            onClick={() => setShowKey(!showKey)}
            title={showKey ? '隐藏密钥' : '显示密钥'}
          >
            {showKey ? '🙈' : '👁️'}
          </button>
        </div>
      </div>

      {/* 模型配置 */}
      <div className="setting-group">
        <label>模型配置</label>
        <p className="setting-description">
          选择预设模型或自定义 API 配置。支持 Claude、千问、DeepSeek 等模型。
        </p>

        <div className="model-selection">
          <select
            value={selectedModelId}
            onChange={(e) => setSelectedModelId(e.target.value)}
            className="model-select"
          >
            <optgroup label="预设模型">
              {PRESET_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="自定义">
              <option value={CUSTOM_MODEL_ID}>自定义配置</option>
            </optgroup>
          </select>

          {/* 预设模型信息展示 */}
          {selectedModelId !== CUSTOM_MODEL_ID && (
            <div className="model-info">
              {(() => {
                const model = PRESET_MODELS.find(m => m.id === selectedModelId)
                return model ? (
                  <>
                    <p><strong>模型:</strong> {model.model}</p>
                    <p><strong>API 地址:</strong> {model.baseURL}</p>
                    <p><strong>协议:</strong> {model.protocol === 'anthropic-messages' ? 'Messages API' : 'Chat Completions API'}</p>
                    <p className="model-desc">{model.description}</p>
                  </>
                ) : null
              })()}
            </div>
          )}

          {/* 自定义配置表单 */}
          {selectedModelId === CUSTOM_MODEL_ID && (
            <div className="custom-config">
              <div className="config-field">
                <label>模型名称 <span className="required">*</span></label>
                <input
                  type="text"
                  value={customConfig.model}
                  onChange={(e) => setCustomConfig({ ...customConfig, model: e.target.value })}
                  placeholder="例如: qwen-max, deepseek-chat, gpt-4"
                />
              </div>
              <div className="config-field">
                <label>API 地址 <span className="required">*</span></label>
                <input
                  type="text"
                  value={customConfig.baseURL}
                  onChange={(e) => setCustomConfig({ ...customConfig, baseURL: e.target.value })}
                  placeholder="例如: https://dashscope.aliyuncs.com/compatible-mode/v1"
                />
              </div>
              <div className="config-field">
                <label>API 协议 <span className="required">*</span></label>
                <select
                  value={customConfig.protocol}
                  onChange={(e) => setCustomConfig({ ...customConfig, protocol: e.target.value as ApiProtocol })}
                  className="protocol-select"
                >
                  <option value="openai-chat-completion">
                    OpenAI Chat Completions (千问、DeepSeek、OpenAI 等)
                  </option>
                  <option value="anthropic-messages">
                    Anthropic Messages (Claude 官方)
                  </option>
                </select>
                <p className="field-hint">
                  大多数国产模型选择 OpenAI Chat Completions 协议
                </p>
              </div>
              <div className="config-field">
                <label>显示名称 (可选)</label>
                <input
                  type="text"
                  value={customConfig.name}
                  onChange={(e) => setCustomConfig({ ...customConfig, name: e.target.value })}
                  placeholder="例如: 通义千问"
                />
              </div>
            </div>
          )}
        </div>

        <button
          className={`save-btn ${saved ? 'saved' : ''}`}
          onClick={handleSave}
          disabled={!isValid}
        >
          {saved ? '✓ 已保存' : '保存配置'}
        </button>

        {isConnected && (
          <div className="connection-status connected">
            <span className="status-dot"></span>
            <span>已连接 - {modelConfig.name}</span>
          </div>
        )}

        {!isConnected && apiKey && (
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
              <span className="tool-name">Bash</span>
            </div>
            <p className="tool-description">
              在本地系统执行 bash 命令。可以浏览目录、运行脚本、查看文件等。
            </p>
          </div>

          <div className="tool-item">
            <div className="tool-item-header">
              <span className="tool-icon">🌐</span>
              <span className="tool-name">Browser</span>
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
          <li>支持千问、DeepSeek、Claude、OpenAI 等多种模型</li>
          <li>使用 "清除历史" 可以开始新的对话</li>
        </ul>
      </div>
    </div>
  )
}
