# 架构设计规则

本规则在处理架构相关代码时自动生效。

## 系统架构概览

### 三层通信架构

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (Renderer)                        │
│                     React + Electron UI                       │
└───────────────────────┬─────────────────────────────────────┘
                        │ IPC
┌───────────────────────▼─────────────────────────────────────┐
│                      主进程 (Main)                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Browser工具 │  │  Bash工具   │  │    MCP Server       │  │
│  │  (CDP)      │  │  (Session)  │  │   (工具注册中心)     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└───────────────────────┬─────────────────────────────────────┘
                        │ WebSocket
┌───────────────────────▼─────────────────────────────────────┐
│                      服务端 (Server)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Agent Loop  │  │  MCP Hub    │  │   Session Manager   │  │
│  │ (ReAct模式)  │  │ (工具桥接)   │  │    (会话管理)        │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└───────────────────────┬─────────────────────────────────────┘
                        │ HTTP API
┌───────────────────────▼─────────────────────────────────────┐
│                      LLM 服务                                │
│              (OpenAI / Ollama / Anthropic)                   │
└─────────────────────────────────────────────────────────────┘
```

## 核心模块

### 1. Agent Loop (`apps/server/src/services/agent/`)

**职责**: 核心 ReAct 模式实现

**关键文件**:
- `loop.ts` - Agent 主循环，处理 Thought → Action → Observation
- `bridge.ts` - 工具执行桥接，调用 MCP Hub
- `session.ts` - 会话生命周期管理
- `dom-context.ts` - DOM 状态管理（用于浏览器工具）

**设计原则**:
- 每个会话独立的 AgentLoop 实例
- 通过 EventBus 与 WebSocket 解耦
- 支持流式响应 (SSE)

### 2. MCP Hub (`apps/server/src/services/mcp/`)

**职责**: 工具注册与调用桥接

**关键文件**:
- `hub.ts` - MCP 会话管理，处理工具调用请求/响应
- `tool-bridge.ts` - 工具执行桥接（内置工具 + MCP 工具）
- `registry.ts` - 工具注册表，管理内置和 MCP 工具

**数据流**:
```
Agent Loop → ToolBridge → MCP Hub → WebSocket → Client MCP Server
                ↓
         Built-in Tools (直接执行)
```

### 3. 内存管理 (`apps/server/src/services/memory/`)

**职责**: 分层存储优化 Token 消耗

**设计**:
- **Tier 1**: 最近 5 轮完整对话（Full Context）
- **Tier 2**: 历史对话压缩摘要（Compressed）
- 自动触发压缩当 Token 超过阈值

### 4. 客户端工具 (`apps/client/src/main/`)

**职责**: 本地工具执行

**目录结构**:
```
main/
├── tools/
│   ├── browser-manager.ts    # CDP 浏览器管理
│   ├── bash.ts               # Bash 命令执行
│   └── executor.ts           # 工具执行器
├── workspace/
│   ├── file-tools.ts         # 文件操作
│   └── sandbox.ts            # 沙盒路径管理
├── core/
│   ├── session-manager.ts    # 会话状态管理
│   └── server-connection.ts  # WebSocket 连接
└── handlers/
    ├── agent-handlers.ts     # Agent IPC 处理
    └── message-handler.ts    # WebSocket 消息处理
```

## 通信协议

### WebSocket 消息类型

| 类型 | 方向 | 说明 |
|------|------|------|
| `agent.run` | Client → Server | 启动 Agent 执行 |
| `agent.stop` | Client → Server | 停止 Agent |
| `stream.chunk` | Server → Client | 流式内容块 |
| `stream.complete` | Server → Client | 执行完成 |
| `stream.error` | Server → Client | 执行错误 |
| `mcp.callTool` | Server → Client | 调用本地工具 |
| `mcp.response` | Client → Server | 工具执行结果 |

### MCP 工具调用流程

```
1. Agent Loop 决定调用工具
2. Server 发送 mcp.callTool 到 Client
3. Client MCP Server 执行工具
4. Client 返回 mcp.response
5. Server 将结果加入上下文，继续 Loop
```

## 代码规范

### 新增服务模块

1. **目录结构**: 按功能放在 `services/<module>/`
2. **导出方式**: 统一通过 `index.ts` 导出
3. **依赖注入**: 避免循环依赖，通过构造函数注入
4. **错误处理**: 使用自定义 Error 类，包含错误码

### 文件组织

```typescript
// ✅ 正确: 相关文件放在一起
services/
├── agent/
│   ├── loop.ts           # 主逻辑
│   ├── loop.test.ts      # 测试
│   ├── types.ts          # 类型定义
│   └── index.ts          # 统一导出

// ❌ 错误: 分散在不同目录
src/
├── agent-loop.ts
├── agent-types.ts
tests/
├── agent-test.ts
```

### 命名规范

- **目录**: `kebab-case` (如 `file-storage`)
- **文件**: 与导出内容同名 (如 `class AgentLoop` → `loop.ts`)
- **测试**: 原文件名 + `.test.ts`
