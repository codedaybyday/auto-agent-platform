# LLM Token 消耗优化方案

> 分析日期: 2026-05-16
> 分析范围: apps/server, apps/client 中的 LLM 交互代码

## 问题概述

当前系统在与 LLM 交互时存在多个 token 消耗过高的问题，特别是：
- 消息历史无限制增长
- 工具结果无截断
- 系统提示词每次都重复发送

---

## 🔴 高优先级（立即影响成本）

### 1. 消息历史无限制增长

**位置:**
- `apps/server/src/services/agent-loop.ts:226` - `buildContext()` 发送所有消息
- `apps/client/src/main/agent/agent.ts:144-157` - 同样问题

**问题描述:**
每次 LLM 调用都发送完整对话历史，长对话 token 成本指数增长。

**优化方案:**

```typescript
// 添加消息截断策略
private buildContext(): Message[] {
  const systemMessage = {
    id: 'system',
    role: 'system',
    content: this.config.systemPrompt,
    timestamp: Date.now()
  }

  // 策略1: 只保留最近 N 轮对话
  const recentMessages = this.state.messages.slice(-10) // 最近10条

  // 策略2: 智能摘要（更早的消息压缩）
  if (this.state.messages.length > 10) {
    const olderMessages = this.state.messages.slice(0, -10)
    const summary = this.generateSummary(olderMessages) // 异步摘要
    return [
      systemMessage,
      {
        id: 'summary',
        role: 'system',
        content: `历史摘要: ${summary}`,
        timestamp: Date.now()
      },
      ...recentMessages
    ]
  }

  return [systemMessage, ...recentMessages]
}
```

**预期效果:** 节省 50-80% token 消耗

---

### 2. 工具结果无截断

**位置:**
- `apps/server/src/services/agent-loop.ts:260-269` - `addToolResult`
- `apps/client/src/main/agent/agent.ts:249-263` - `formatToolResult`

**问题描述:**
bash 大文件输出、浏览器长页面内容直接全量发送，导致单次请求 token 爆炸。

**优化方案:**

```typescript
// 在 addToolResult 中添加截断
private addToolResult(toolCall: ToolCall, result: ToolResult): void {
  let content = result.success
    ? JSON.stringify(result.data)
    : `Error: ${result.error}`

  // Token 估算：1 token ≈ 4 字符（英文）或 1-2 字符（中文）
  const MAX_TOOL_RESULT_CHARS = 4000  // 约 1000-2000 tokens

  if (content.length > MAX_TOOL_RESULT_CHARS) {
    content = content.slice(0, MAX_TOOL_RESULT_CHARS) +
      `\n\n[内容已截断，原始长度: ${content.length} 字符]`
  }

  this.state.messages.push({
    id: this.generateId(),
    role: 'tool',
    content,
    toolResults: [result],
    timestamp: Date.now()
  })
}
```

**预期效果:** 节省 30-50% token 消耗（处理大文件时）

---

### 3. System Prompt 每次都重复发送

**位置:**
- `apps/server/src/services/agent-loop.ts:207-216` - `getDefaultSystemPrompt()`
- `apps/client/src/main/agent/agent.ts:11-21` - `SYSTEM_PROMPT`

**当前系统提示词:**
```typescript
const SYSTEM_PROMPT = `You are a helpful AI assistant that can use tools to help users accomplish your tasks.

You have access to the following tools:

1. **bash**: Execute bash commands on the local system...
2. **browser**: Control a web browser to navigate websites...

When you need to use a tool, use the tool_use block format...`
```

**优化方案:**

1. **精简版本:**
```typescript
const SYSTEM_PROMPT = `You are an AI assistant with bash and browser tools. Use tools when needed, be concise and proactive.`
```

2. **使用 Anthropic Prompt Caching**（如支持）:
```typescript
const response = await this.client.messages.create({
  model: this.model,
  max_tokens: 4096,
  system: systemPrompt,
  messages: anthropicMessages,
  tools: tools.map(...),
  // 启用 prompt caching（beta 功能）
  extra_headers: { 'anthropic-beta': 'prompt-caching-2024-07-31' }
})
```

**预期效果:** 节省 10-20% token 消耗

---

## 🟡 中优先级（显著优化）

### 4. 工具定义每次都全量发送

**位置:**
- `apps/server/src/services/llm-client.ts:163-230` - `getTools()`

**问题描述:**
4 个工具定义每次请求都发送，包含大量重复参数描述。

**优化方案:**

```typescript
// 精简工具描述
private getTools(): any[] {
  return [
    {
      type: 'function',
      function: {
        name: 'browser',
        description: '浏览器控制: navigate(导航), click(点击), type(输入), screenshot(截图), get_text(提取文本), scroll(滚动), wait(等待)',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['navigate', 'click', 'type', 'screenshot', 'get_text', 'scroll', 'wait', 'back', 'forward', 'close'],
              description: '操作类型'
            },
            url: { type: 'string', description: 'URL' },
            selector: { type: 'string', description: 'CSS选择器' },
            text: { type: 'string', description: '输入文本' }
          },
          required: ['action']
        }
      }
    },
    // ... 其他工具同样精简
  ]
}
```

---

### 5. maxTokens 固定 4096

**位置:**
- `apps/server/src/services/llm-client.ts:24`
- `apps/client/src/main/llm/client.ts:106`

**优化方案:**

```typescript
// 根据任务类型动态调整
interface TokenConfig {
  quickQuestion: 512      // 简单问答
  codeReview: 2048        // 代码审查
  complexTask: 4096       // 复杂多步任务
  longGeneration: 8192    // 长文本生成
}

// 或根据模型调整
const modelMaxTokens: Record<string, number> = {
  'gpt-4': 4096,
  'gpt-4-turbo': 4096,
  'gpt-4o': 4096,
  'claude-3-haiku': 4096,
  'claude-3-sonnet': 4096,
  'deepseek-chat': 4096,
  'deepseek-reasoner': 8192
}
```

---

## 🟢 低优先级（锦上添花）

### 6. 缺失 Token 用量监控

**位置:**
虽然 `LLMResponse` 包含 `usage` 字段，但没有持续追踪和告警。

**优化方案:**

```typescript
// 在 llm-client.ts 中添加
private totalTokensUsed = 0
private tokenUsageHistory: Array<{
  timestamp: number
  promptTokens: number
  completionTokens: number
  model: string
}> = []

private trackUsage(usage: LLMResponse['usage'], model: string) {
  if (!usage) return

  const record = {
    timestamp: Date.now(),
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    model
  }

  this.tokenUsageHistory.push(record)
  this.totalTokensUsed += usage.totalTokens

  // 日志输出
  console.log(
    `[Token Usage] Model: ${model}, ` +
    `Prompt: ${usage.promptTokens}, ` +
    `Completion: ${usage.completionTokens}, ` +
    `Total: ${usage.totalTokens}, ` +
    `Session Total: ${this.totalTokensUsed}`
  )

  // 告警：单次请求超过阈值
  if (usage.totalTokens > 8000) {
    console.warn(`[Token Alert] High token usage: ${usage.totalTokens}`)
  }
}
```

---

## 实施优先级建议

| 优化项 | 预计节省 Token | 实施难度 | 建议顺序 |
|--------|---------------|---------|---------|
| 消息截断（最近10轮） | 50-80% | ⭐ 简单 | 1 |
| 工具结果截断 | 30-50% | ⭐ 简单 | 2 |
| 精简系统提示词 | 10-20% | ⭐ 简单 | 3 |
| Prompt Caching | 50-90%（重复） | ⭐⭐ 中等 | 4 |
| 动态 maxTokens | 10-30% | ⭐ 简单 | 5 |
| Token 用量监控 | - | ⭐ 简单 | 6 |

---

## 相关文件列表

- `apps/server/src/services/llm-client.ts` - LLM 客户端实现
- `apps/server/src/services/agent-loop.ts` - Agent 核心循环
- `apps/client/src/main/llm/client.ts` - 客户端 LLM 实现
- `apps/client/src/main/agent/agent.ts` - 客户端 Agent 实现
- `apps/server/src/types/index.ts` - 类型定义
- `packages/shared-types/src/index.ts` - 共享类型

---

## 估算成本影响

假设一个典型使用场景（50 轮对话，每轮包含 2-3 次工具调用）：

| 场景 | 预估 Token 消耗 | 成本（以 GPT-4 计） |
|------|----------------|-------------------|
| 优化前 | ~100K tokens | ~$3.00 |
| 优化后 | ~25K tokens | ~$0.75 |
| **节省** | **75%** | **75%** |

---

*文档创建时间: 2026-05-16*
*下次审查: 实现优化后 1 周*
