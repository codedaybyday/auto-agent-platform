/**
 * Browser-use Tool Suite - 对齐开源 browser-use 设计
 *
 * 模块结构:
 * - core: 核心控制器 (BrowserController)
 * - dom: DOM 状态管理和获取
 * - security: 安全层 (SSRF防护等)
 */

// Core
export { BrowserController, browserController } from './core/controller.js'
export type { BrowserUseConfig } from './core/controller.js'

// DOM State - 类型和实现分开导出
export {
  formatDOMStateForLLM,
  classifyElementType,
  computeElementHash,
  computeCenter
} from './dom/dom-state.js'
export type { DOMState, ElementNode, BrowserAction, ActionResult, BoundingBox, Point, ElementType, ElementLookup } from './dom/dom-state.js'

// DOM Service
export { DOMService, domService } from './dom/dom-service.js'

// Security
export { BrowserSecurityGuard, defaultSecurityGuard, permissiveSecurityGuard, SecurityError } from './security/browser-security.js'
export type { SecurityPolicy, NavigationContext, SecurityCheckResult } from './security/browser-security.js'
