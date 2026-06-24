# Agent Loop Guard — 工具循环调用检测方案

## 背景

LLM 在 Web 场景下容易陷入「点开页面 → 分析 DOM → 继续分析 → 再分析…」的死循环。典型症状：导航到百度后，反复调用浏览器工具分析页面内容，直到 `maxIterations=10` 耗尽。

已有 commit `a7c2f52` 通过三级截断策略解决了 Token 爆炸问题（症状），但未解决循环调用本身（根因）。本文档设计一套轻量级循环检测方案。

## 目标

1. 检测 LLM 陷入重复工具调用的模式
2. 在检测到循环时，用**任务进度上下文注入**引导 LLM 向正确方向推进，而非暴力终止或空泛警告
3. 防止「被警告 → 做一个操作 → 又回去分析」的振荡模式
4. 改动集中在 Agent Loop 层，不影响工具层和前端
5. 对正常使用场景无副作用

## 开源方案调研

### 五大流派

| 流派 | 代表项目 | 核心理念 | 检测方式 |
|------|---------|---------|---------|
| **签名哈希** | ZeptoClaw, OpenFang | 给每次工具调用打指纹 | SHA-256(`tool` + `args`) |
| **进度语义** | OpenChrome | 判断是否在「推进任务」 | URL 变化、内容提取、表单提交等信号 |
| **状态快照** | LangGraph | 对比前后状态是否完全相同 | 整个 State 对象 hash |
| **缓存重放** | TERX | 第一次成功就缓存，后续直接回放 | CDP 命令序列 + SQLite |
| **根源预防** | Agent Browser Protocol | 冻结 JS 执行，消除竞态 | 确定性状态捕获 |

### ZeptoClaw v2 — 结果感知哈希（最成熟方案）

三层递进式检测，核心创新是**结果感知哈希**：不是 hash「调用了什么」，而是 hash「返回了什么」。

```
Layer 1: 重复调用计数
  每个 (tool_name + normalized_args) → SHA-256 → counter
  超过 3 次 → block

Layer 2: 滑动窗口模式检测
  最近 N 个签名的环形缓冲 (N=5)
  同一个 hash 出现 ≥ threshold 次 → block
  同时检测 ping-pong (A→B→A→B) 和周期振荡 (A→B→C→A→B→C)

Layer 3: 结果感知哈希（核心创新）
  SHA-256(tool + args + result[:1000])
  连续 2 次相同结果 → warn，连续 3 次 → block
  解决了「参数微变但结果一样」的漏检问题

分层响应:
  warn (第3次) → block (第5次) → circuit-break (全局30次)
  poll 工具阈值 ×3，避免误杀
```

### OpenChrome — 进度语义（最智能）

不检测调用模式，而是检测**任务是否在前进**。通过 15 种「无进展」信号判断：

```
进展判定:
  progressing → 放行
  stalling  → 注入 warning hint
  stuck     → 注入 critical STOP hint
```

### 对本项目的适用性

| 方案 | 能解决本项目问题吗 | 原因 |
|------|:---:|------|
| browser-use (max_steps) | ⚠️ 已有 | 已有 maxIterations=10，但只止损不预防 |
| LangGraph (state hash) | ❌ | 每轮 state.messages 都有新消息，hash 永不重复 |
| ZeptoClaw (签名哈希) | ⚠️ | 能检测「连续 3 次 browser_ai」，但 LLM 可能微调参数绕过 |
| **ZeptoClaw v2（结果感知）** | ✅ | 页面 DOM 不变 → result[:500] 相同 → 拦截 |
| **OpenChrome（进度语义）** | ✅✅ | URL 不变 + 无元素交互 → 判定 stalling → 注入引导 |
| TERX | ❌ | 不需要缓存回放，需要在线决策 |

## 设计方案

### 核心思路

三合一：**ZeptoClaw v2 结果感知哈希 + OpenChrome 进度语义 + 自研振荡防护**

1. **检测层面**：结果感知哈希 — hash(toolName + stableArgs + result[:500])，不是检测调用了什么，而是检测返回了什么
2. **引导层面**：任务进度上下文注入 — 警告消息包含「原始任务 + 当前页面 + 已完成步骤 + 下一步建议」，推着 LLM 往正确方向走
3. **防护层面**：计数衰减 + 循环倾向累积 — 防止「被警告 → 做一个操作 → 又回去分析」的振荡

### 新增模块：`LoopGuard`

```
apps/server/src/services/agent/
├── loop.ts              # 原有文件（+15行）
├── loop-guard.ts        # 新增：循环守卫（~400行）
├── bridge.ts
├── dom-context.ts
├── session.ts
└── types.ts
```

### LoopGuard 类设计

```typescript
class LoopGuard {
  // ═══ 配置 ═══
  warnThreshold: number = 2;      // 默认触发警告阈值
  blockThreshold: number = 4;     // 默认强制终止阈值
  maxWindowSize: number = 8;      // 滑动窗口大小

  // ═══ 检测状态 ═══
  callHistory: LoopGuardEntry[];          // 工具调用历史（滑动窗口）
  consecutiveSameResult: number;          // 连续相同指纹计数
  lastFingerprint: string | null;         // 上一次指纹
  loopTendency: number;                   // 循环倾向（振荡防护，见下文）

  // ═══ 任务进度 ═══
  taskContext: {
    task: string;                         // 用户原始任务
    currentUrl?: string;                  // 当前页面 URL
    completedSteps: string[];             // 已完成步骤描述
  };

  // ═══ 核心方法 ═══
  setTaskContext(task, url?): void;          // 设置任务上下文
  updateUrl(url): void;                      // 更新当前页面 URL
  addCompletedStep(desc): void;              // 添加已完成步骤
  recordCall(toolCall, result): void;        // 记录工具调用（每次 executeTool 后）
  shouldWarn(): LoopGuardWarning | null;     // 返回任务感知的警告消息
  shouldTerminate(): boolean;                // 是否强制终止
  reset(): void;                             // 重置所有状态
}
```

### 检测逻辑

```
每次工具调用后 (recordCall):

1. 生成结果指纹: hash(toolName + stableArgs + result前500字符)

2. 工具类型适配:
   ├── 导航工具成功 → 完全重置（页面变了，循环不适用）
   ├── 操作工具成功 → 添加完成步骤
   └── 其他 → 正常检测

3. 指纹比对:
   ├── 相同 → consecutiveSameResult++
   └── 不同 → consecutiveSameResult = max(0, consecutiveSameResult - 2)
              （衰减而非复位 — 关键！）

4. 判定等级（阈值受 loopTendency 调整）:
   ┌──────────────────────────────────────────────────────────────┐
   │ 第 2 次相同 → WARN                                            │
   │   注入: 【任务进度提示】原始任务 + 当前页面 + 已完成步骤         │
   │          ⚠️ 连续 N 次无进展 + 按工具类型的操作引导              │
   │                                                              │
   │ 第 4 次相同 → CRITICAL                                        │
   │   注入: 上一条基础上加强制决策指令                              │
   │         loopTendency > 0 时追加「循环倾向」警告                │
   │                                                              │
   │ 第 4+ 次相同 → TERMINATE                                      │
   │   抛错: "检测到工具循环调用，任务已自动终止"                     │
   └──────────────────────────────────────────────────────────────┘
```

### 振荡防护机制（核心创新）

问题：简单计数器在 LLM 做一次有效操作后完全复位，LLM 可以「分析→被警告→做一个操作→又分析→再被警告…」无限振荡。

**两层防护：**

#### 1. 计数衰减（Decay, not Reset）

```
指纹变化时: consecutiveSameResult = max(0, consecutiveSameResult - 2)

效果:
  分析x2 → warn → 执行1步(衰减: 3→1) → 又分析1次(1→2) → warn (1次就触发!)
  vs 之前:
  分析x2 → warn → 执行1步(复位: 3→1) → 又分析x2(1→2→3) → warn (要2次)
```

#### 2. 循环倾向累积（Escalating Penalty）

```
loopTendency: 每次 shouldWarn() 返回非 null 时 +1，导航时归零

阈值调整:
  第1次陷入循环: loopTendency=0 → warnThreshold=2, blockThreshold=4
  第2次陷入循环: loopTendency=1 → warnThreshold=1, blockThreshold=3
  第3次陷入循环: loopTendency=2 → warnThreshold=1, blockThreshold=2 (几乎立刻终止)
```

完整行为流：

```
第1次陷入循环:
  分析x2 → ⚠️ warn (温和引导 + 任务进度)
  分析x3 → ⏳ critical (强制指令)
  分析x4 → ❌ terminate

如果 LLM 自行跳出循环后又陷入（第2次）:
  分析x1 → ⚠️ warn (立即!) 
  分析x2 → ⏳ critical
  分析x3 → ❌ terminate

第3次再陷入:
  分析x1 → ⚠️ warn
  分析x2 → ❌ terminate (几乎立刻)
```

### 任务进度上下文注入（引导而非恐吓）

警告消息不是空泛的「不要再重复」，而是包含三部分信息让 LLM 知道该往哪走：

```
【任务进度提示】
原始任务: 打开百度搜索天气
当前页面: https://www.baidu.com
已完成步骤: 1. 导航到 https://www.baidu.com

⚠️ 连续 2 次调用 browser_ai 未取得新进展，页面状态未改变。
页面已充分分析，请不要再查看页面内容。
如果你知道下一步该做什么操作，直接执行它（如点击、输入）。
如果任务已经完成，请直接给出结论。
```

引导消息按工具类型定制：

| 工具类型 | 引导内容 |
|---------|---------|
| `browser_ai` / `browser_get_context` | 页面已充分分析 → 直接执行点击/输入操作 → 或给出结论 |
| `browser_screenshot` | 截图已足够 → 做出决策 → 下一步操作或结论 |
| 其他工具 | 基于已有信息推进 → 不要再重复 XXX → 遇到障碍说明原因 |

### 工具分类阈值

不同工具类型有不同的循环敏感度：

| 工具类别 | 工具列表 | 阈值倍数 | 原因 |
|---------|---------|:---:|------|
| Browser AI | `browser_ai`, `browser_ai_execute` | ×0.7 | 最易循环，收紧检测 |
| Poll 工具 | `browser_get_context`, `browser_screenshot`, `wait` | ×3 | 状态查询，重复正常 |
| 导航工具 | `browser_navigate`, `navigate` | 完全重置 | 页面改变后循环不适用 |
| 普通工具 | 其余 | ×1 | 标准阈值 |

## 集成方式

在 `loop.ts` 中的集成点（共 5 处）：

```
AgentLoop.run()
├── ① 任务开始时:
│     loopGuard.reset()
│     loopGuard.setTaskContext(userInput)      ← 设置原始任务
│
├── ② 每轮迭代，LLM 调用前:
│     const warning = loopGuard.shouldWarn()
│     if (warning) context.push(warningMsg)    ← 注入警告
│
├── ③ 每次工具执行后:
│     loopGuard.recordCall(toolCall, result)   ← 记录调用
│
├── ④ 继续循环前:
│     if (loopGuard.shouldTerminate()) throw  ← 强制终止
│
└── ⑤ 用户停止/清理:
      loopGuard.reset()
```

## 边界情况处理

| 场景 | 处理方式 |
|------|---------|
| 短任务 (< 3 次工具调用) | 阈值未触发，不受影响 |
| 导航跳转 | 完全重置循环计数和倾向（页面状态全新） |
| 真的需要多次相同操作 | 操作类工具 (click/type) 阈值正常，3+ 次仍允许 |
| 轮询场景 (wait/status) | 阈值 ×3，最多 6 次才 warn |
| LLM 在分析后被警告但不理 | loopTendency 递增，下一次更快触发 |
| 用户中途手动停止 | reset() 清理状态 |
| 振荡模式 | 计数衰减使系统对振荡越来越敏感 |

### 不做的

- ❌ 不修改 system prompt（保持 prompt 简洁，不污染全局规则）
- ❌ 不修改工具层（bridge.ts、parser.ts 不动）
- ❌ 不引入外部依赖（FNV-1a 自实现哈希）
- ❌ 不在首次循环时暴力终止（优先通过上下文注入引导 LLM）

## 文件变更

| 文件 | 操作 | 行数 |
|------|------|:---:|
| `apps/server/src/services/agent/loop-guard.ts` | 新增 | ~400 |
| `apps/server/src/services/agent/loop.ts` | 修改 | +15 |

## 相关文档

- [Agent Loop 架构](../architecture/backend-architecture.md)
- [Token 优化方案](../architecture/token-optimization.md)
- [Agent 浏览器集成](agent-browser-integration.md)
- ZeptoClaw Loop Guard: https://github.com/qhkm/zeptoclaw/issues/220
- OpenChrome Progress Tracker: https://github.com/shaun0927/openchrome/issues/165
- LangGraph RFC #6617: https://github.com/langchain-ai/langgraph/issues/6617

## 变更记录

| 日期 | 作者 | 变更内容 |
|------|------|----------|
| 2026-06-24 | liubeijing | 创建文档，完成开源方案调研与设计 |
| 2026-06-24 | liubeijing | 更新：新增振荡防护（计数衰减+循环倾向）、任务进度上下文注入、按工具类型引导 |
