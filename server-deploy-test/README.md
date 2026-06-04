# Auto Agent Server

基于 Express + WebSocket 的 Agent 后端服务

## 架构特点

- **Agent Loop 在后端运行**：ReAct (Reasoning + Acting) 循环核心逻辑在服务端
- **工具执行反向调用**：通过 WebSocket 反向调用客户端执行本地工具（浏览器、bash）
- **多会话支持**：用户可同时运行多个独立会话
- **流式输出**：WebSocket 实时推送 LLM 流式响应

## 项目结构

```
src/
├── index.ts                 # 入口：HTTP API + WebSocket 服务器
├── config/
│   └── index.ts             # 配置管理
├── middleware/
│   └── auth.ts              # 认证中间件（TODO: 接入外部登录）
├── services/
│   ├── agent-loop.ts        # Agent ReAct 循环核心
│   ├── tool-bridge.ts       # 工具代理层（本地/远程路由）
│   ├── llm-client.ts        # LLM API 客户端（Claude）
│   └── session-manager.ts   # 会话管理
├── websocket/
│   └── server.ts            # WebSocket 网关
└── types/
    └── index.ts             # TypeScript 类型定义
```

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`：

```env
PORT=3000
ANTHROPIC_API_KEY=your_api_key_here
```

### 3. 启动开发服务器

```bash
pnpm dev
```

## API 文档

### HTTP API

#### 健康检查
```bash
GET /health
```

#### 创建会话
```bash
POST /api/sessions
Headers: x-user-id: {userId}
Body: { "title": "可选的会话标题" }
```

#### 获取会话列表
```bash
GET /api/sessions
Headers: x-user-id: {userId}
```

#### 发送消息（非流式）
```bash
POST /api/sessions/:sessionId/chat
Headers: x-user-id: {userId}
Body: { "content": "你好" }
```

### WebSocket 协议

连接地址：`ws://localhost:3000/ws`

#### 认证

连接后第一个消息：
```json
{
  "type": "connect",
  "messageId": "unique-id",
  "timestamp": 1234567890,
  "payload": {
    "userId": "user-123"
  }
}
```

#### 创建会话

```json
{
  "type": "session.create",
  "messageId": "unique-id",
  "timestamp": 1234567890,
  "payload": {
    "title": "新会话"
  }
}
```

#### 运行 Agent

```json
{
  "type": "agent.run",
  "messageId": "unique-id",
  "timestamp": 1234567890,
  "sessionId": "session-xxx",
  "payload": {
    "content": "打开百度搜索 Claude"
  }
}
```

服务端返回：
- `stream.chunk` - 流式文本输出
- `stream.complete` - 完成信号
- `stream.error` - 错误信息
- `tool.execute` - 工具执行请求（客户端需执行后返回 `tool.result`）

## 核心流程

### Agent Loop 执行流程

```
用户输入
    ↓
Agent Loop (后端)
    ↓
LLM 思考 → 需要工具？
    ↓ 是
调用 Tool Bridge
    ↓
本地工具？──WebSocket──► 客户端执行
    ↓
返回结果
    ↓
LLM 再次思考（循环）
    ↓ 无需工具
返回最终答案
```

### 工具类型

| 工具 | 类型 | 执行位置 |
|------|------|---------|
| `browser` | 本地 | 客户端 Playwright |
| `bash` | 本地 | 客户端系统命令 |
| `file_read/write` | 本地 | 客户端文件系统 |
| `http_request` | 远程 | 后端直接执行 |
| `search_api` | 远程 | 后端直接执行 |

## TODO

- [ ] 接入外部登录系统（参见 `middleware/auth.ts`）
- [ ] 接入 Redis 做跨实例状态同步
- [ ] 接入 PostgreSQL 做会话持久化
- [ ] 接入搜索引擎 API（SerpAPI/Bing）
- [ ] 限流和配额管理
- [ ] 多模型支持（OpenAI、千问）
- [ ] 浏览器实例池管理

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `LLM_API_KEY` | OpenAI API Key | - |
| `LLM_BASE_URL` | API 基础地址 | `https://api.openai.com/v1` |
| `LLM_MODEL` | 模型名称 | `gpt-4` |
| `NODE_ENV` | 运行环境 | `development` |

### 支持的服务商

**OpenAI:**
```bash
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4
```

**千问（阿里）:**
```bash
LLM_API_KEY=sk-...
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen-max
```

**DeepSeek:**
```bash
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
```
