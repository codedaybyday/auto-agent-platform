/**
 * MCP 服务入口
 * 统一导出 MCP 相关功能
 */

// Registry
export {
  ToolRegistry,
  toolRegistry,
  type RegisteredTool,
  type BuiltinToolExecutor,
  type BuiltinToolResult,
  type ToolExecutionContext,
  zodToJsonSchema
} from './registry.js'

// Hub (MCP Client 管理)
export {
  MCPHub,
  mcpHub,
  type MCPServerConfig
} from './hub.js'

// Tool Bridge
export {
  MCPToolBridge,
  type ToolBridgeConfig
} from './tool-bridge.js'
