# LLM 智能压缩方案设计

## 版本信息
- 创建日期: 2026-05-18
- 状态: 实现中
- 范围: Tier 1 + Tier 2（Tier 3 暂不考虑）

---

## 1. 设计目标

### 核心目标
- **高质量压缩**: 保留语义关键信息，而非简单截断
- **异步处理**: 不阻塞主对话流程
- **容错性**: LLM 失败时自动回退到规则压缩
- **成本控制**: 支持轻量级模型（如 gpt-4o-mini、qwen-turbo）

### 非目标
- Tier 3（跨会话长期记忆）不在当前范围内
- 多模态内容压缩（图片、音频）暂不支持

---

## 2. 架构设计

### 2.1 分层存储架构

```
┌─────────────────────────────────────────┐
│              对话上下文                  │
├─────────────────────────────────────────┤
│  Tier 1: 最近 N 轮（完整保留）           │
│  ├─ 完整消息内容                        │
│  ├─ 工具调用详情                        │
│  └─ 同步构建上下文                      │
│                                         │
│  例如: N=5，第 6-10 轮                  │
├─────────────────────────────────────────┤
│  Tier 2: 中间 M 轮（LLM 智能压缩）       │
│  ├─ 结构化摘要                          │
│  ├─ 关键信息点                          │
│  └─ 异步后台压缩                        │
│                                         │
│  例如: 第 1-5 轮压缩后                  │
├─────────────────────────────────────────┤
│  Tier 3: 早期轮次（超出范围）            │
│  └─ ❌ 暂不考虑（未来用向量存储）        │
└─────────────────────────────────────────┘
```

### 2.2 数据流图

```
用户发送消息
    │
    ▼
┌─────────────────┐
│ 1. 添加到内存   │ ◄── 立即返回，不阻塞
│    messages[]   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     触发条件:
│ 2. 检查压缩条件  │     - 轮数超过 Tier 1 阈值
│                 │     - 空闲时后台处理
└────────┬────────┘
         │
    需要压缩?
    /        \
   是          否
   │            \
   ▼             \
┌─────────────────┐
│ 3. 提交压缩任务  │ ◄── 放入队列，异步执行
│    queue.add()  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 4. LLM 压缩     │ ◄── 调用轻量级模型
│                 │     gpt-4o-mini / qwen-turbo
└────────┬────────┘
         │
    成功? / 失败?
    /              \
   是                否
   │                  \
   ▼                   ▼
┌──────────┐      ┌──────────────┐
│保存压缩结果│      │ 规则压缩兜底  │
│Map<round> │      │ （启发式）    │
└──────────┘      └──────────────┘
```

---

## 3. 配置设计

### 3.1 配置接口

```typescript
interface ShortTermMemoryConfig {
  /** 
   * Tier 1: 完整保留的最近轮数
   * 一轮 = user + assistant (+ tool)
   * @default 5
   */
  fullContextRounds: number

  /**
   * Tier 2: 最大压缩轮数
   * 超过此数量的早期轮次将被丢弃
   * @default 20
   */
  maxCompressedRounds: number

  /**
   * LLM 压缩配置
   */
  compression: {
    /**
     * 使用的模型
     * 建议使用轻量级模型以控制成本
     * @default 'gpt-4o-mini'
     */
    model: string

    /**
     * API 基础地址
     * @default process.env.LLM_BASE_URL
     */
    baseURL: string

    /**
     * API Key
     * @default process.env.LLM_API_KEY
     */
    apiKey: string

    /**
     * 压缩温度
     * 低温度确保结果稳定
     * @default 0.3
     */
    temperature: number

    /**
     * 压缩超时时间（毫秒）
     * 超过此时间将回退到规则压缩
     * @default 10000
     */
    timeout: number

    /**
     * 最大重试次数
     * @default 2
     */
    maxRetries: number
  }

  /**
   * 调试模式
   * @default false
   */
  debug?: boolean
}
```

### 3.2 默认配置

```typescript
const DEFAULT_CONFIG: ShortTermMemoryConfig = {
  fullContextRounds: 5,        // 保留最近 5 轮完整对话
  maxCompressedRounds: 20,     // 最多保留 20 轮（压缩后）
  compression: {
    model: 'gpt-4o-mini',      // 轻量级模型
    baseURL: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.LLM_API_KEY || '',
    temperature: 0.3,
    timeout: 10000,
    maxRetries: 2
  },
  debug: false
}
```

---

## 4. 压缩 Prompt 设计

### 4.1 系统 Prompt

```
你是一个对话压缩助手。你的任务是将多轮对话压缩成结构化的摘要。

压缩原则：
1. 保留用户的核心意图和需求
2. 记录助手执行的关键行动
3. 保留重要的执行结果和发现
4. 去除冗余的交互细节和临时内容
5. 如果包含文件操作，保留文件路径和关键变更
6. 保留错误信息和解决方案

输出格式：
必须返回有效的 JSON 对象，包含以下字段：
- summary: 一句话总结这轮对话（50字以内）
- keyPoints: 关键信息点数组（3-5条，每条不超过30字）
- userIntent: 用户的明确意图（30字以内）
- actions: 执行的行动列表（工具调用等，每项不超过50字）
- results: 重要的执行结果（每项不超过50字）

注意事项：
- 只输出 JSON，不要其他解释
- 确保 JSON 格式正确，可以被解析
- 中文输出
```

### 4.2 用户 Prompt 示例

```
【第 3 轮对话压缩】

【用户输入】
帮我查一下 github.com 上 trending 的 TypeScript 项目

【助手回复】
我来帮你查看 GitHub 上热门的 TypeScript 项目。

【工具调用】
- browser_ai: {"instruction": "go to github.com/trending/typescript"}
- get_text: {"selector": "article.Box-row"}

【工具结果】
- 页面已加载，显示 25 个热门项目
- 提取到项目名称、描述、star 数

请将以上对话压缩成 JSON 格式。
```

### 4.3 期望输出示例

```json
{
  "summary": "查询 GitHub TypeScript 热门项目",
  "keyPoints": [
    "访问 github.com/trending/typescript",
    "成功获取 25 个热门项目",
    "提取项目名称、描述、star 数"
  ],
  "userIntent": "查找 TypeScript 热门仓库",
  "actions": [
    "browser_ai: 导航到 github.com/trending/typescript",
    "get_text: 提取项目列表信息"
  ],
  "results": [
    "成功加载 trending 页面",
    "获取 25 个项目数据"
  ]
}
```

---

## 5. 压缩结果存储结构

### 5.1 CompressionResult 接口

```typescript
interface CompressionResult {
  /** 压缩后的摘要（一句话） */
  summary: string

  /** 关键信息点（3-5条） */
  keyPoints: string[]

  /** 用户意图 */
  userIntent: string

  /** 执行的行动 */
  actions: string[]

  /** 重要结果 */
  results: string[]

  /** 
   * 是否使用 LLM 压缩
   * false 表示回退到规则压缩
   */
  isLLMCompressed: boolean

  /** 消耗的 token 数（可选） */
  tokensUsed?: number

  /** 压缩时间戳 */
  compressedAt: number
}
```

### 5.2 存储方式

```typescript
class ShortTermMemory {
  // Tier 1: 完整消息（内存数组）
  private messages: Message[] = []

  // Tier 2: 压缩结果（Map 存储）
  private compressedRounds: Map<number, CompressionResult> = new Map()

  // 压缩任务队列（防止重复压缩）
  private compressionQueue: Map<string, Promise<CompressionResult>> = new Map()
}
```

---

## 6. 错误处理策略

### 6.1 异常场景处理

| 异常场景 | 处理方式 | 结果 |
|---------|---------|------|
| LLM API 调用失败 | 重试 2 次，指数退避 | 仍失败则回退到规则压缩 |
| 超时（10s） | 中断请求 | 使用规则压缩 |
| JSON 解析失败 | 尝试从文本提取 | 仍失败使用规则压缩 |
| 限流（429） | 指数退避后重试 | 仍失败使用规则压缩 |
| 模型不可用 | 直接回退 | 使用规则压缩 |

### 6.2 规则压缩（兜底方案）

当 LLM 压缩失败时，使用启发式规则：

```typescript
function fallbackCompression(round: number, messages: Message[]): CompressionResult {
  const userMsg = messages.find(m => m.role === 'user')
  const assistantMsg = messages.find(m => m.role === 'assistant')
  const toolMsgs = messages.filter(m => m.role === 'tool')

  // 提取用户意图：第一句或前100字符
  const userIntent = extractFirstSentence(userMsg?.content)

  // 提取行动：工具调用名称和参数
  const actions = assistantMsg?.toolCalls?.map(t => 
    `${t.name}: ${JSON.stringify(t.arguments).slice(0, 100)}`
  ) || []

  // 提取结果：非错误的工具结果
  const results = toolMsgs
    .filter(m => !m.content?.startsWith('Error:'))
    .map(m => m.content?.slice(0, 150) || '')

  return {
    summary: `用户意图: ${userIntent} | 执行: ${actions.join(', ')}`,
    keyPoints: [userIntent, ...actions],
    userIntent,
    actions: actions.slice(0, 3),
    results: results.slice(0, 3),
    isLLMCompressed: false,
    compressedAt: Date.now()
  }
}
```

---

## 7. 上下文构建流程

### 7.1 getContextMessages() 方法

```typescript
function getContextMessages(): Message[] {
  const result: Message[] = []

  // 1. 系统消息
  result.push(systemMessage)

  // 2. Tier 2: 压缩的历史（如果有）
  const compressedContext = this.buildCompressedContext()
  if (compressedContext) {
    result.push({
      id: 'compressed-history',
      role: 'system',
      content: compressedContext,
      timestamp: Date.now()
    })
  }

  // 3. Tier 1: 最近的完整消息
  const recentMessages = this.getRecentMessages(this.config.fullContextRounds)
  result.push(...recentMessages)

  return result
}
```

### 7.2 压缩上下文格式

```
【历史对话摘要（第 1-5 轮）】

[第 1 轮] 查询 GitHub TypeScript 热门项目
  关键点: 访问 github.com/trending/typescript; 成功获取 25 个热门项目

[第 2 轮] 分析 React 源码架构
  关键点: 读取 packages/react/src; 分析核心模块结构

[第 3 轮] 修改配置文件
  关键点: 更新 vite.config.ts; 添加 alias 配置

【以上为历史摘要，以下是最近对话】
```

---

## 8. 性能与成本分析

### 8.1 Token 消耗估算

假设：
- 每轮对话平均 1500 tokens
- 压缩后平均 300 tokens
- 模型: gpt-4o-mini ($0.15/$0.60 per 1M tokens)

| 场景 | 输入 Token | 输出 Token | 成本 |
|------|-----------|-----------|------|
| 单轮压缩 | 1500 | 300 | ~$0.0004 |
| 10 轮会话（压缩 5 轮） | 7500 | 1500 | ~$0.002 |
| 100 轮会话 | 75000 | 15000 | ~$0.02 |

### 8.2 延迟分析

| 操作 | 延迟 | 是否阻塞 |
|------|------|---------|
| 添加消息 | <1ms | 否 |
| Tier 1 上下文构建 | <10ms | 否 |
| Tier 2 LLM 压缩 | 2-5s | 否（异步） |
| Tier 2 规则压缩 | <10ms | 否（异步） |

### 8.3 内存占用

假设每轮消息平均 2KB：

| 配置 | 内存占用 |
|------|---------|
| Tier 1: 5 轮完整 | ~10KB |
| Tier 2: 15 轮压缩 | ~3KB（压缩后） |
| 总计 | ~13KB / 会话 |

---

## 9. 实现计划

### 9.1 文件变更

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `llm-compressor.ts` | 新增 | LLM 压缩器实现 |
| `short-term-memory.ts` | 修改 | 集成 LLM 压缩，分层存储 |
| `agent-loop.ts` | 修改 | 更新配置传递 |
| `types/index.ts` | 修改 | 添加配置类型 |

### 9.2 实现顺序

1. ✅ 创建 `llm-compressor.ts` - LLM 压缩器
2. ⬜ 修改 `short-term-memory.ts` - 分层存储 + 异步压缩
3. ⬜ 更新 `agent-loop.ts` - 配置集成
4. ⬜ 添加类型定义
5. ⬜ 测试验证

### 9.3 回滚策略

如果 LLM 压缩出现问题，可以通过配置快速回退：

```typescript
// 完全禁用 LLM 压缩，使用规则压缩
const config = {
  fullContextRounds: 10,  // 增加保留轮数
  compression: {
    // 配置无效模型，强制回退
    model: 'none',
    timeout: 1  // 立即超时
  }
}
```

---

## 10. 测试策略

### 10.1 单元测试

- 压缩结果格式验证
- 错误回退机制
- 队列去重
- Token 估算准确性

### 10.2 集成测试

- 完整对话流程
- 压缩与上下文构建
- 多会话并发

### 10.3 性能测试

- 压缩延迟测量
- 内存占用监控
- API 成本统计

---

## 附录

### A. 参考方案

| 方案 | 来源 | 特点 |
|------|------|------|
| BufferWindowMemory | LangChain | 滑动窗口，简单高效 |
| SummaryMemory | LangChain | LLM 渐进式摘要 |
| MemGPT | Berkeley | 虚拟内存管理 |
| LLMLingua | Microsoft | 粗到细 Token 压缩 |

### B. 术语表

- **Tier**: 层级，指不同的存储策略层级
- **Compression**: 压缩，指将对话内容转换为摘要
- **Context Window**: 上下文窗口，LLM 能处理的最大 Token 数
- **Sliding Window**: 滑动窗口，只保留最近 N 个项目的策略

### C. 变更日志

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-18 | v0.1 | 初始设计，Tier 1 + Tier 2 |
