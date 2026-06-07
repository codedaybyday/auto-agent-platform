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
  // MCP Server 作为独立子进程时，使用用户主目录
  // 主进程中则使用 Electron 的 userData 路径
  if (isElectron() && process.type === 'browser') {
    // 主进程环境
    const { app } = require('electron')
    return join(app.getPath('userData'), 'mcp-config.json')
  }

  // 子进程环境（MCP Server 独立运行）
  return join(homedir(), '.auto-agent', 'mcp-config.json')
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
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}
