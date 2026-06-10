# Auto Agent Platform 演进路线图

> 通用 Agent 平台的长期演进规划
> 版本: 2025-06-06
> 定位: 领域无关的通用 Agent 平台

---

## 核心设计原则

```
┌─────────────────────────────────────────────────────────────┐
│  1. 领域无关 - 不假设具体使用场景                              │
│  2. 工具即插件 - 所有能力通过标准接口接入                      │
│  3. 用户自定义 - 工作流、工具组合、Agent 行为可配置            │
│  4. 渐进增强 - 不破坏现有功能的前提下扩展                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 当前架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                     当前架构 (V1.0)                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  Renderer│◄──►│  Main    │◄──►│  Server  │◄──►│   LLM    │  │
│  │   (UI)   │ IPC│ (Tools)  │ WS │  (Agent) │HTTP│          │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 现有能力
- **浏览器自动化** (browser-use): CDP 控制、DOM 提取、批量动作执行
- **系统工具**: Bash 执行、文件读写
- **Agent 循环**: ReAct 模式、工具桥接、短期记忆
- **多会话管理**: 会话切换、消息历史
- **流式输出**: SSE 格式、逐字显示

---

## 目标架构 (V2.0)

```
┌─────────────────────────────────────────────────────────────────┐
│                     目标架构 (V2.0)                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  Renderer│◄──►│  Main    │◄──►│  Server  │◄──►│ LLM+RAG  │  │
│  │ (Plugins)│ IPC│ (Sandbox)│ WS │(Multi-Agent) │  │+Memory  │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
│       ▲                                              ▲          │
│       └──────────────┐    ┌──────────────────────────┘          │
│                      ▼    ▼                                     │
│              ┌──────────────┐    ┌──────────┐                   │
│              │  Vector DB   │    │  MCP Hub │                   │
│              │ (Knowledge)  │    │(Tool Ext)│                   │
│              └──────────────┘    └──────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 第一阶段：平台化基础 (1-2 个月)

### 1.1 统一工具接入标准 (MCP 化)

当前工具是硬编码的，改为标准协议接入。

#### 目标架构

```typescript
// packages/tool-protocol/src/index.ts
export interface ToolProtocol {
  // 工具元数据
  manifest: {
    name: string
    version: string
    description: string
    parameters: JSONSchema
    returns: JSONSchema
    permissions: Permission[]  // 声明需要的权限
  }

  // 执行
  execute(params: unknown, context: ExecutionContext): Promise<ToolResult>

  // 生命周期
  initialize(config: unknown): Promise<void>
  dispose(): Promise<void>
}

// 工具来源多样化
interface ToolSource {
  type: 'builtin' | 'mcp' | 'wasm' | 'external'
  config: unknown
}
```

#### 迁移计划

```
当前硬编码工具 ──┬──► 内置工具包 (packages/tools-builtin)
                │    ├── browser/
                │    ├── bash/
                │    └── file/
                │
                └──► MCP Client 接入外部工具
                     ├── 社区 MCP Server (GitHub, Slack, 等)
                     └── 用户自定义 MCP Server
```

#### 关键任务
- [ ] 提取统一 Tool 接口
- [ ] 实现 MCP Client
- [ ] 迁移现有工具到新的协议
- [ ] 工具权限系统

---

### 1.2 工作流引擎 (Workflow Engine)

用户可以通过自然语言或可视化编排定义多步骤任务。

#### 核心概念

```typescript
// 工作流定义 (领域无关)
interface Workflow {
  id: string
  name: string
  trigger: Trigger  // 定时、手动、事件、Webhook

  steps: WorkflowStep[]

  // 错误处理
  onError: 'abort' | 'retry' | 'continue' | 'notify'

  // 状态持久化
  persistence: {
    enabled: boolean
    ttl: number  // 工作流实例保留时间
  }
}

type WorkflowStep =
  | { type: 'llm'; prompt: string; model?: string }
  | { type: 'tool'; tool: string; params: Record<string, unknown> }
  | { type: 'condition'; if: string; then: WorkflowStep[]; else?: WorkflowStep[] }
  | { type: 'parallel'; branches: WorkflowStep[][] }
  | { type: 'wait'; for: 'human' | 'time' | 'event' }
```

#### 示例工作流

```yaml
name: 每日数据报表
trigger:
  type: schedule
  cron: "0 9 * * *"

steps:
  - type: tool
    tool: database_query
    params:
      connection: "{{secrets.db}}"
      sql: "SELECT * FROM sales WHERE date = TODAY()"

  - type: llm
    prompt: "分析以下数据，生成中文摘要：{{steps.0.result}}"
    model: gpt-4

  - type: tool
    tool: file_write
    params:
      path: "/reports/{{date}}.md"
      content: "{{steps.1.result}}"

  - type: condition
    if: "{{steps.0.result.length > 0}}"
    then:
      - type: tool
        tool: email_send
        params:
          to: "manager@company.com"
          subject: "今日报表"
          body: "报表已生成"
```

#### 关键任务
- [ ] 工作流 DSL 设计
- [ ] 执行引擎 (状态机驱动)
- [ ] 变量系统 (`{{steps.0.result}}`)
- [ ] 触发器框架 (定时、文件变更、Webhook)
- [ ] 执行历史与回放

---

### 1.3 上下文管理层级

从单层 Session 演进为分层上下文系统。

```
┌──────────────────────────────────────────┐
│ Level 1: 临时上下文 (Ephemeral)          │
│ - 单次工具调用的中间结果                  │
│ - 不持久化                               │
├──────────────────────────────────────────┤
│ Level 2: 会话上下文 (Session)            │
│ - 当前对话历史                           │
│ - 短期记忆 (Tier 1 + Tier 2)             │
├──────────────────────────────────────────┤
│ Level 3: 用户上下文 (User)               │
│ - 跨会话记忆                             │
│ - 用户偏好、习惯                          │
├──────────────────────────────────────────┤
│ Level 4: 共享上下文 (Shared)             │
│ - 知识库 (RAG)                           │
│ - 团队共享的工作流、工具配置              │
└──────────────────────────────────────────┘
```

#### 关键任务
- [ ] 用户级持久化存储
- [ ] 偏好学习机制
- [ ] 跨会话记忆检索
- [ ] 知识库集成

---

## 第二阶段：智能增强 (2-3 个月)

### 2.1 Agent 编排 (Agent Orchestration)

支持多 Agent 协作，但保持通用性。

```typescript
// Agent 是角色定义，不是硬编码职能
interface AgentRole {
  name: string
  systemPrompt: string
  allowedTools: string[]  // 可使用的工具白名单
  model?: string          // 可指定模型

  // 行为配置
  behavior: {
    maxIterations: number
    canDelegate: boolean  // 是否可以委托子任务给其他 Agent
    requiresApproval: boolean  // 关键操作是否需要人类确认
  }
}

// 动态编排策略
interface OrchestrationStrategy {
  type: 'sequential' | 'parallel' | 'adaptive'

  // 自适应策略：LLM 决定如何分配任务
  planner?: {
    model: string
    prompt: string
  }
}
```

#### 关键任务
- [ ] Agent 角色定义系统
- [ ] 任务分解器
- [ ] 调度器实现
- [ ] 结果聚合器

---

### 2.2 OPEV 循环架构

从简单 ReAct 演进为 观察-规划-执行-验证 (OPEV) 循环。

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Observe    │───►│   Plan      │───►│  Execute    │───►│  Verify     │
│  观察环境    │    │  生成计划   │    │  执行动作   │    │  验证结果   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
       ▲                                                        │
       └────────────────────────────────────────────────────────┘
                          验证失败时重试/重新规划
```

#### 关键改进
1. **Plan 阶段**: 输出可执行计划 (DAG)，不是单步
2. **Verify 阶段**: 由独立 Agent 或规则完成结果验证
3. **动态重规划**: 支持 Plan 的中途调整

#### 关键任务
- [ ] DAG 计划表示
- [ ] 计划执行引擎
- [ ] 验证 Agent 设计
- [ ] 重规划触发机制

---

### 2.3 通用 RAG 系统

与领域无关的知识检索系统。

```
┌─────────────────────────────────────────────────────────┐
│  知识来源 (可配置)                                       │
├─────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ 文件系统 │  │ 网页书签 │  │ 聊天记录 │  │ 外部 API │ │
│  │ (本地)   │  │ (浏览器) │  │ (历史)   │  │ (自定义) │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘ │
│       └─────────────┴─────────────┴─────────────┘       │
│                         │                               │
│                    ┌────┴────┐                          │
│                    │ 摄取管道 │                          │
│                    │ (Ingest)│                          │
│                    └────┬────┘                          │
│                         ▼                               │
│              ┌──────────────────────┐                   │
│              │ 统一文档模型         │                   │
│              │ {content, metadata,  │                   │
│              │  source, embedding}  │                   │
│              └──────────────────────┘                   │
│                         │                               │
│                    ┌────┴────┐                          │
│                    │ 向量存储 │                          │
│                    │ (通用)   │                          │
│                    └─────────┘                          │
└─────────────────────────────────────────────────────────┘
```

#### 关键任务
- [ ] 摄取管道 (支持多种文件格式)
- [ ] 嵌入模型管理
- [ ] 向量数据库 (sqlite-vec / LanceDB)
- [ ] 检索策略 (稀疏 + 密集混合)
- [ ] 上下文注入机制

---

## 第三阶段：生态与扩展 (3-6 个月)

### 3.1 扩展市场 (Extension Marketplace)

```
平台核心 ──────► 扩展市场
                    │
    ┌───────────────┼───────────────┐
    ▼               ▼               ▼
┌─────────┐   ┌─────────┐   ┌─────────┐
│ 工具包   │   │ Agent   │   │ 工作流  │
│ 扩展     │   │ 角色    │   │ 模板    │
│          │   │ 定义    │   │         │
├─────────┤   ├─────────┤   ├─────────┤
│• 数据库 │   │• 程序员  │   │• 日报   │
│• 云服务 │   │• 分析师  │   │• 监控   │
│• 设计   │   │• 客服    │   │• 审批   │
│• 物联网 │   │• 研究    │   │• 备份   │
└─────────┘   └─────────┘   └─────────┘
```

#### 关键任务
- [ ] 扩展包格式规范
- [ ] 本地扩展管理器
- [ ] 扩展市场 (可选)
- [ ] 扩展沙箱安全

---

### 3.2 多模态通用化

当前仅有文本，扩展为统一消息格式。

```typescript
interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'

  // 多模态内容块
  content: ContentBlock[]

  timestamp: number
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: ImageSource; mimeType: string }
  | { type: 'file'; name: string; path: string; mimeType: string }
  | { type: 'audio'; source: AudioSource; duration: number }
  | { type: 'tool_use'; tool: string; params: unknown }
  | { type: 'tool_result'; result: unknown; error?: string }

// 工具可以消费/生产任意模态
interface ToolDefinition {
  inputModality: Modality[]
  outputModality: Modality[]
}
```

#### 关键任务
- [ ] 多媒体消息格式
- [ ] 图像处理工具
- [ ] 语音输入/输出
- [ ] 工具模态声明

---

### 3.3 分布式架构 (可选)

当需要支持多用户或重负载时演进。

```
┌─────────────────────────────────────────────────────────┐
│                     Client (Electron)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  UI (React)  │  │  Local Tools │  │  Cache Layer │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────┐
│                      Gateway (API)                      │
│         认证 / 限流 / 路由 / 负载均衡                    │
└─────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│  Agent Node   │  │  Agent Node   │  │  Agent Node   │
│  (Stateless)  │  │  (Stateless)  │  │  (Stateless)  │
└───────────────┘  └───────────────┘  └───────────────┘
        │                  │                  │
        └──────────────────┼──────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Shared Storage                                         │
│  ├─ Redis (Pub/Sub, Session State)                      │
│  ├─ PostgreSQL (Persistent Data)                        │
│  └─ S3/MinIO (Files, Logs)                              │
└─────────────────────────────────────────────────────────┘
```

---

## 技术架构演进

### 当前 → 目标

```
当前架构:
apps/
├── client/          (Electron + React)
├── server/          (Node.js + Express)
└── shared-*         (类型和工具)

目标架构:
packages/
├── core/            (领域无关核心)
│   ├── agent-runtime/    (Agent 执行引擎)
│   ├── tool-protocol/    (工具协议定义)
│   ├── memory-system/    (分层记忆)
│   └── workflow-engine/  (工作流)
│
├── extensions/      (可选扩展)
│   ├── tools-browser/
│   ├── tools-bash/
│   ├── tools-file/
│   └── ... (更多工具包)
│
├── ui/
│   ├── renderer/    (React 组件库)
│   └── components/  (通用 UI 组件)
│
├── connectors/      (外部连接)
│   ├── mcp-client/
│   ├── llm-router/  (多模型统一接口)
│   └── storage-adapters/
│
└── apps/
    ├── desktop/     (Electron 壳)
    ├── web/         (未来可能的 Web 版)
    └── cli/         (命令行工具)
```

---

## 近期行动计划

### 本周
- [ ] **工具抽象层** - 提取统一 Tool 接口，为 MCP 做准备
- [ ] **工作流 PoC** - 实现最简单的顺序执行工作流
- [ ] **配置外置** - Agent 行为、系统提示词改为配置文件

### 本月
- [ ] **MCP Client** - 接入第一个外部 MCP Server
- [ ] **变量系统** - 工作流步骤间传递数据 `{{steps.0.result}}`
- [ ] **触发器框架** - 定时、文件变更、Webhook 触发工作流

### 下月
- [ ] **Agent 角色系统** - 可切换不同系统提示词组合
- [ ] **知识库接入** - 本地文件目录作为知识源
- [ ] **执行历史** - 工作流执行记录、重试、回放

---

## 附录

### 参考资源

- [Model Context Protocol](https://modelcontextprotocol.io/) - 工具标准协议
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling) - 工具调用模式
- [LangChain](https://langchain.com/) - 工作流参考
- [AutoGen](https://microsoft.github.io/autogen/) - 多 Agent 编排参考

### 术语表

| 术语 | 说明 |
|------|------|
| MCP | Model Context Protocol，模型上下文协议 |
| RAG | Retrieval-Augmented Generation，检索增强生成 |
| OPEV | Observe-Plan-Execute-Verify，观察-规划-执行-验证 |
| DAG | Directed Acyclic Graph，有向无环图 |
| WASM | WebAssembly，用于沙箱执行 |

---

*文档最后更新: 2026-06-06*
