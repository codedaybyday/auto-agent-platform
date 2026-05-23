# Agent Browser 集成文档

## 概述

本项目已集成 `agent-browser` 替代原有的自定义 browser-ai 实现，提供更完整的浏览器自动化能力。

## 架构变化

### 之前
```
Server (AgentLoop) 
  -> ToolBridge 
    -> WebSocket 
      -> Client (BrowserAI + BrowserManager)
        -> Playwright CDP
          -> Chrome
```

### 之后
```
Server (AgentLoop) 
  -> ToolBridge 
    -> WebSocket 
      -> Client (AgentBrowserService)
        -> agent-browser daemon
          -> Playwright
            -> Chrome
```

## 主要改进

1. **更完整的浏览器控制能力**
   - 80+ 浏览器动作（click, type, scroll, screenshot 等）
   - 批量动作规划与执行
   - 视频录制和实时投屏

2. **更好的元素定位**
   - Snapshot + Refs 系统（类似 browser-use）
   - 自动元素编号（e1, e2, e3...）
   - 支持多种定位策略

3. **云服务支持**
   - Browserbase
   - Kernel
   - Browser Use Cloud

4. **保留的安全特性**
   - SSRF 防护
   - URL 白名单
   - 域名过滤

## 使用方式

### 服务端调用（无需修改）

原有的 ToolBridge 调用方式保持不变：

```typescript
// 获取页面上下文
{
  name: 'browser_get_context',
  arguments: {}
}

// 执行浏览器动作
{
  name: 'browser_ai_execute',
  arguments: {
    action: {
      type: 'click',
      ref: 1
    }
  }
}
```

### 客户端直接使用

```typescript
import { agentBrowserService } from './services/agent-browser.js'

// 导航到页面
await agentBrowserService.navigate(sessionId, 'https://example.com')

// 获取页面上下文
const context = await agentBrowserService.getPageContext(sessionId)
console.log(context.elements) // [{ ref: 'e1', role: 'button', name: 'Submit' }, ...]

// 执行动作
await agentBrowserService.executeBrowserAction(sessionId, {
  type: 'click',
  ref: 1
})
```

## 配置选项

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AGENT_BROWSER_HEADED` | 是否显示浏览器窗口 | `true` |
| `AGENT_BROWSER_DEFAULT_TIMEOUT` | 默认超时时间 | `30000` |
| `DEBUG_AGENT_BROWSER` | 是否输出调试日志 | `false` |

### 安全配置

```typescript
import { agentBrowserService } from './services/agent-browser.js'
import { defaultSecurityGuard } from './tools/browser-ai/browser-security.js'

// 配置允许的域名
defaultSecurityGuard.setAllowedDomains([
  'example.com',
  '*.example.com'
])
```

## 与旧版 browser-ai 对比

| 特性 | 旧版 browser-ai | agent-browser |
|------|----------------|---------------|
| 元素定位 | CDP + RobustLocator | Snapshot + Refs |
| 动作数量 | 10+ | 80+ |
| 批量执行 | 自定义实现 | 原生支持 |
| 云服务 | 不支持 | Browserbase/Kernel |
| 视频录制 | 不支持 | 原生支持 |
| 维护成本 | 高 | 低（使用开源包）|

## 文件变更

### 新增
- `apps/client/src/main/services/agent-browser.ts` - 封装服务
- `apps/client/src/main/services/agent-browser.test.ts` - 测试脚本
- `docs/agent-browser-integration.md` - 本文档

### 修改
- `apps/client/src/main/index.ts` - 使用 AgentBrowserService 替代 browserAI

### 保留（向后兼容）
- `apps/client/src/main/tools/browser-ai/` - 旧实现（可移除）
- `apps/client/src/main/tools/browser-manager.ts` - 旧实现（可移除）

## 回滚方案

如需回滚到旧版 browser-ai，修改 `apps/client/src/main/index.ts`：

```typescript
// 将
import { agentBrowserService } from './services/agent-browser.js'
// 替换为
const { browserAI } = await import('./tools/browser-ai/index.js')

// 并将所有 agentBrowserService.xxx 调用替换为 browserAI.xxx
```

## 测试

运行测试脚本：

```bash
cd apps/client
npx tsx src/main/services/agent-browser.test.ts
```

## 故障排查

### 问题：agent-browser daemon 无法启动

**解决方案：**
1. 检查 agent-browser 是否安装：`npx agent-browser --version`
2. 检查端口是否被占用：`lsof -i :9222`
3. 查看 daemon 日志：设置 `DEBUG_AGENT_BROWSER=true`

### 问题：元素定位失败

**解决方案：**
1. 先调用 `getPageContext` 获取最新 refs
2. 检查 ref ID 是否存在
3. 使用 `@e1` 格式的 selector

### 问题：安全拦截

**解决方案：**
1. 检查 URL 是否在白名单中
2. 查看 security guard 配置
3. 临时禁用安全策略（仅开发环境）：`permissiveSecurityGuard`
