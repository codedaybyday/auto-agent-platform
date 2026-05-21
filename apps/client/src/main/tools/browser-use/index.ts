/**
 * Browser-use Tool Suite
 * AI友好的浏览器自动化工具集
 *
 * 模块结构:
 * - core: 核心控制器 (BrowserUse)
 * - dom: DOM 操作和序列化
 * - locator: 元素定位策略
 * - security: 安全层 (SSRF防护等)
 * - snapshot: 页面快照和Accessibility Tree
 */

// Core
export { BrowserUse, browserUse } from './core/controller.js'
export type { BrowserUseConfig, BrowserAction, PageElement, PageAnalysis } from './core/controller.js'

// DOM
export { DOMSerializer, domSerializer } from './dom/dom-serializer.js'
export type { SerializedDOM, SerializedElement, DOMSerializerOptions } from './dom/dom-serializer.js'
export { browserUseDOM, BrowserUseDOMService } from './dom/browser-use-dom.js'
export type { BrowserUseElement } from './dom/browser-use-dom.js'
export { ElementHashMap, computeElementHash, extractElementSignature, getXPath } from './dom/element-hash.js'
export type { ElementSignature, ElementBounds } from './dom/element-hash.js'

// Locator
export { RobustLocator, robustLocator } from './locator/robust-locator.js'
export type { LocationResult as RobustLocationResult } from './locator/robust-locator.js'
export { SmartLocator, smartLocator } from './locator/smart-locator.js'
export type { ElementDescription, LocationResult as SmartLocationResult } from './locator/smart-locator.js'

// Security
export { BrowserSecurityGuard, defaultSecurityGuard, permissiveSecurityGuard, SecurityError } from './security/browser-security.js'
export type { SecurityPolicy, NavigationContext, SecurityCheckResult } from './security/browser-security.js'

// Snapshot
export { SnapshotManager, snapshotManager } from './snapshot/browser-snapshot.js'
export type { PageSnapshot, SnapshotElement, SnapshotOptions, SnapshotFormat } from './snapshot/browser-snapshot.js'
export { AccessibilityTreeService, accessibilityService } from './snapshot/accessibility-tree.js'
export type { InteractiveElement } from './snapshot/accessibility-tree.js'
