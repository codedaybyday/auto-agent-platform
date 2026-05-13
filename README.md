# Auto Agent Platform

一个支持多模型和 Agent Loop 的 AI 助手平台，基于 Monorepo + Electron + Node.js 构建。

## 功能特性

- **Agent Loop 对话**: 支持多轮对话，AI 可以自主决定使用工具来完成任务
- **多模型支持**: 支持 Claude、通义千问、DeepSeek、OpenAI 等多种 LLM
- **Bash 工具**: 执行命令行操作，包括文件操作、系统命令等
- **Browser 工具**: 控制浏览器进行网页导航、元素交互、截图等操作
- **实时消息展示**: 清晰展示对话历史、工具调用过程和结果

## 技术栈

- **Turborepo**: Monorepo 管理
- **pnpm**: 包管理
- **Electron**: 桌面客户端
- **React 18**: UI 框架
- **Node.js + Express**: 服务端
- **WebSocket**: 实时通信
- **TypeScript**: 类型安全
- **Anthropic SDK / OpenAI SDK**: LLM API 调用
- **Playwright**: 浏览器自动化

## 支持的模型

### 预设模型
- **Claude 3.5 Sonnet** - Anthropic 官方 API
- **Claude 3 Opus** - Anthropic 官方 API
- **Claude 3.5 Haiku** - Anthropic 官方 API

### 自定义配置
支持通过 OpenAI 兼容接口接入的模型：
- **通义千问** (阿里云)
- **DeepSeek**
- **OpenAI**
- **Azure OpenAI**
- 其他兼容 OpenAI API 的模型

## 快速开始

### 前置要求

- Node.js >= 18
- pnpm >= 9.0.0

### 安装依赖

```bash
pnpm install
```

### 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，配置必要的 API Key
```

### 开发模式

```bash
# 同时启动客户端和服务端
pnpm dev

# 只启动客户端
pnpm dev:client

# 只启动服务端
pnpm dev:server
```

### 构建应用

```bash
# 构建所有包
pnpm build

# 单独构建客户端
pnpm --filter client build

# 单独构建服务端
pnpm --filter server build
```

## 使用说明

### 1. 设置 API Key 和模型

1. 打开应用后，点击左侧「设置」进入设置页面
2. 选择预设模型或「自定义配置」
3. 输入 API Key
4. 如果是自定义配置，填写：
   - **模型名称**: 如 `qwen-max`, `deepseek-chat`
   - **API 地址**: 如 `https://dashscope.aliyuncs.com/compatible-mode/v1`
   - **API 协议**: 大多数国产模型选择 `OpenAI Chat Completions`
5. 点击「保存配置」

### 2. 开始对话

1. 点击左侧「对话」进入对话页面
2. 在输入框中输入你的请求
3. 按 Enter 发送消息

### 3. 工具使用示例

**Bash 工具示例:**
```
请查看当前目录下的文件列表
```

**Browser 工具示例:**
```
打开浏览器并访问 github.com
```

**组合任务示例:**
```
查看当前目录，然后创建一个 test.txt 文件
```

## 工具说明

### Bash 工具

支持的操作：
- 执行任意 shell 命令
- 指定工作目录
- 设置超时时间

参数：
- `command`: 要执行的命令（必需）
- `working_dir`: 工作目录（可选）
- `timeout`: 超时时间，单位毫秒（默认 30000）

### Browser 工具

支持的操作：
- `navigate`: 导航到指定 URL
- `click`: 点击页面元素
- `type`: 在输入框中输入文本
- `screenshot`: 截图
- `get_text`: 获取页面文本内容
- `scroll`: 滚动页面
- `wait`: 等待指定时间或元素
- `back`/`forward`: 浏览器前进后退
- `close`: 关闭浏览器

## 自定义模型配置示例

### 通义千问
```
模型名称: qwen-max
API 地址: https://dashscope.aliyuncs.com/compatible-mode/v1
API 协议: OpenAI Chat Completions
```

### DeepSeek
```
模型名称: deepseek-chat
API 地址: https://api.deepseek.com
API 协议: OpenAI Chat Completions
```

### OpenAI
```
模型名称: gpt-4
API 地址: https://api.openai.com/v1
API 协议: OpenAI Chat Completions
```

## 项目结构

```
auto-agent-platform/
├── apps/
│   ├── client/              # Electron 桌面客户端
│   │   ├── src/
│   │   │   ├── renderer/   # React UI
│   │   │   ├── main/       # Electron 主进程
│   │   │   └── preload/    # Preload 脚本
│   │   └── package.json
│   │
│   └── server/              # Node.js 服务端
│       ├── src/
│       │   ├── agent/      # Agent Loop 核心
│       │   ├── llm/        # LLM 客户端
│       │   ├── tools/      # 工具实现
│       │   ├── websocket/  # WebSocket 网关
│       │   └── config/     # 配置管理
│       └── package.json
│
├── packages/
│   ├── shared-types/        # 共享类型定义
│   │   └── src/index.ts
│   │
│   └── shared-utils/        # 共享工具函数
│       └── src/index.ts
│
├── package.json             # Root workspace
├── pnpm-workspace.yaml      # pnpm workspace
├── turbo.json               # Turborepo pipeline
└── .env.example             # 环境变量示例
```

## 架构说明

### API 协议支持

应用支持两种 API 协议：

1. **Anthropic Messages API**: Claude 系列模型原生协议
2. **OpenAI Chat Completions API**: 业界通用的标准协议，千问、DeepSeek 等模型兼容

### 模型切换

用户可以在设置页面随时切换模型：
- 切换到预设模型: 自动使用对应的协议和配置
- 切换到自定义模型: 需要填写完整的模型信息

配置保存在本地 `localStorage` 中，下次启动自动恢复。

## 注意事项

1. **安全性**: Bash 工具可以执行任意命令，请谨慎使用
2. **API Key**: API Key 仅存储在本地 localStorage 中
3. **浏览器**: Browser 工具会启动一个可见的浏览器窗口进行自动化操作
4. **网络**: 需要网络连接才能调用 LLM API

## License

MIT
