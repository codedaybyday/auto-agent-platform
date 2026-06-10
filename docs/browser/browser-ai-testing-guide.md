# Browser AI 测试指南

## 前置条件

1. 确保服务端和客户端代码已更新
2. 确保有可用的 LLM API Key（OpenAI 或其他）

## 测试步骤

### 步骤 1: 启动服务端

```bash
cd apps/server
pnpm dev
```

服务端应该在 `http://localhost:3001` 启动

### 步骤 2: 启动客户端

```bash
cd apps/client
pnpm dev
```

客户端应该会自动连接到服务端

### 步骤 3: 测试 Browser AI 工具

在客户端界面中，输入以下测试用例：

#### 测试 1: 基础导航
```
打开 example.com
```

**预期行为**:
- AI 调用 `browser_ai` 工具
- instruction: `"go to example.com"`
- 浏览器打开并显示 example.com

#### 测试 2: 页面摘要
```
获取当前页面的结构
```

**预期行为**:
- AI 调用 `browser_ai` 工具
- instruction: `"get page summary"`
- 返回类似：
```
Page: Example Domain
URL: https://example.com

Available Elements:
  [e1] link: "More information..."
...
```

#### 测试 3: 点击操作
```
点击页面上的链接
```

**预期行为**:
- AI 可能先获取页面摘要找到 ref
- 然后调用 `browser_ai` 工具
- ref: `"e1"` (或其他 ref)

#### 测试 4: 复杂任务
```
搜索 TypeScript 教程
```

**预期行为**:
- AI 调用 `browser_ai` 导航到搜索引擎
- 然后调用搜索功能

### 步骤 4: 查看日志

**服务端日志** (`apps/server`):
```
[AgentLoop] 检测到 1 个工具调用
[AgentLoop] 执行工具: browser_ai
```

**客户端日志** (`apps/client`):
```
[Main] Executing tool: browser_ai
[BrowserAI] Semantic action: go to example.com
```

## 故障排查

### 问题 1: 工具没有被调用

**检查**:
1. 服务端是否正确重启
2. 检查 `llm-client.ts` 中的 `getTools()` 是否包含 `browser_ai`

### 问题 2: 客户端报错找不到 browserAI

**检查**:
1. 确保 `browser-ai.ts` 文件存在
2. 检查导出语句是否正确

### 问题 3: 安全拦截

**现象**: 访问被拒绝

**解决**: 检查安全策略，如果是测试环境可以临时放宽：
```typescript
// 在 browser-ai.ts 中使用宽松模式
import { permissiveSecurityGuard } from './browser-security.js'
const browser = new BrowserAI({
  securityGuard: permissiveSecurityGuard
})
```

## 验证清单

- [ ] 服务端启动无报错
- [ ] 客户端启动无报错
- [ ] WebSocket 连接成功
- [ ] AI 调用 `browser_ai` 工具
- [ ] 浏览器窗口打开
- [ ] 页面导航成功
- [ ] Snapshot 被捕获
- [ ] 操作历史被记录

## 进阶测试

### 测试安全层

尝试访问被禁止的地址：
```
访问 http://localhost:3000
```

**预期**: 安全拦截，返回错误信息

### 测试 Snapshot 引用

```
获取页面摘要，然后点击第一个链接
```

**预期**: AI 能获取摘要并使用 ref 点击
