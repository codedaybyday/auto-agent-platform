/**
 * MCP 用户配置管理
 * 支持用户通过配置文件扩展工具
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

// 检测是否在 Electron 环境中
function isElectron(): boolean {
  return process.versions.hasOwnProperty('electron')
}

export interface UserTool {
  name: string
  description: string
  // 命令行方式
  command?: string
  args?: string[]
  workingDir?: string
  env?: Record<string, string>
  // JS 模块方式
  script?: string
  function?: string
}

export interface MCPUserConfig {
  // 内置工具开关
  builtInTools: {
    browser: boolean
    bash: boolean
    file: boolean
  }
  // 用户自定义工具
  userTools: UserTool[]
}

const DEFAULT_CONFIG: MCPUserConfig = {
  builtInTools: {
    browser: true,
    bash: true,
    file: true
  },
  userTools: []
}

export function getMCPConfigPath(): string {
  // 统一使用 ~/Library/Application Support/AutoAgent/mcp-config.json
  // 主进程和子进程（MCP Server）都使用相同路径
  const userDataPath = process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'AutoAgent')
    : join(homedir(), '.auto-agent')
  return join(userDataPath, 'mcp-config.json')
}

export function loadMCPConfig(): MCPUserConfig {
  const configPath = getMCPConfigPath()

  if (!existsSync(configPath)) {
    // 创建默认配置
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8')
    return DEFAULT_CONFIG
  }

  try {
    const content = readFileSync(configPath, 'utf-8')
    return { ...DEFAULT_CONFIG, ...JSON.parse(content) }
  } catch (error) {
    console.error('[MCP Config] Failed to load config, using default:', error)
    return DEFAULT_CONFIG
  }
}

export function saveMCPConfig(config: MCPUserConfig): void {
  const configPath = getMCPConfigPath()
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}
