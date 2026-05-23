# Desktop 单机版打包指南

本文档说明如何将 Auto Agent Platform 打包为单机版桌面应用（内置服务端）。

## 架构说明

单机版将 Node.js 服务端打包进 Electron 应用，启动时自动启动内置服务：

```
┌─────────────────────────────────────────┐
│         Auto Agent Desktop              │
│  ┌─────────────────────────────────┐   │
│  │      Electron Main Process      │   │
│  │  ┌─────────────────────────┐   │   │
│  │  │   Embedded Server       │   │   │
│  │  │   (Node.js + Express)   │   │   │
│  │  └─────────────────────────┘   │   │
│  └─────────────────────────────────┘   │
│  ┌─────────────────────────────────┐   │
│  │     Electron Renderer (UI)      │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

## 打包命令

### 完整打包（生成安装包）

```bash
# macOS
pnpm build:desktop:mac

# Windows
pnpm build:desktop:win

# Linux
pnpm build:desktop:linux
```

### 快速测试（不打包成安装包）

```bash
# 生成可直接运行的应用（在 release/mac*/Auto Agent Desktop.app 或 release/win-unpacked/）
pnpm --filter=@auto-agent/client build:unpack
```

## 开发 vs 打包模式行为差异

| 场景 | 开发模式 (`pnpm dev`) | 打包模式 |
|------|----------------------|----------|
| 服务端来源 | 需手动启动外部服务 | 自动启动内置服务 |
| 服务地址 | `VITE_SERVER_URL` 或 `ws://localhost:3001` | `ws://localhost:3001`（固定） |
| Server 代码 | 热更新 | 打包时的静态文件 |

## 实现原理

### 1. 服务端打包

`electron-builder.yml` 配置将服务端作为 `extraResources` 打包：

```yaml
extraResources:
  - from: ../server/dist
    to: server
  - from: ../server/package.json
    to: server/package.json
```

### 2. 自动启动服务

主进程检测 `app.isPackaged`：

```typescript
// 打包模式：启动内置服务
if (app.isPackaged) {
  await startEmbeddedServer()
}

// 开发模式：连接外部服务
const SERVER_URL = app.isPackaged
  ? `ws://localhost:${EMBEDDED_SERVER_PORT}`
  : (process.env.VITE_SERVER_URL || 'ws://localhost:3001')
```

### 3. 生命周期管理

- **启动时**：主进程先启动服务端子进程，等待服务就绪后再创建窗口
- **退出时**：自动停止服务端进程（发送 `SIGTERM`，超时后 `SIGKILL`）

## 注意事项

1. **端口占用**：内置服务固定使用 3001 端口，确保该端口未被占用
2. **Node.js 依赖**：打包后的应用需要系统安装 Node.js 才能运行内置服务
3. **服务端代码更新**：修改服务端代码后需要重新打包客户端

## 故障排查

### 服务端启动失败

查看控制台输出中的 `[Server Error]` 日志，常见问题：

- 端口被占用：关闭占用 3001 端口的进程
- 缺少 Node.js：安装 Node.js 18+
- 服务端构建问题：运行 `pnpm --filter=@auto-agent/server build`

### 调试打包后的应用

```bash
# macOS
/Applications/Auto\ Agent\ Desktop.app/Contents/MacOS/Auto\ Agent\ Desktop

# 或查看 release/mac*/Auto Agent Desktop.app 的日志
```

## 优化方向（可选）

1. **将 Node.js 打包进应用**：使用 `pkg` 或 `nexe` 将服务端打包成独立可执行文件，消除对外部 Node.js 的依赖
2. **动态端口**：如果 3001 被占用，自动选择其他可用端口
3. **系统托盘**：最小化到托盘，后台保持服务运行
