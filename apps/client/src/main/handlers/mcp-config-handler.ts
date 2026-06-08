/**
 * MCP 配置 IPC 处理程序
 * 处理渲染进程的 MCP 配置读写请求
 */

import { ipcMain } from 'electron'
import { loadMCPConfig, saveMCPConfig, MCPUserConfig } from '../service/mcp/config.js'
import { log } from '@auto-agent/shared-utils'

export function setupMCPConfigHandlers(): void {
  // 获取 MCP 配置
  ipcMain.handle('mcp:get_config', async () => {
    try {
      const config = loadMCPConfig()
      return { success: true, config }
    } catch (error) {
      log.error('MCPConfig', 'Failed to load config:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load config'
      }
    }
  })

  // 保存 MCP 配置
  ipcMain.handle('mcp:save_config', async (_event, config: MCPUserConfig) => {
    try {
      saveMCPConfig(config)
      log.info('MCPConfig', 'Config saved successfully')
      return { success: true }
    } catch (error) {
      log.error('MCPConfig', 'Failed to save config:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save config'
      }
    }
  })
}
