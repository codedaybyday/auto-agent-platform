/**
 * Bash Tools - 统一入口
 */

export { BashTool, createBashTool, bashTool } from './bash-tool.js'
export { sessionManager } from './session-manager.js'
export { BashSecurity } from './security.js'
export { processRegistry } from './process-registry.js'
export type {
  BashInput,
  BashOutput,
  SecurityPolicy,
  ProcessInfo,
  ShellSessionState,
  UserConfirmationCallback
} from './types.js'
