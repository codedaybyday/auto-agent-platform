# Browser AI 工具实现文档

## 概述

基于 Playwright 实现了 AI 友好的浏览器自动化工具，参考 OpenClaw 设计，添加了 Snapshot 系统和安全层。

## 已完成功能

### P0: Snapshot 系统 + 元素稳定引用 ✅

**文件**: `apps/client/src/main/tools/browser-snapshot.ts`

#### 三种 Snapshot 格式

| 格式 | 用途 | 示例 |
|------|------|------|
| `role` | 通用 UI 自动化 | `e1`, `e2`, `e3` |
| `aria` | 跨调用稳定引用 | `ax1`, `ax2`, `ax3` |
| `ai` | AI 优化的页面描述 | 文本格式摘要 |

#### 核心功能

```typescript
// 捕获 Snapshot
const snapshot = await browserAI.captureSnapshot('role')

// 通过 ref 执行操作
await browserAI.clickByRef('e5')
await browserAI.typeByRef('e3', 'search text')

// 获取 AI 友好的页面摘要
const summary = await browserAI.getPageSummary()
```

#### Snapshot 数据结构

```typescript
interface PageSnapshot {
  url: string
  title: string
  format: 'role' | 'aria' | 'ai'
  timestamp: number
  elements: SnapshotElement[]
  stats: {
    totalElements: number
    interactiveElements: number
    links: number
    buttons: number
    inputs: number
    forms: number
  }
}

interface SnapshotElement {
  tag: string
  role?: string
  name?: string
  text?: string
  ref?: string        // 稳定引用 (e12, ax5)
  inputType?: string
  placeholder?: string
  href?: string
  boundingBox?: { x, y, width, height }
  // ... 其他属性
}
```

### P1: 安全层 ✅

**文件**: `apps/client/src/main/tools/browser-security.ts`

#### 安全策略

```typescript
interface SecurityPolicy {
  allowedHostnames?: string[]      // 主机名白名单
  allowedProtocols?: string[]      // 允许的协议
  blockedProtocols?: string[]      // 禁止的协议
  allowPrivateNetworks?: boolean   // 是否允许私有网络
  privateNetworkCIDRs?: string[]   // 私有网络 CIDR
  allowedPorts?: number[]          // 允许的端口
  blockedPorts?: number[]          // 禁止的端口（默认包含危险端口）
  checkRedirectChain?: boolean     // 是否检查重定向链
  maxRedirects?: number            // 最大重定向深度
}
```

#### 默认阻止的内容

**协议**:
- `file:` - 本地文件访问
- `javascript:` - JavaScript 代码执行
- `data:` - Data URI
- `vbscript:` - VBScript

**私有网络**:
- `localhost`, `127.0.0.1`, `::1`
- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- `169.254.0.0/16` (Link-local)
- IPv6 私有地址

**危险端口**:
- 系统服务: 22 (SSH), 23 (Telnet), 25 (SMTP)
- 数据库: 3306 (MySQL), 5432 (PostgreSQL), 27017 (MongoDB)
- 内部服务: 53 (DNS), 123 (NTP)

#### 使用方式

```typescript
// 严格模式（默认）
import { defaultSecurityGuard } from './browser-security.js'
const browser = new BrowserAI({
  securityGuard: defaultSecurityGuard
})

// 宽松模式（仅阻止危险协议）
import { permissiveSecurityGuard } from './browser-security.js'
const browser = new BrowserAI({
  securityGuard: permissiveSecurityGuard
})

// 自定义策略
import { BrowserSecurityGuard } from './browser-security.js'
const customGuard = new BrowserSecurityGuard({
  allowPrivateNetworks: false,
  allowedHostnames: ['example.com', '*.example.com'],
  blockedProtocols: ['file:', 'javascript:']
})
```

### P1: 操作历史追踪 ✅

**文件**: `apps/client/src/main/tools/browser-ai.ts`

```typescript
// 获取操作历史
const history = browserAI.getActionHistory()

// 历史记录格式
interface BrowserAction {
  action: 'navigate' | 'click' | 'type' | ...
  params: Record<string, any>
  timestamp?: number
  success?: boolean
  error?: string
}
```

## 增强的 BrowserAI 类

**文件**: `apps/client/src/main/tools/browser-ai.ts`

### 配置选项

```typescript
interface BrowserAIConfig {
  headless?: boolean              // 是否无头模式
  securityGuard?: BrowserSecurityGuard  // 安全守卫
  snapshotFormat?: SnapshotFormat // Snapshot 格式
  enableSnapshots?: boolean       // 是否启用自动 Snapshot
  maxRetries?: number             // 操作失败重试次数
}
```

### API 方法

```typescript
class BrowserAI {
  // 初始化
  async initialize(headless?: boolean): Promise<void>

  // 语义化操作
  async semanticAct(instruction: string): Promise<{ success: boolean; result: string }>

  // Snapshot 相关
  async captureSnapshot(format?: SnapshotFormat): Promise<PageSnapshot>
  getCurrentSnapshot(): PageSnapshot | null

  // 通过 ref 操作（稳定引用）
  async clickByRef(ref: string): Promise<{ success: boolean; result: string }>
  async typeByRef(ref: string, text: string): Promise<{ success: boolean; result: string }>

  // 页面信息
  async getPageSummary(): Promise<string>
  async analyzePage(): Promise<PageAnalysis>

  // 数据提取
  async extractData<T>(schema: {...}): Promise<{ success: boolean; data?: T; error?: string }>

  // 导航
  async back(): Promise<void>
  async forward(): Promise<void>

  // 历史
  getActionHistory(): BrowserAction[]

  // 清理
  async close(): Promise<void>
}
```

### 语义化指令支持

```typescript
// 导航
await browserAI.semanticAct('go to example.com')
await browserAI.semanticAct('navigate to https://github.com')

// 点击
await browserAI.semanticAct('click Submit')
await browserAI.semanticAct('click on "Sign in"')

// 输入
await browserAI.semanticAct('type "hello" in search box')
await browserAI.semanticAct('type password in password field')

// 搜索
await browserAI.semanticAct('search for TypeScript')

// 滚动
await browserAI.semanticAct('scroll down')
await browserAI.semanticAct('scroll up')

// 截图
await browserAI.semanticAct('screenshot')
await browserAI.semanticAct('take full page screenshot')

// 等待
await browserAI.semanticAct('wait 2000')
```

## 测试

**文件**: `apps/client/src/main/tools/test-browser-ai.ts`

```bash
# 运行测试
cd apps/client
npx tsx src/main/tools/test-browser-ai.ts
```

测试内容：
1. Snapshot 系统测试
2. 安全层测试（SSRF 防护）
3. 语义化操作测试

## 与现有 BrowserTool 的对比

| 特性 | BrowserTool (原有) | BrowserAI (新) |
|------|-------------------|----------------|
| 操作方式 | 结构化参数 | 语义化指令 |
| 元素定位 | CSS 选择器 | 稳定 ref + 智能查找 |
| Snapshot | ❌ | ✅ 三种格式 |
| 安全层 | ❌ | ✅ SSRF 防护 |
| 操作历史 | ❌ | ✅ 完整追踪 |
| AI 友好度 | ⭐⭐ | ⭐⭐⭐⭐⭐ |

## 使用示例

### 基础使用

```typescript
import { BrowserAI } from './tools/browser-ai.js'

const browser = new BrowserAI({
  enableSnapshots: true,
  snapshotFormat: 'role'
})

// 打开浏览器
await browser.initialize()

// 导航
await browser.semanticAct('go to github.com')

// 获取页面信息
const summary = await browser.getPageSummary()
console.log(summary)

// 执行操作
await browser.semanticAct('click Sign in')

// 关闭
await browser.close()
```

### 在 Agent Loop 中使用

```typescript
// 在 tool-bridge 或客户端工具中
import { browserAI } from './tools/browser-ai.js'

// 处理 browser 工具调用
async function executeBrowserTool(args: any) {
  if (args.action === 'semantic') {
    return browserAI.semanticAct(args.instruction)
  }

  if (args.action === 'clickByRef') {
    return browserAI.clickByRef(args.ref)
  }

  if (args.action === 'getPageSummary') {
    const summary = await browserAI.getPageSummary()
    return { success: true, result: summary }
  }

  // ... 其他操作
}
```

## 后续计划

### P2: 增强功能
- [ ] SSRF 重定向链深度检查
- [ ] 自动重试机制（Stale ref 恢复）
- [ ] 性能指标收集

### P3: 高级功能
- [ ] 多 Profile 支持
- [ ] 远程浏览器代理
- [ ] Console/Network 监控

## 参考

- OpenClaw Browser: https://github.com/openclaw-ai/openclaw
- Playwright: https://playwright.dev
