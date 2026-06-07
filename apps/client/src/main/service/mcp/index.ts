/**
 * MCP Service
 * 统一导出 MCP 相关功能
 */

export { loadMCPConfig, saveMCPConfig, getMCPConfigPath } from './config.js'
export type { MCPUserConfig, UserTool } from './config.js'
export { startMCPServer } from './server.js'
