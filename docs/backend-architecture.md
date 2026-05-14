# Express + TypeScript 后端架构方案

> 适用于 AI Agent 平台的可演进后端架构

## 1. 项目结构

```
apps/server/
├── src/
│   ├── index.ts              # 入口：组装所有模块
│   ├── app.ts                # Express 应用实例
│   ├── config/
│   │   └── index.ts          # 环境变量配置
│   ├── routes/
│   │   ├── index.ts          # 路由聚合
│   │   ├── agent.ts          # Agent 相关 API
│   │   ├── health.ts         # 健康检查
│   │   └── tools.ts          # 工具调用
│   ├── services/
│   │   ├── agent-manager.ts  # Agent 会话管理
│   │   ├── llm-client.ts     # 模型调用封装
│   │   └── tool-registry.ts  # 工具注册中心
│   ├── middleware/
│   │   ├── error-handler.ts  # 全局错误处理
│   │   ├── request-logger.ts # 请求日志
│   │   └── validate.ts       # 参数校验
│   ├── types/
│   │   └── index.ts          # 类型定义
│   └── utils/
│       └── logger.ts         # 日志工具
└── package.json
```

## 2. 核心模块设计

### 2.1 Agent Manager（会话管理）

**职责：**
- 管理多个 Agent 实例（每个用户一个）
- 维护对话历史
- 处理状态持久化

**实现要点：**
```typescript
// 内存存储（MVP）→ Redis（生产）
class AgentManager {
  private agents = new Map<string, Agent>()

  getOrCreate(userId: string, config: AgentConfig): Agent
  delete(userId: string): void
  getStatus(userId: string): AgentStatus
}
```

### 2.2 WebSocket Gateway（实时通信）

**职责：**
- 流式输出 LLM 响应
- 推送工具执行状态
- 心跳检测

**实现要点：**
```typescript
// 使用 ws 库
wss.on('connection', (ws, req) => {
  const userId = authenticate(req)
  const agent = agentManager.getOrCreate(userId)

  ws.on('message', (data) => {
    const { type, payload } = JSON.parse(data)
    // 流式处理 LLM 响应
    agent.streamChat(payload.message, (chunk) => {
      ws.send(JSON.stringify({ type: 'chunk', data: chunk }))
    })
  })
})
```

### 2.3 Tool Registry（工具注册）

**职责：**
- 统一管理工具（bash、browser、file 等）
- 参数校验
- 权限控制

**实现要点：**
```typescript
interface Tool {
  name: string
  description: string
  inputSchema: JSONSchema
  execute: (input: unknown) => Promise<ToolResult>
}

class ToolRegistry {
  private tools = new Map<string, Tool>()

  register(tool: Tool): void
  async execute(name: string, input: unknown): Promise<ToolResult>
  list(): ToolInfo[]
}
```

### 2.4 LLM Client（模型调用）

**职责：**
- 统一封装 Claude/OpenAI/千问 等接口
- 处理重试、超时
- Token 计算

**实现要点：**
```typescript
interface LLMClient {
  chat(messages: Message[], options: ChatOptions): Promise<ChatResponse>
  stream(messages: Message[], callback: StreamCallback): Promise<void>
}

// 支持多种协议
class AnthropicClient implements LLMClient { }
class OpenAICompatibleClient implements LLMClient { }
```

## 3. API 路由设计

| 路由 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/api/agent/chat` | POST | 非流式对话 |
| `/api/agent/stream` | POST | SSE 流式对话 |
| `/api/agent/history` | GET/DELETE | 获取/清除历史 |
| `/api/tools` | GET | 获取可用工具列表 |
| `/ws` | WebSocket | 实时双向通信 |

## 4. 中间件设计

| 中间件 | 职责 |
|--------|------|
| `request-logger` | 记录请求响应时间、状态码 |
| `error-handler` | 统一错误格式，区分业务/系统错误 |
| `validate` | 基于 Zod 的参数校验 |
| `auth` | JWT 验证（可选） |
| `rate-limit` | IP/用户限流（可选） |

## 5. 演进路线

### Phase 1（现在）
- 基础 Express + tsx watch
- 内存存储 Agent 状态
- HTTP API + 简单 WebSocket

### Phase 2（增长期）
- 引入 Zod 做参数校验
- 添加 pino 日志
- 接入 Redis 做状态持久化

### Phase 3（稳定期）
- 添加单元测试（vitest）
- Docker 化部署
- 接入 Prometheus 监控

## 6. 依赖建议

```json
{
  "dependencies": {
    "express": "^4.19",
    "ws": "^8.17",
    "zod": "^3.23",
    "pino": "^9.0",
    "pino-pretty": "^11.0",
    "@anthropic-ai/sdk": "^0.24"
  }
}
```

## 7. 关键技术决策

| 决策 | 选型 | 理由 |
|------|------|------|
| 热重载 | tsx watch | 比 ts-node-dev 更快，支持 ESM |
| 校验 | Zod | TypeScript-first，类型推导强 |
| 日志 | Pino | 高性能，JSON 格式便于采集 |
| 配置 | dotenv | 简单够用，不引入复杂配置中心 |

## 8. 备选方案详细对比

### 8.1 方案一：Express + WebSocket 渐进式（当前选型）

适合当前阶段，保持现状逐步演进。

**优点：**
- 上手快，团队熟悉度高
- 生态成熟，中间件丰富（cors, helmet, rate-limit）
- 适合快速验证产品需求

**缺点：**
- 缺乏模块化规范，项目大了容易混乱
- 没有内置依赖注入，测试较麻烦
- TypeScript 支持需要额外配置

**适用：** MVP 阶段、小团队

---

### 8.2 方案二：NestJS 企业级架构

**优点：**
- 开箱即用的模块化、依赖注入
- 内置 WebSocket Gateway、GraphQL、微服务支持
- 装饰器语法清晰，代码结构规范
- 与 Prisma/TypeORM 集成好

**缺点：**
- 学习曲线陡峭
- 样板代码多，过度设计风险
- 启动较慢（依赖反射元数据）

**适用：** 团队协作、长期维护项目

---

### 8.3 方案三：Fastify 高性能架构

**优点：**
- 比 Express 快 2-3 倍，JSON 序列化优化
- 自带 JSON Schema 验证（TypeBox/Zod）
- 插件系统轻量，启动快
- 原生 async/await 支持

**缺点：**
- 生态不如 Express 丰富
- 部分中间件需要适配
- 团队需要适应新 API

**适用：** 高并发、性能敏感场景

---

### 8.4 方案四：Serverless 云函数（Vercel/AWS Lambda）

**优点：**
- 按调用付费，成本低
- 自动扩缩容，无需运维
- 前端同构部署方便

**缺点：**
- Cold Start 延迟（WebSocket 需额外方案）
- Agent 状态管理困难（需外接 Redis/DynamoDB）
- 执行时长限制（API Gateway 30s）

**适用：** 低频调用、无状态 API

---

### 8.5 方案五：Microservices 微服务

**优点：**
- Agent/Tool/Auth 服务独立部署
- 技术栈灵活（Python 做 AI，Node 做网关）
- 故障隔离，团队并行开发

**缺点：**
- 运维复杂度爆炸
- 分布式事务、链路追踪成本高
- 部署链路长

**适用：** 大厂、多团队大型项目

---

### 8.6 主流方案对比矩阵（AI Agent 平台）

| 维度 | Express | NestJS | Fastify | Serverless |
|------|---------|--------|---------|------------|
| 社区流行度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| AI 工具集成 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| 实时通信 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐ |
| 团队效率 | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| 长期维护 | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| 性能 | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| 学习成本 | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| 部署复杂度 | ⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |

> 注：⭐ 越多表示越好

---

### 8.7 行业趋势参考

**主流 AI Agent 产品后端架构：**

| 产品 | 后端技术 | 特点 |
|------|----------|------|
| **Cursor** | Electron + 本地后端 | 避免云端延迟，Agent 完全本地运行 |
| **Cline** | VS Code Extension + 本地 | 利用 IDE 运行时，零网络依赖 |
| **Claude Desktop** | Electron + 本地服务 | 仅模型调用走云端，工具本地执行 |
| **OpenAI GPTs** | 云端微服务 | 功能封装为 Action，无状态 API |
| **LangChain Cloud** | Python FastAPI + 微服务 | 多语言支持，强调可观测性 |

**趋势判断：**
- Agent 工具执行趋向本地（延迟敏感）
- 云端仅做模型中转和数据分析
- WebSocket/SSE 成为流式输出标配

---

### 8.8 我们的演进建议

**当前阶段（0→1）：** 保持 Express + tsx watch，快速迭代

**增长阶段（1→10）：**
- 若团队协作问题突出 → 迁移 NestJS
- 若性能瓶颈明显 → Fastify + 独立 WebSocket 服务（uWebSockets.js）

**稳定阶段（10+）：**
- Agent 核心逻辑保持本地（Electron 主进程）
- 云端仅做：
  - 模型调用中转（多 Key 轮询）
  - 使用数据分析
  - 工具市场分发

---

*文档创建时间：2026-05-14*
