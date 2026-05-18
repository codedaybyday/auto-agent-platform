# Auto Agent Platform

AI 助手平台，支持多模型和 Agent Loop，基于 Monorepo + Electron + Node.js 构建。

## 功能特性

- **Agent Loop**: 多轮对话，AI 自主调用工具完成任务
- **多模型支持**: Claude、通义千问、DeepSeek、OpenAI 等
- **Bash 工具**: 命令行执行，支持工作目录切换和超时控制
- **Browser 工具**: 浏览器自动化，支持 SSO 登录态共享（CDP 方案）
- **多会话并发**: 支持多个独立会话同时运行

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
│   (Renderer)    │                    │   (Agent Loop)  │
└────────┬────────┘                    └────────┬────────┘
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

## 启动方式

```bash
# 开发（同时启动客户端和服务端）
pnpm dev

# 单独启动
pnpm dev:client  # 仅客户端
pnpm dev:server  # 仅服务端

# 构建
pnpm build
```

## 配置模型

复制 `.env.example` 为 `.env`，配置 API Key。支持两种协议：

- **Anthropic Messages API**: Claude 系列
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
│       ├── agent/       # Agent Loop 核心
│       ├── llm/         # LLM 客户端
│       ├── tools/       # 服务端工具
│       └── websocket/   # WebSocket 网关
├── packages/
│   ├── shared-types/    # 共享类型
│   └── shared-utils/    # 共享工具
└── docs/                # 文档
```

## License

MIT
