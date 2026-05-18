# Auto Agent Platform

AI 助手平台，支持多模型和 Agent Loop，基于 Monorepo + Electron + Node.js 构建。

## 功能特性

### Core
- **Agent Loop**: 多轮对话，AI 自主规划并调用工具完成任务
- **多模型支持**: Claude、通义千问、DeepSeek、OpenAI 等，支持 Anthropic 和 OpenAI 两种 API 协议
- **多会话并发**: 支持多个独立会话同时运行，会话级资源隔离
- **智能记忆管理**: 分层存储架构（Tier 1 + Tier 2），LLM 智能压缩历史对话

### 工具能力
- **Bash 工具**: 命令行执行，支持工作目录持久化、超时控制、安全拦截
- **Browser 工具**: 浏览器自动化，支持 CDP 元素定位、语义化操作、截图、数据提取
- **SSO 登录态共享**: 通过独立 Chrome 实例 + CDP 方案，自动继承系统登录态
- **Stealth 模式**: 反爬检测绕过，模拟真实用户行为

### 服务端能力
- **多层限流**: Token Bucket 算法，支持全局/用户/会话三级限流（HTTP/LLM/消息）
- **安全策略**: Bash 危险命令拦截、Browser URL 白名单、SSRF 防护
- **资源管理**: 会话级浏览器 Tab 隔离、进程自动清理、心跳检测

### 用户体验
- **Markdown 渲染**: 支持代码高亮、表格、列表等富文本展示
- **登录系统**: SSO 集成，支持登录态持久化
- **会话管理**: 创建、删除、历史记录查看

## 技术栈

- **Turborepo + pnpm**: Monorepo 管理
- **Electron + React 18**: 桌面客户端
- **Node.js + Express**: 服务端
- **WebSocket**: 实时通信
- **Playwright**: 浏览器自动化

## 架构

```
┌─────────────────┐     WebSocket      ┌─────────────────┐
│   Electron      │ ◄────────────────► │   Node.js       │
│   (Renderer)    │     Http（请求模型） │   (Agent Loop)  │
└────────┬────────┘ -────────────────► └────────┬────────┘
         │                                      │
         │ IPC                                  │ LLM API
         ▼                                      ▼
┌─────────────────┐                    ┌─────────────────┐
│   Main Process  │ ── CDP / Tools ──► │   Claude/千问   │
│   (Browser/Bash)│                    │   /DeepSeek     │
└─────────────────┘                    └─────────────────┘
```

### 通信机制

| 层级 | 协议 | 用途 |
|------|------|------|
| UI ↔ Main | Electron IPC | 工具调用、状态同步 |
| UI ↔ Server | WebSocket | 消息流、Agent Loop |
| Main ↔ Browser | CDP (port 9222) | 浏览器控制 |

## 记忆管理

采用分层存储架构，平衡上下文质量和成本：

### Tier 1: 最近对话（完整保留）
- 默认保留最近 **5 轮**对话的完整内容
- 包含用户输入、助手回复、工具调用结果
- 同步构建上下文，零延迟

### Tier 2: 历史对话（LLM 智能压缩）
- 超过 5 轮的对话由 LLM 异步压缩
- 压缩为结构化摘要：意图、行动、结果、关键点
- 支持轻量级模型（gpt-4o-mini、qwen-turbo）控制成本
- LLM 失败时自动回退到规则压缩

### 配置
```bash
# 配置压缩专用模型（可选，默认使用主 LLM 配置）
COMPRESSION_MODEL=gpt-4o-mini
COMPRESSION_BASE_URL=https://api.openai.com/v1
COMPRESSION_API_KEY=sk-xxx

# 调整保留轮数
# 代码中配置: fullContextRounds: 5, maxCompressedRounds: 20
```

---

## 启动方式（目前建议本地启动）

```bash
# pnpm 安装（node 环境）
npm install -g pnpm
pnpm i
# 开发（同时启动客户端和服务端）
pnpm dev # 不建议，会比较卡顿

# 单独启动
pnpm dev:client  # 仅客户端
pnpm dev:server  # 仅服务端

# 构建
pnpm build
```

## 配置模型

复制 `apps/server/.env.example` 为 `apps/server/.env`，配置 API Key。支持两种协议(建议使用 OpenAI Chat Completions API)：

- **Anthropic Messages API**: Claude 系列（未完成）
- **OpenAI Chat Completions API**: 千问、DeepSeek、OpenAI 等

### 快速配置示例

| 模型 | 模型名称 | API 地址 |
|------|---------|---------|
| 通义千问 | `qwen-max` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| DeepSeek | `deepseek-chat` | `https://api.deepseek.com` |
| OpenAI | `gpt-4` | `https://api.openai.com/v1` |

## 工具能力

### Bash 工具

```typescript
{
  command: string      // 执行的命令
  workingDir?: string  // 工作目录
  timeout?: number     // 超时时间（默认 30s）
}
```

### Browser 工具

| 操作 | 说明 |
|------|------|
| `navigate` | 导航到 URL |
| `click` | 点击元素 |
| `type` | 输入文本 |
| `screenshot` | 截图 |
| `get_text` | 获取页面文本 |
| `scroll` | 滚动页面 |
| `semantic` | AI 语义化操作 |

**SSO 登录态**: 通过 CDP 连接独立 Chrome 实例，自动继承系统 Chrome 的登录态。

## 项目结构

```
auto-agent-platform/
├── apps/
│   ├── client/          # Electron 客户端
│   │   ├── renderer/    # React UI
│   │   ├── main/        # 主进程（Browser/Bash 工具）
│   │   └── preload/     # Preload 脚本
│   └── server/          # Node.js 服务端
│       ├── routes/             # HTTP API 路由
│       │   ├── index.ts        # 路由汇总 + 中间件
│       │   ├── health.ts       # 健康检查
│       │   ├── sessions.ts     # 会话管理 CRUD
│       │   ├── messages.ts     # 消息发送/获取/清除
│       │   └── debug.ts        # 开发调试
│       ├── services/           # 业务服务层
│       │   ├── agent/          # Agent 核心
│       │   │   ├── loop.ts     # Agent Loop 核心（ReAct）
│       │   │   ├── session.ts  # 会话管理
│       │   │   └── bridge.ts   # 工具桥接
│       │   ├── llm/            # LLM 相关
│       │   │   ├── client.ts   # LLM 客户端
│       │   │   ├── compressor.ts # LLM 智能压缩器
│       │   │   └── parser.ts   # Browser AI 语义解析
│       │   ├── memory/         # 记忆管理
│       │   │   └── short-term.ts # 短期记忆（分层压缩）
│       │   ├── rate-limiter.ts # 限流器
│       │   └── __tests__/      # 单元测试
│       ├── websocket/   # WebSocket 网关
│       ├── app.ts       # Express 应用配置
│       ├── server.ts    # 服务器启动逻辑
│       └── types/       # 类型定义
├── packages/
│   ├── shared-types/    # 共享类型
│   └── shared-utils/    # 共享工具
└── docs/                # 文档
│   ├── llm-compression-design.md  # 智能压缩方案设计
│   └── ...
```

## License

MIT
