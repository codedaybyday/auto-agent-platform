# Agent Loop 能力差距分析

## 背景

当前项目的 Agent Loop 为自研实现（`loop.ts` ~650 行 + `bridge.ts` ~730 行 + `short-term.ts` ~720 行），核心 ReAct 循环设计干净，与 Electron 客户端的工具桥接（WebSocket → MCP → Browser/Bash）是项目的核心竞争力。但在与主流 Agent 框架（Vercel AI SDK、Mastra、LangGraph 等）对比后，发现存在若干能力短板，部分已直接影响用户体验（如流中断无保留、Token 估算不准导致费用爆炸）。

## 目标

1. 系统梳理当前实现与业界框架的能力差距
2. 按「业务影响 × 实现成本」排定优先级
3. 给出补齐路线建议

## 内容

### 维度一：LLM 通信层健壮性（影响最大）

| 能力 | 当前状态 | 框架水平 |
|------|----------|----------|
| **自动重试** | 无。网络抖动直接抛异常，需用户重发消息 | 指数退避 + jitter，透明重试 2-3 次 |
| **速率限制处理** | 仅客户端限流 Token Bucket，被 API 429 后无应对 | 自动读取 `Retry-After` 头，排队等待后重试 |
| **流中断恢复** | 流断了内容丢失。`streamChat()` 只 catch `AbortError`，其他异常直接丢弃已生成内容 | 流中断后保留已生成内容，部分框架支持断点续传 |
| **多 Provider 统一抽象** | 只适配了 OpenAI 协议，Anthropic 协议基本为空 | 一个 `generateText()` 调 OpenAI/Anthropic/Google 等 16+ Provider |
| **Token 精确计数** | `estimateTokens()` 按字符数估算（中文/2，英文/3，代码/3.5），误差可达 30-50% | 调用各模型原生 tokenizer，精确到字节 |
| **请求超时控制** | 仅 LLMClient 内置 fetch 超时，无业务层超时策略 | 可配置 step timeout + total timeout + 中间结果回调 |

**最痛点**：流式输出断掉后用户看到一半的回复就没了，没有重试也没有中间结果保存。

### 维度二：Structured Output（结构化输出）

| 能力 | 当前状态 | 框架水平 |
|------|----------|----------|
| **Schema 约束输出** | 无。依赖 prompt 里写"只输出 JSON"，然后手动 `JSON.parse()` + try-catch | `Output.object(zodSchema)` — LLM 保证输出符合 Zod Schema，自动重试不合规结果 |
| **流式结构化输出** | 不支持。JSON 必须等完整返回才能解析 | 流式输出时逐字段解析，UI 可渐进渲染 |
| **工具参数强校验** | `LLMClient.chat()` 里手动 `JSON.parse(tool.function.arguments)`，解析失败时塞 `_parseError` 标记，异常路径和正常路径混杂 | `tool({ inputSchema: z.object({...}) })` — SDK 层保证参数合法才调用 execute，不合法自动让 LLM 修正 |

**最痛点**：压缩记忆时 LLM 返回的 JSON 经常解析失败，`parseCompressionResult()` 里写了两套 fallback（JSON 匹配 → 文本行提取），但仍有失败风险。

### 维度三：Agent Loop 控制策略

| 能力 | 当前状态 | 框架水平 |
|------|----------|----------|
| **停止条件策略** | 仅 `maxIterations`（硬编码 10）。超出就抛错"思考次数过多" | 多维度停止：step count / token budget / hasFinalAnswer / 自定义回调 |
| **工具选择优化** | 每次 LLM 调用都发送全部工具定义，不管是否相关 | `prepareStep` hook — 根据上下文动态裁剪工具列表，减少 prompt token |
| **Step 级超时** | 整个 run 只有一个隐式超时 | 每个 step 独立超时，超时后可配置"跳过该步继续"或"整体失败" |
| **中间结果检查** | 只有最后才知道跑成什么样 | 每个 step 后可注入 `onStepFinish` 回调，检查中间状态，提前终止无效循环 |
| **循环卡死检测** | LLM 反复调同一个工具会一直循环到 maxIterations | 检测重复 tool call 模式，连续 N 次相同操作自动中断并提示 |

**具体表现**：百度导航场景下 Token 爆炸就是缺少这些控制导致的 — 没有 token budget 限制，没有重复调用检测。

### 维度四：可观测性（Observability）

| 能力 | 当前状态 | 框架水平 |
|------|----------|----------|
| **执行链路追踪** | 日志用 `console.log` + 自定义 `log` 工具，没有 trace ID，多会话并发时日志混在一起 | OpenTelemetry 原生集成，每个 Agent Run 有唯一 traceId |
| **Token 用量监控** | 仅有 `usage` 字段透传，无历史统计、无成本换算 | 实时 token 计数 + 成本估算（按模型单价）+ 历史趋势图 |
| **Agent 执行回放** | 出问题只能翻日志脑补 | 记录每轮 input/output/tool calls，可完整回放调试 |
| **性能指标** | 仅 `log.perf()` 打印工具耗时，无聚合统计 | P50/P95/P99 延迟、首 token 时间（TTFT）、每秒 token 数 |
| **告警** | 无 | 异常率、超时率超过阈值自动告警 |

### 维度五：工具系统成熟度

| 能力 | 当前状态 | 框架水平 |
|------|----------|----------|
| **工具定义标准化** | 手动构造 OpenAI function-calling 格式 JSON，`client.ts` 里硬编码 5 个工具约 100 行 | `tool({ name, description, inputSchema, execute })` 一个函数搞定 |
| **工具执行隔离** | 工具在 Electron 客户端执行，通过 WebSocket 桥接。超时后 Promise reject，但客户端可能还在跑 | 工具执行沙箱化，超时自动 kill 进程 |
| **工具结果 Schema 校验** | 工具返回什么就喂给 LLM 什么 | 返回结果经过 Schema 校验，不合规自动重试 |
| **工具降级/回退** | `bridge.ts` 中有 local/remote/hybrid 分类和回退逻辑，但是硬编码的 | 声明式工具降级链 |
| **工具权限控制** | 所有工具对 LLM 同等开放 | 工具级 ACL：`needsApproval`、只读工具、会话级禁用 |

### 维度六：安全护栏（Guardrails）

| 能力 | 当前状态 | 框架水平 |
|------|----------|----------|
| **输入/输出过滤** | Bash 层有危险命令拦截，但粒度粗 | 多层护栏：输入校验 → 输出校验 → 工具参数校验 |
| **PII 检测** | 无 | 自动检测并脱敏身份证号、手机号、邮箱、API Key 等 |
| **Prompt Injection 防护** | 用户输入直接拼接进 system prompt | 输入 sanitization + 越狱检测 + 系统提示词隔离 |
| **内容安全** | 无 | 有害内容检测 + 合规过滤 |

### 维度七：工作流编排

| 能力 | 当前状态 | 框架水平 |
|------|----------|----------|
| **多 Agent 协作** | 一个会话只有一个 AgentLoop | Orchestrator-Worker、Swarm、Handoff 等多种模式 |
| **条件分支** | 纯线性 ReAct 循环 | 图编排：条件边、并行节点、子图嵌套 |
| **Human-in-the-Loop** | 仅有 stop/pause API，暂停后无法注入人工反馈再继续 | 原生"暂停等待审批 → 人工输入 → 继续执行"流程 |
| **子任务委托** | 复杂任务只能在一个 loop 里跑完 | 主 Agent 拆解任务 → 委托子 Agent → 汇总结果 |

### 维度八：评估与测试

| 能力 | 当前状态 | 框架水平 |
|------|----------|----------|
| **Agent 行为评测** | 靠人工观察 | Eval 框架：定义用例 → 运行 Agent → 自动评分 |
| **回归测试** | 改了 system prompt 不知道效果变好变坏 | Pipeline：代码变更 → 跑 eval suite → 对比基线 |
| **A/B 测试** | 不支持 | 同一条输入跑多个 model/prompt → 对比结果 |

### 维度九：记忆与知识管理

| 能力 | 当前状态 | 框架水平 |
|------|----------|----------|
| **长期记忆** | Tier 1 + Tier 2 压缩仅在单次会话内有效 | 跨会话记忆持久化 + 语义检索（向量数据库） |
| **RAG 集成** | 无 | 内置文档加载器、分块、向量检索、重排序 |
| **上下文窗口管理** | `estimateTokens()` 估算 + 紧急截断（80K 告警 / 100K 强制截断），截断策略粗糙（按字符长度硬砍） | 智能截断：优先丢弃冗余信息、保留关键事实、按重要性排序 |
| **实体追踪** | 无 | 跨轮次追踪文件路径、URL、用户名等实体变化 |

---

## 差距优先级矩阵

```
高影响 / 低成本 ██████████████████████████████ 优先做
────────────────────────────────────────────
  1. LLM 自动重试 + 流中断保留
  2. Structured Output（工具参数校验用 Zod）
  3. Token 精确计数 + 成本估算
  4. 重复工具调用检测 + Token budget 停止条件
  5. OpenTelemetry 链路追踪
────────────────────────────────────────────
  6. 工具定义标准化（tool() 工厂函数）
  7. Step 级超时
  8. 执行回放 / 调试日志
  9. 输入安全过滤（Prompt Injection）
────────────────────────────────────────────
  10. 跨会话记忆 + 语义检索
  11. 多 Agent 协作
  12. Eval 评测框架
  13. Human-in-the-Loop
────────────────────────────────────────────
高影响 / 高成本 ██████████████████████████████ 长期规划
```

## 结论/建议

### 补齐路线

**第一阶段（1-2 周，低成本高回报）：**

- LLM 层加自动重试（指数退避）+ 流中断后保留已生成内容
- `tool()` 工厂函数统一工具定义，内置 Zod Schema 校验
- 引入 `tiktoken` 或通义 tokenizer 做精确计数
- `stopWhen` 策略：token budget + 重复调用检测

**第二阶段（2-4 周，中等投入）：**

- OpenTelemetry 接入，全链路 traceId
- 工具执行结果 Schema 校验
- Step 级独立超时
- 输入安全过滤层

**第三阶段（长期规划）：**

- 跨会话长期记忆（SQLite + 向量检索）
- Eval 框架
- 多 Agent 编排

### 核心判断

大部分能力不需要引入框架 — 用现有架构逐步增强即可。只有在「多 Provider 抽象」「OpenTelemetry」「Structured Output」这几个点上，引入 Vercel AI SDK 的部分模块（仅 LLM 通信层，非整套 Agent Loop）能显著降低实现成本。

## 相关文档

- [Agent 框架对比](agent-framework-comparison.md)
- [Agent Loop 并发设计](agent-loop-concurrency.md)
- [Agent Loop 方案设计](agent-loop-scheme-1.md)
- [LLM 压缩设计](../architecture/llm-compression-design.md)
- [记忆系统设计](../architecture/memory-system-design.md)
- [Token 优化方案](../architecture/token-optimization.md)

## 变更记录

| 日期 | 作者 | 变更内容 |
|------|------|----------|
| 2026-06-22 | liubeijing | 创建文档，完成九维度差距分析 |
