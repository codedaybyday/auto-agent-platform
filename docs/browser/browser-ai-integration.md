# Browser AI 与 Agent Loop 打通文档

## 概述

已成功将 `browser-ai` 工具与 `agent-loop` 打通，AI 现在可以通过自然语言指令控制浏览器。

## 实现内容

### 1. 服务端修改

**文件**: `apps/server/src/services/llm-client.ts`

添加了新的 `browser_ai` 工具定义：

```typescript
{
  type: 'function',
  function: {
    name: 'browser_ai',
    description: `Use AI-powered browser automation with natural language instructions...`,
    parameters: {
      type: 'object',
      properties: {
        instruction: {
          type: 'string',
          description: 'Natural language instruction describing the browser action'
        },
        use_snapshot: {
          type: 'boolean',
          description: 'Whether to use snapshot-based element references',
          default: true
        },
        ref: {
          type: 'string',
          description: 'Optional: Stable reference ID from a previous snapshot'
        }
      },
      required: ['instruction']
    }
  }
}
```

**支持的指令**:
- `go to [url]` - 导航到网站
- `click [element]` - 点击元素
- `type [text] in [field]` - 输入文本
- `search for [keyword]` - 搜索
- `scroll up/down` - 滚动页面
- `screenshot` - 截图
- `wait [ms]` - 等待
- `get page summary` - 获取页面摘要

**文件**: `apps/server/src/services/tool-bridge.ts`

将 `browser_ai` 添加到本地工具列表：
```typescript
const localTools = ['browser', 'browser_ai', 'bash', 'file_read', 'file_write']
```

**文件**: `apps/server/src/services/agent-loop.ts`

更新了系统提示词，告知 AI 优先使用 `browser_ai` 工具。

### 2. 客户端修改

**文件**: `apps/client/src/main/index.ts`

在 `executeToolAndReport` 函数中添加了对 `browser_ai` 工具的支持：

```typescript
case 'browser_ai': {
  const { instruction, ref } = toolCall.arguments

  if (ref) {
    // 使用稳定引用执行点击
    const actionResult = await browserAI.clickByRef(ref)
    result = actionResult.result
  } else if (instruction) {
    // 执行语义化指令
    const actionResult = await browserAI.semanticAct(instruction)
    result = actionResult.result
  }
  break
}
```

同时在 `cleanupSessionTools` 中添加了 `browserAI.close()` 的清理逻辑。

## 工具对比

| 特性 | `browser` (原有) | `browser_ai` (新) |
|------|------------------|-------------------|
| **操作方式** | 结构化参数 | 自然语言指令 |
| **元素定位** | CSS 选择器 | 智能语义定位 + Snapshot ref |
| **安全性** | 基础 | SSRF 防护 + 私有网络阻断 |
| **AI 友好度** | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| **适用场景** | 精确控制 | 复杂任务、智能交互 |

## 使用示例

当用户说：
> "帮我搜索 TypeScript 教程"

AI 可以调用：
```json
{
  "name": "browser_ai",
  "arguments": {
    "instruction": "go to google.com"
  }
}
```

然后：
```json
{
  "name": "browser_ai",
  "arguments": {
    "instruction": "search for TypeScript tutorials"
  }
}
```

AI 也可以先获取页面摘要：
```json
{
  "name": "browser_ai",
  "arguments": {
    "instruction": "get page summary"
  }
}
```

返回：
```
Page: Google
URL: https://www.google.com

Available Elements:
  [e1] searchbox: "Search"
  [e2] button: "Google Search"
  [e3] button: "I'm Feeling Lucky"
...
```

然后使用稳定引用点击：
```json
{
  "name": "browser_ai",
  "arguments": {
    "ref": "e1"
  }
}
```

## 架构流程

```
用户消息
    ↓
AgentLoop (服务端)
    ↓
LLMClient.chat() with tools (包含 browser_ai)
    ↓
LLM 返回 tool_calls (browser_ai)
    ↓
ToolBridge.execute() → 识别为本地工具
    ↓
WebSocket → tool.execute → 客户端
    ↓
executeToolAndReport()
    ↓
browserAI.semanticAct() / clickByRef()
    ↓
返回结果 → WebSocket → 服务端
    ↓
AgentLoop 继续循环
```

## 后续优化

1. **工具结果增强**: 在工具结果中自动包含 snapshot 信息
2. **多步骤流程**: 支持 AI 根据页面摘要自动规划多步操作
3. **错误恢复**: 当元素定位失败时，自动重新捕获 snapshot 并重试
4. **性能优化**: Snapshot 缓存和增量更新
