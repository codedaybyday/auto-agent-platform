# 故障排查规则

本规则在遇到错误或排查问题时自动生效。

## 日志分析

### 日志位置

| 日志文件 | 内容 | 查看命令 |
|---------|------|---------|
| `client.log` | 主进程日志 | `tail -f client.log` |
| `server.log` | 服务端日志 | `tail -f server.log` |
| 控制台 | 开发模式输出 | `pnpm dev` |

### 常见错误模式

#### 1. WebSocket 连接失败

**症状**:
```
WebSocket not connected for session: xxx
```

**排查步骤**:
1. 检查 Server 是否启动: `lsof -i :3001`
2. 检查端口占用: `kill -9 $(lsof -t -i:3001)`
3. 查看 Server 日志是否有错误

**修复**:
```bash
# 清理端口并重启
pnpm kill:server
pnpm dev:server
```

#### 2. MCP 工具调用超时

**症状**:
```
MCP error -32001: Request timed out
```

**排查步骤**:
1. 检查 MCP Server 进程是否存活
2. 查看 Client 日志是否有工具执行错误
3. 检查具体工具实现 (browser/bash)

**修复**:
```bash
# 重启 Client
Cmd+R (Reload)
```

#### 3. TypeScript 类型错误

**症状**:
```
Type error: Cannot find module '@auto-agent/shared-types'
```

**原因**: `shared-utils` 或 `shared-types` 未构建

**修复**:
```bash
# 先构建依赖包
pnpm build

# 或只构建 shared 包
cd packages/shared-utils && pnpm build
cd packages/shared-types && pnpm build
```

#### 4. Chrome CDP 连接失败

**症状**:
```
browserType.connectOverCDP: Protocol error
```

**排查步骤**:
1. 检查 Chrome 是否启动: `curl http://localhost:9222/json/version`
2. 检查 Playwright 版本: `npm list playwright`
3. 检查 Chrome 版本: `Google Chrome --version`

**修复**:
```bash
# 升级 Playwright
pnpm add playwright@latest

# 清理临时目录
rm -rf /tmp/chrome-cdp-*
```

#### 5. 新建会话后发消息无反应

**症状**: 会话创建成功，但发送消息无响应

**原因**: HTTP 创建会话后，WebSocket 未正确初始化

**排查**:
1. 检查 `session.create` WebSocket 消息是否发送
2. 检查 Server 是否正确复用会话 ID
3. 查看 AgentLoop 是否初始化

**修复**: 参考 `session-manager.ts` 中的修复逻辑

## 调试技巧

### 开启调试日志

```bash
# Server 端
debug=* pnpm dev:server

# 或设置环境变量
DEBUG=AgentLoop,MCPToolBridge pnpm dev:server
```

### 查看 WebSocket 消息

在 `server-connection.ts` 和 `message-handler.ts` 中添加:
```typescript
console.log('[WS] Sending:', message)
console.log('[WS] Received:', message)
```

### 检查 MCP 工具列表

```bash
# 在 Client 启动后，查看注册的工具
grep "Tools registered" client.log
```

### 分析 Agent Loop 状态

```bash
# 查看 Agent Loop 执行流程
grep -E "AgentLoop|tool_start|tool_end|stream" server.log
```

## 性能问题

### Token 消耗过高

**症状**: LLM API 费用异常

**排查**:
```bash
# 查看 Token 统计
grep "estimatedTokens" server.log
```

**优化**:
1. 检查 `short-term-memory.ts` 压缩是否生效
2. 减少工具描述长度
3. 限制历史对话轮数

### 内存泄漏

**症状**: 应用运行一段时间后卡顿

**排查**:
```bash
# 查看内存使用
ps aux | grep -E "electron|node" | awk '{print $2, $4, $11}'
```

**常见原因**:
1. EventListener 未移除
2. Map/Set 无限增长
3. 循环引用

## 修复原则

### 1. 先 RCA (Root Cause Analysis)

```
❌ 错误: "可能是内存泄漏"
✅ 正确: "根因是 event listener 未移除，导致 callbacks 数组无限增长"
```

### 2. 读日志顺序

```
1. 先看 client.log (用户侧问题)
2. 再看 server.log (服务端问题)
3. 最后看控制台 (开发模式输出)
```

### 3. 验证修复

```
1. 修复代码
2. 重现问题场景
3. 确认日志无错误
4. 确认功能正常
```

## 常用命令

```bash
# 分析日志
grep -i error server.log | tail -20

# 统计错误类型
grep -oE "Failed to|Error:|Exception" server.log | sort | uniq -c

# 查看最近的 Agent 执行
grep "AgentLoop" server.log | tail -20

# 清理所有日志
> client.log && > server.log

# 重启所有服务
pkill -f "pnpm dev"
pnpm dev
```
