# Agent 框架对比分析报告

> 分析日期: 2026-05-21
> 分析范围: 市面主流 Agent 框架与当前项目架构对比

---

## 当前项目架构概览

### 架构特点

```
┌─────────────────────────────────────────────────────────────────┐
│                      当前架构 (Custom Build)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    HTTP/WS    ┌──────────────┐              │
│  │   Electron   │ ◄───────────► │  Node.js     │              │
│  │   Client     │               │  Server      │              │
│  │              │               │              │              │
│  │ ┌──────────┐ │               │ ┌──────────┐ │              │
│  │ │ Renderer │ │               │ │ Agent    │ │              │
│  │ │ (React)  │ │               │ │ Loop     │ │              │
│  │ └────┬─────┘ │               │ │ (ReAct)  │ │              │
│  │      │ IPC   │               │ └────┬─────┘ │              │
│  │ ┌────▼─────┐ │               │      │ LLM   │              │
│  │ │ Main     │ │◄──────────────┤ │ Tool     │ │              │
│  │ │ Process  │ │    WebSocket  │ │ Bridge   │ │              │
│  │ │ -Browser │ │               │ └──────────┘ │              │
│  │ │ -Bash    │ │               └──────────────┘              │
│  │ └──────────┘ │                                               │
│  └──────────────┘                                               │
│                                                                 │
│  核心特点:                                                       │
│  • 自研 Agent Loop (ReAct 模式)                                  │
│  • 分层记忆管理 (Tier1完整 + Tier2压缩)                          │
│  • 工具桥接 (本地/远程路由)                                      │
│  • 多层限流 (Token Bucket)                                      │
│  • Browser AI 语义化封装                                         │
│  • SSO 登录态共享 (CDP 方案)                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 核心组件

| 组件 | 路径 | 职责 |
|------|------|------|
| Agent Loop | `apps/server/src/services/agent/loop.ts` | ReAct 循环、工具调度 |
| Tool Bridge | `apps/server/src/services/agent/bridge.ts` | 本地/远程工具路由 |
| Browser AI | `apps/client/src/main/tools/browser-ai.ts` | 语义化浏览器控制 |
| Memory | `apps/server/src/services/memory/` | 分层记忆管理 |
| Rate Limiter | `apps/server/src/services/rate-limiter.ts` | 多层限流 |

---

## 主流框架详细对比

### 1. LangChain / LangGraph

| 维度 | 评估 |
|------|------|
| **定位** | 最成熟的 AI 应用开发框架 |
| **架构** | 链式调用 (Chain) + 图状态机 (Graph) |
| **语言** | Python (主) / TypeScript (次) |
| **核心概念** | Chain → Agent → Tool → Memory |
| **维护方** | LangChain Inc. |
| **GitHub Stars** | 100k+ |

**代码示例对比：**

```python
# LangChain 方式
from langchain import OpenAI, LLMChain, PromptTemplate
from langchain.agents import initialize_agent, Tool
from langchain.memory import ConversationBufferMemory

tools = [
    Tool(
        name="browser",
        func=browser_tool,
        description="Control web browser"
    )
]

memory = ConversationBufferMemory()
agent = initialize_agent(tools, llm, agent="react", memory=memory)
```

```typescript
// 当前项目方式 (自定义)
class AgentLoop {
  async run(input: string) {
    while (this.shouldContinue()) {
      const response = await this.llm.chat(this.getMessages())
      if (response.toolCalls) {
        const results = await this.executeTools(response.toolCalls)
        this.addToMemory(results)  // 自定义记忆管理
      }
    }
  }
}
```

**适用性评估：**

| 项目需求 | LangChain 匹配度 | 说明 |
|----------|------------------|------|
| Electron 桌面应用 | ⭐⭐ | 主要生态在 Python |
| 多会话并发 | ⭐⭐⭐ | 需要额外封装 |
| Browser 语义化 | ⭐⭐ | 需自建 Browser Tool |
| 分层记忆 | ⭐⭐ | 需自定义 Memory 类 |
| WebSocket 实时 | ⭐⭐ | 非框架原生支持 |

**优缺点：**

| 优点 | 缺点 |
|------|------|
| 生态最丰富，社区活跃 | Python 为主，TypeScript 生态较弱 |
| 文档完善，学习资源多 | 抽象层级多，调试复杂 |
| 与主流模型深度集成 | 对 Agent Loop 控制不够精细 |
| LangGraph 状态管理强大 | 引入会增加包体积 |

**结论**: 迁移成本较高，主要生态在 Python，对当前 TypeScript/Electron 架构不太友好。

---

### 2. CrewAI

| 维度 | 评估 |
|------|------|
| **定位** | 多 Agent 协作框架 |
| **架构** | Role-based + Task-driven |
| **语言** | Python |
| **核心概念** | Agent (Role) → Task → Crew |
| **维护方** | CrewAI Inc. |
| **GitHub Stars** | 20k+ |

**代码示例：**

```python
from crewai import Agent, Task, Crew

# 定义角色
researcher = Agent(
    role='研究员',
    goal='收集网页信息',
    tools=[browser_tool],
    llm=llm
)

writer = Agent(
    role='写手',
    goal='撰写报告',
    llm=llm
)

# 定义任务
task1 = Task(description="搜索新闻", agent=researcher)
task2 = Task(description="写总结", agent=writer)

# 组建团队
crew = Crew(agents=[researcher, writer], tasks=[task1, task2])
result = crew.kickoff()
```

**适用性评估：**

| 项目需求 | 匹配度 | 说明 |
|----------|--------|------|
| 单用户多会话 | ⭐ | 设计目标是多 Agent 协作 |
| 实时交互 | ⭐⭐ | 批处理模式为主 |
| Electron 集成 | ⭐ | Python 生态 |
| 工具执行 | ⭐⭐⭐ | 支持自定义 Tool |

**优缺点：**

| 优点 | 缺点 |
|------|------|
| 多 Agent 协作抽象清晰 | 不适合单 Agent 场景 |
| 角色定义直观 | Python only |
| 任务流程可视化 | 实时交互能力弱 |

**结论**: 适合多 Agent 协作场景，当前项目是单 Agent + 多会话，不太匹配。

---

### 3. AutoGen (Microsoft)

| 维度 | 评估 |
|------|------|
| **定位** | 多 Agent 对话编排 |
| **架构** | Conversational Agent |
| **语言** | Python |
| **核心概念** | AssistantAgent + UserProxy + GroupChat |
| **维护方** | Microsoft Research |
| **GitHub Stars** | 40k+ |

**适用性评估：**

| 项目需求 | 匹配度 | 说明 |
|----------|--------|------|
| 人机协同 | ⭐⭐⭐⭐⭐ | 强项 |
| 多 Agent | ⭐⭐⭐⭐⭐ | 核心设计 |
| 单 Agent Loop | ⭐⭐ | 过于重量级 |
| TypeScript | ⭐ | 仅 Python |

**优缺点：**

| 优点 | 缺点 |
|------|------|
| 对话编排能力最强 | 架构复杂，学习曲线陡 |
| 人机协同设计优秀 | 单 Agent 场景过于重量级 |
| Microsoft 背书 | Python only |

**结论**: 适合复杂多 Agent 场景，当前单 Agent 架构引入过于重量级。

---

### 4. Vercel AI SDK

| 维度 | 评估 |
|------|------|
| **定位** | 现代 React/Next.js AI 开发 |
| **架构** | Streaming + Hooks |
| **语言** | TypeScript (优先) |
| **核心概念** | useChat + streamText + tool |
| **维护方** | Vercel |
| **GitHub Stars** | 10k+ |

**代码示例对比：**

```typescript
// Vercel AI SDK 方式
import { useChat } from 'ai/react'

function Chat() {
  const { messages, input, handleSubmit } = useChat({
    api: '/api/chat',
    tools: {
      browser: {
        description: 'Control browser',
        parameters: z.object({ url: z.string() }),
        execute: async ({ url }) => { /* ... */ }
      }
    }
  })
  return <div>...</div>
}
```

```typescript
// 当前项目方式 (自定义 WebSocket + 状态管理)
// 当前使用 WebSocket 实现实时通信，Vercel AI SDK 主要是 HTTP Streaming
```

**适用性评估：**

| 项目需求 | 匹配度 | 说明 |
|----------|--------|------|
| React 前端 | ⭐⭐⭐⭐⭐ | 完美匹配 |
| Electron | ⭐⭐⭐ | 需适配 |
| Agent Loop | ⭐⭐⭐ | 需自建循环逻辑 |
| 工具执行 | ⭐⭐⭐⭐ | 支持 tools 配置 |
| WebSocket | ⭐⭐ | 主要是 HTTP Streaming |
| 多会话并发 | ⭐⭐ | 需额外封装 |

**优缺点：**

| 优点 | 缺点 |
|------|------|
| TypeScript 原生支持 | 需自建 Agent Loop |
| React Hooks 设计优秀 | WebSocket 支持弱 |
| 流式 UI 体验好 | 多会话管理需自建 |
| Vercel 生态集成 | 后端能力有限 |

**结论**: 前端部分可以参考，但整体架构（WebSocket、Agent Loop 后端）不太匹配。

---

### 5. Browser-use

| 维度 | 评估 |
|------|------|
| **定位** | 浏览器自动化专家 |
| **架构** | Agent + Browser Controller |
| **语言** | Python |
| **核心概念** | Agent(task) → LLM → Browser Actions |
| **GitHub Stars** | 30k+ |

**代码示例：**

```python
from browser_use import Agent

agent = Agent(
    task="查找今天的新闻",
    llm=openai_client
)
result = await agent.run()
```

**当前项目已实现类似功能：**

```typescript
// 当前项目 (apps/client/src/main/tools/browser-ai.ts)
class BrowserAI {
  async executeBrowserAction(sessionId: string, action: BrowserAction) {
    // 基于 Playwright 的语义化封装
    // 支持自然语言指令解析
  }
}
```

**对比分析：**

| 特性 | Browser-use | 当前项目 |
|------|-------------|----------|
| 语言 | Python | TypeScript |
| 元素定位 | 基于文本/坐标 | CDP + ref/hash |
| SSO 登录态 | ❌ | ✅ (CDP 连接用户 Chrome) |
| 语义化操作 | ✅ | ✅ |
| 快照系统 | ✅ | 部分实现 |
| 浏览器复用 | ❌ | ✅ (Tab 隔离) |

**优缺点：**

| 优点 | 缺点 |
|------|------|
| 专为浏览器自动化设计 | Python only |
| 自然语言交互友好 | 无法复用系统登录态 |
| 社区活跃 | 功能相对单一 |

**结论**: 当前项目浏览器能力已接近 browser-use，且有 SSO 优势，无需迁移。

---

### 6. LlamaIndex

| 维度 | 评估 |
|------|------|
| **定位** | RAG (检索增强生成) 专家 |
| **架构** | Index → Query Engine → Response |
| **语言** | Python (主) / TypeScript (次) |
| **核心概念** | Document → Node → Index → Retriever |
| **GitHub Stars** | 40k+ |

**适用性评估：**

| 项目需求 | 匹配度 | 说明 |
|----------|--------|------|
| 浏览器自动化 | ⭐ | 非核心能力 |
| 记忆管理 | ⭐⭐⭐ | 可借鉴 RAG 思路 |
| 文档处理 | ⭐⭐⭐⭐⭐ | 强项 |
| Agent Loop | ⭐⭐⭐ | Workflows 模块支持 |

**优缺点：**

| 优点 | 缺点 |
|------|------|
| RAG 能力最强 | Agent 能力非核心 |
| 索引系统完善 | 架构较重 |
| 多数据源支持 | 学习曲线陡 |

**结论**: 适合增强记忆/知识管理能力，不适合替换核心 Agent 架构。

---

### 7. PydanticAI

| 维度 | 评估 |
|------|------|
| **定位** | 类型安全的 Agent 框架 |
| **架构** | 结构化输出 + 依赖注入 |
| **语言** | Python |
| **核心概念** | @agent.decorator + typed results |

**代码示例：**

```python
from pydantic_ai import Agent
from pydantic import BaseModel

class BrowserResult(BaseModel):
    url: str
    title: str
    content: str

agent = Agent(
    'openai:gpt-4',
    result_type=BrowserResult,
    system_prompt="Use browser to fetch page content"
)
```

**适用性评估：**

| 项目需求 | 匹配度 | 说明 |
|----------|--------|------|
| 类型安全 | ⭐⭐⭐⭐⭐ | 核心优势 |
| 工具调用 | ⭐⭐⭐⭐ | 结构化输出 |
| TypeScript | ⭐ | 仅 Python |

**优缺点：**

| 优点 | 缺点 |
|------|------|
| 类型安全 | Python only |
| 结构化输出 | 生态较新 |
| 依赖注入 | 功能单一 |

**结论**: 类型安全理念值得借鉴，但语言不匹配。

---

## 综合对比矩阵

| 框架 | 语言 | 架构匹配 | 迁移成本 | 核心优势 | 适用性评分 |
|------|------|----------|----------|----------|------------|
| **LangChain** | Python/TS | ⭐⭐ | 高 | 生态丰富 | ⭐⭐⭐ |
| **LangGraph** | Python/TS | ⭐⭐⭐ | 高 | 状态管理 | ⭐⭐⭐ |
| **CrewAI** | Python | ⭐ | 高 | 多 Agent | ⭐⭐ |
| **AutoGen** | Python | ⭐⭐ | 高 | 对话编排 | ⭐⭐ |
| **Vercel AI SDK** | TS | ⭐⭐⭐ | 中 | React 友好 | ⭐⭐⭐⭐ |
| **Browser-use** | Python | ⭐⭐⭐ | 中 | 浏览器专家 | ⭐⭐⭐ |
| **LlamaIndex** | Python/TS | ⭐⭐ | 中 | RAG | ⭐⭐⭐ |
| **PydanticAI** | Python | ⭐⭐ | 中 | 类型安全 | ⭐⭐⭐ |
| **保持自研** | TS | ⭐⭐⭐⭐⭐ | 无 | 完全可控 | ⭐⭐⭐⭐⭐ |

---

## 建议方案

### 方案 A: 保持自研 + 选择性借鉴（推荐）

**理由：**
1. **架构独特**: Electron + WebSocket + Agent Loop 的组合没有现成框架完美支持
2. **已投入成本**: 分层记忆、Browser AI 语义化、限流系统已完善
3. **SSO 优势**: CDP 连接用户 Chrome 的方案是独特竞争力
4. **TypeScript 优先**: 市面主流框架以 Python 为主

**可借鉴点：**

| 来源框架 | 借鉴内容 | 优先级 | 实施建议 |
|----------|----------|--------|----------|
| LangGraph | 状态机管理、持久化 | 中 | 如果 Agent Loop 复杂度增长，考虑引入状态机 |
| Vercel AI SDK | React Streaming UI | 低 | 前端消息展示可参考流式处理 |
| Browser-use | 快照系统、元素稳定引用 | 高 | 完善 `browser_get_context` 返回格式 |
| PydanticAI | 结构化输出、类型安全 | 中 | 工具返回类型使用 Zod 约束 |
| OpenClaw | SSRF 防护、安全模型 | 高 | 参考实现 URL 白名单和私有网络阻断 |

### 方案 B: 引入 Vercel AI SDK (前端部分)

**适用场景**: 如果计划将部分功能迁移到 Web 版本

```typescript
// 可保留后端 Agent Loop，前端使用 Vercel AI SDK
// 需要适配层将 WebSocket 转换为 Streaming HTTP
```

**实施步骤：**
1. 创建 `/api/chat` 路由适配现有 Agent Loop
2. 前端使用 `useChat` hook
3. 添加 SSE 流式输出支持

### 方案 C: 参考 LangGraph 重构状态管理

**如果 Agent Loop 复杂度持续增长：**

```typescript
// 当前: 简单循环
while (shouldContinue) {
  const response = await llm.chat(messages)
  // ...
}

// 参考 LangGraph: 状态机
const workflow = new StateGraph()
  .addNode("agent", callModel)
  .addNode("tools", executeTools)
  .addEdge("agent", "tools", shouldContinue)
  .addEdge("tools", "agent")
```

---

## 最终建议

### 短期（保持现状）

- ✅ 当前自研架构已满足需求
- ✅ 继续完善 Browser AI 和记忆管理
- ✅ 参考 OpenClaw 加强安全层

### 中期（可选优化）

- 引入结构化输出（类似 PydanticAI 理念）
- 完善状态持久化（参考 LangGraph）
- 考虑前端 Streaming UI（参考 Vercel AI SDK）

### 长期（按需调整）

| 场景 | 建议方案 |
|------|----------|
| 转向 Web 优先 | 考虑 Vercel AI SDK |
| 多 Agent 协作 | 考虑 CrewAI/AutoGen 理念 |
| 企业级部署 | 参考 OpenClaw 架构 |
| 增强 RAG | 引入 LlamaIndex |

---

## 核心结论

> **当前自研架构是合理的选择，市面框架没有能直接替换的现成方案。**
>
> **建议策略：保持自研 + 选择性借鉴各框架的优秀设计。**

### 当前架构优势

1. **技术栈统一**: TypeScript 全栈，无语言切换成本
2. **Electron 深度集成**: 本地工具执行能力无可替代
3. **SSO 登录态**: CDP 方案是独特竞争力
4. **完全可控**: 无外部依赖风险，可深度定制

### 需要关注的方向

1. **状态持久化**: 参考 LangGraph 的状态管理
2. **类型安全**: 借鉴 PydanticAI 的结构化输出
3. **安全加固**: 参考 OpenClaw 的企业级安全模型
4. **监控可观测**: 引入 LangSmith 类似的 tracing 能力

---

*文档版本: 1.0*
*最后更新: 2026-05-21*
