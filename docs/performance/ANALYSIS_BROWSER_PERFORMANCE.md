# 浏览器工具性能分析报告

## 项目架构概述

该项目是一个 **AI Agent 平台**，采用 **Monorepo + Electron + Node.js** 架构：

```
┌─────────────────────────────────────────────────────────────────┐
│                    Electron Client                               │
│  ┌──────────────┐              ┌─────────────────────────────┐ │
│  │  Renderer    │ ◄── IPC ───► │  Main Process               │ │
│  │  (React UI)  │              │  (Browser/Bash/File Tools)  │ │
│  └──────────────┘              └──────────────┬──────────────┘ │
└───────────────────────────────────────────────┼────────────────┘
                                                │
                                                │ WebSocket
                                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Node.js Server                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Agent Loop  │  │  LLM Client  │  │  Rate Limiter        │  │
│  │  (ReAct)     │  │  (多模型)     │  │  (Token Bucket)      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 核心通信流程

1. **用户输入** → Renderer 通过 IPC 发送到 Main
2. **Main 进程** 通过 HTTP 发送到 Server
3. **Agent Loop** 构建上下文 → 调用 LLM
4. **LLM 决策** → 返回工具调用（如 browser_ai）
5. **Server** 通过 WebSocket 发送工具指令到 Main
6. **Main 执行** 浏览器操作 → 返回结果
7. **循环直到** 任务完成

---

## 性能问题分析

### 测试场景
**指令**："打开百度，搜索 Python"  
**总耗时**：约 3 分钟（21:39:59 - 21:43:03）

### 1. LLM 推理时间过长（核心瓶颈）

| 调用点 | 开始时间 | 结束时间 | 耗时 |
|--------|----------|----------|------|
| 第1次 LLM | 21:39:59 | 21:40:24 | **25.7s** |
| 第2次 LLM | 21:41:07 | 21:41:10 | 2.8s |
| 第3次 LLM | 21:41:24 | 21:41:58 | **33.5s** |
| 第4次 LLM | 21:41:58 | 21:42:26 | 27.5s |
| 第5次 LLM | 21:42:31 | 21:42:56 | 24.7s |
| 第6次 LLM | 21:42:56 | 21:43:02 | 6.0s |

**根本原因：**
- 使用的是本地模型 `gpt-oss:20b` (通过 Ollama)
- 20B 参数模型在本地运行推理速度较慢
- 每次调用都需要生成大量文本（包含 reasoning 过程）

**相关代码：**
```typescript
// apps/server/src/services/llm/client.ts:56-70
constructor(config: Partial<LLMConfig> = {}, rateLimiter?: RateLimiter) {
  // ...
  this.isLocal = this.provider === 'ollama' || baseURL.includes('localhost')
  // Ollama 本地部署不需要 API Key
  this.config = {
    model: config.model || process.env.LLM_MODEL || 'gpt-4',
    apiKey: config.apiKey || process.env.LLM_API_KEY || (this.isLocal ? 'ollama' : ''),
    // ...
  }
}
```

---

### 2. 浏览器导航等待时间过长

**问题现象：**
```
Error: page.goto: Timeout 30000ms exceeded.
Call log:
  - navigating to "https://www.baidu.com/", waiting until "networkidle"
```

**根本原因：**
- 使用 `waitUntil: 'networkidle'` 等待网络空闲
- 百度页面有持续的网络请求（统计、广告等），无法满足条件
- 30秒超时后才继续执行

**相关代码：**
```typescript
// apps/client/src/main/tools/browser-use/core/controller.ts:331
await page.goto(action.url, { waitUntil: 'networkidle' })
```

---

### 3. 多次往返通信开销

每个 browser_ai 工具调用需要以下步骤：
1. 获取页面上下文 (`browser_get_context`) → 100-200ms
2. **LLM 规划动作** → **20-35s**
3. 执行动作 (`browser_ai_execute`) → 1-3s
4. 检测变化并刷新上下文 → 100-200ms

**本任务需要 6 次 LLM 调用**，每次都有网络往返延迟。

**相关代码：**
```typescript
// apps/server/src/services/agent/bridge.ts:123-181
private async executeBrowserAI(toolCall: ToolCall): Promise<ToolResult> {
  // 步骤 1: 获取页面上下文（只获取一次）
  const contextResult = await this.getPageContext()
  
  // 步骤 2: 使用批量规划
  const batchResult = await this.executeBatchBrowserAI(
    toolCall, instruction, contextResult.context!, startTime
  )
  // ...
}
```

---

### 4. DOM 处理开销

**日志数据：**
```
[BrowserUseDOM] Processing 819 nodes, Layout nodes: 0
[BrowserUseDOM] Summary - Elements: 525, Interactive: 92
```

- 百度页面元素较多（500+ 元素）
- 每次获取 DOM 上下文增加了 LLM 处理的 token 数量
- 虽然 CDP 获取 DOM 快照较快（~100ms），但整体影响 LLM 推理时间

**相关代码：**
```typescript
// apps/client/src/main/tools/browser-use/dom/browser-use-dom.ts:39-78
async getInteractiveElements(page: Page): Promise<BrowserUseElement[]> {
  const cdpSession = await page.context().newCDPSession(page)
  try {
    // 1. 获取 DOM Snapshot
    const snapshot = await cdpSession.send('DOMSnapshot.captureSnapshot', {...})
    // 2. 获取 Accessibility Tree
    const axTree = await cdpSession.send('Accessibility.getFullAXTree')
    // 3. 提取可交互元素
    const elements = this.extractInteractiveElements(snapshot, axTree)
    // ...
  }
}
```

---

## 优化建议

### 优先级 1：优化浏览器导航等待条件（立竿见影）

**问题文件：** `apps/client/src/main/tools/browser-use/core/controller.ts:331`

**修改方案：**
```typescript
// 修改前：
await page.goto(action.url, { waitUntil: 'networkidle' })

// 修改后：
await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 10000 })
// 或者：
await page.goto(action.url, { waitUntil: 'load', timeout: 15000 })
```

**预期收益：** 减少 15-30 秒导航等待时间

---

### 优先级 2：使用更快的模型或远程 API

**问题文件：** `apps/server/.env`

**当前配置：**
```bash
# 使用本地 20B 模型（慢）
LLM_MODEL=gpt-oss:20b
LLM_BASE_URL=http://127.0.0.1:11434/v1
```

**建议配置：**
```bash
# 方案 A：使用远程 API（推荐）
LLM_MODEL=qwen-max
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=your-api-key

# 方案 B：使用更小的本地模型
LLM_MODEL=qwen2.5:7b
LLM_BASE_URL=http://127.0.0.1:11434/v1
```

**预期收益：** LLM 推理时间从 25-35s 降至 3-10s

---

### 优先级 3：优化网络超时配置

**问题文件：** `apps/server/src/services/agent/bridge.ts:445-456`

**当前配置：**
```typescript
const timeouts: Record<string, number> = {
  'browser': 60000,
  'browser_ai': 90000,
  'browser_ai_execute': 60000,
  'browser_get_context': 30000,
  // ...
}
```

**建议配置：**
```typescript
const timeouts: Record<string, number> = {
  'browser': 30000,           // 从 60000 减少
  'browser_ai': 45000,        // 从 90000 减少
  'browser_ai_execute': 30000,
  'browser_get_context': 15000, // 从 30000 减少
  // ...
}
```

---

### 优先级 4：减少 LLM 调用次数

**问题文件：** `apps/server/src/services/agent/bridge.ts`

**优化思路：**
1. 增强批量执行逻辑（`useBatch`）
2. 缓存常见操作的解析结果
3. 简化 DOM 表示，减少 token 数量

**相关代码：**
```typescript
// apps/server/src/services/agent/bridge.ts:168-177
if (useBatch) {
  console.log(`[ToolBridge] Using batch planning for: ${instruction}`)
  const batchResult = await this.executeBatchBrowserAI(
    toolCall, instruction, contextResult.context!, startTime
  )
  return batchResult
}
```

---

## 问题定位总结

| 问题 | 影响 | 位置 | 优化优先级 |
|------|------|------|-----------|
| LLM 推理慢（本地20B模型） | **最大瓶颈，占 80% 时间** | Ollama 本地服务 | 高 - 换远程API或小模型 |
| `networkidle` 等待超时 | 30s 浪费/次 | controller.ts:331 | 高 - 改 `domcontentloaded` |
| 多次 LLM 往返 | 累积延迟 | bridge.ts | 中 - 优化批量执行 |
| DOM 处理开销 | 增加 token | browser-use-dom.ts | 低 - 已可接受 |

---

## 相关文件路径

```
apps/client/src/main/tools/browser-use/core/controller.ts    # 浏览器控制核心
apps/client/src/main/tools/browser-use/dom/browser-use-dom.ts # DOM 获取服务
apps/client/src/main/tools/executor.ts                       # 工具执行器
apps/server/src/services/agent/bridge.ts                     # 工具桥接层
apps/server/src/services/llm/client.ts                       # LLM 客户端
apps/server/src/services/agent/loop.ts                       # Agent Loop 核心
```

---

*分析时间：2026/05/26*  
*日志来源：server.log, client.log*
