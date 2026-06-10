# 多层限流系统设计文档

## 1. 设计背景

### 1.1 为什么需要限流

在多用户并发场景下，系统面临以下风险：

| 风险 | 描述 | 后果 |
|------|------|------|
| **上游限流** | LLM API (OpenAI/Claude) 有调用频率限制 | 触发 429 错误，服务不可用 |
| **资源耗尽** | 无限并发导致内存/CPU耗尽 | 服务器崩溃 |
| **恶意刷接口** | 用户或攻击者高频调用 | 影响其他用户，成本激增 |
| **工具卡死** | 浏览器/bash工具无超时 | 阻塞 Agent Loop |

### 1.2 限流目标

- **保护上游服务**：避免触发 LLM API 的限流
- **公平使用**：防止单用户耗尽系统资源
- ** graceful degradation**：限流时返回友好提示，而非崩溃
- **可观测性**：提供限流统计和监控

---

## 2. 架构设计

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                           多层限流架构                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   用户请求 ──┬──► HTTP API 路由 ──► 限流中间件 ──► 业务处理          │
│              │                              │                       │
│              │                              ▼                       │
│              │                        ┌──────────────┐              │
│              │                        │ RateLimiter  │              │
│              │                        └──────────────┘              │
│              │                              │                       │
│              └──► WebSocket ────────────────┘                       │
│                                              │                       │
│                                              ▼                       │
│                                       ┌──────────────┐              │
│                                       │  LLMClient   │              │
│                                       └──────────────┘              │
│                                                                      │
│   限流层级（从高到低）：                                              │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│   │  全局级   │ │  用户级   │ │  会话级   │ │  LLM级   │              │
│   │ 保护服务  │ │ 公平分配  │ │ 防刷消息  │ │ 保护上游  │              │
│   └──────────┘ └──────────┘ └──────────┘ └──────────┘              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 限流层级

```
请求流程中的限流检查点：

1. HTTP 请求 ──► 全局 HTTP 限流 ──► 用户 HTTP 限流 ──► 业务处理
                    (10000/min)        (100/min)

2. WebSocket ──► 用户 HTTP 限流 ──► 会话消息限流 ──► Agent Loop
                     (100/min)         (20/min)

3. LLM 调用 ──► 全局 LLM 限流 ──► 用户 LLM 限流 ──► 调用 API
                   (100/min)         (10/min)
```

### 2.3 层级说明

| 层级 | 范围 | 速率 | 突发容量 | 用途 |
|------|------|------|----------|------|
| **全局 HTTP** | 所有用户 | 166/s (10000/min) | 830 | 保护服务器整体 |
| **用户 HTTP** | 单个用户 | 1.67/s (100/min) | 8 | 防止单用户刷接口 |
| **全局 LLM** | 所有用户 | 1.67/s (100/min) | 8 | 保护上游 API |
| **用户 LLM** | 单个用户 | 0.17/s (10/min) | 1 | 控制单用户成本 |
| **会话消息** | 单个会话 | 0.33/s (20/min) | 2 | 防止会话内刷屏 |

---

## 3. 核心算法：Token Bucket

### 3.1 算法原理

Token Bucket（令牌桶）是网络流量整形和限流的经典算法。

```
Token Bucket 工作流程：

     以固定速率填充              请求来时
    ═══════════════►           消费 Token
          │                         │
          ▼                         ▼
   ┌─────────────┐           ┌─────────────┐
   │  Token 桶   │ ◄──────── │   请求处理   │
   │  (容量 C)   │  有Token? │             │
   └─────────────┘           └─────────────┘
          │                         │
          │ 无Token                 │ 允许通过
          ▼                         ▼
   ┌─────────────┐           ┌─────────────┐
   │  拒绝请求   │           │  执行请求   │
   │ 返回 retryAfter │        │             │
   └─────────────┘           └─────────────┘
```

### 3.2 算法特点

- **平滑限流**：固定速率填充，流量平滑
- **允许突发**：桶有容量，可应对突发流量
- **精确控制**：可精确控制速率和突发量

### 3.3 代码实现

```typescript
class TokenBucket {
  private tokens: number      // 当前 Token 数量
  private lastRefill: number  // 上次填充时间

  constructor(private config: {
    capacity: number,    // 桶容量（最大突发数）
    refillRate: number   // 每秒填充速率
  }) {
    this.tokens = config.capacity
    this.lastRefill = Date.now()
  }

  /**
   * 尝试消费 Token
   */
  consume(count: number = 1): boolean {
    this.refill()  // 先填充

    if (this.tokens >= count) {
      this.tokens -= count
      return true  // 允许通过
    }
    return false  // 拒绝
  }

  /**
   * 填充 Token
   */
  private refill(): void {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000  // 转换为秒

    // 计算新 Token 数 = 最小值(容量, 当前 + 填充速率 * 时间)
    this.tokens = Math.min(
      this.config.capacity,
      this.tokens + elapsed * this.config.refillRate
    )
    this.lastRefill = now
  }

  /**
   * 计算等待时间
   */
  getWaitTime(): number {
    this.refill()
    if (this.tokens >= 1) return 0

    const needed = 1 - this.tokens
    return Math.ceil(needed / this.config.refillRate * 1000)  // 毫秒
  }
}
```

### 3.4 配置计算示例

以 **用户 LLM 限流**（10/分钟）为例：

```
目标：10 requests / 60 seconds = 0.17 req/s

配置：
- refillRate = 0.17 (每秒填充 0.17 个 token)
- capacity = 0.17 * 5 = 0.85 ≈ 1 (burstMultiplier=5)

实际效果：
- 平均速率：10 req/min
- 突发能力：1 个请求（几乎无突发，适合严格限流）

如果要允许突发（比如用户偶尔需要连续调用 3 次）：
- capacity = 0.17 * 20 = 3.4 ≈ 3
- 突发能力：3 个请求
```

---

## 4. 集成点详解

### 4.1 HTTP API 限流

**位置**：`apps/server/src/index.ts`

```typescript
// 限流中间件
function rateLimitMiddleware(req: AuthRequest, res: Response, next: any) {
  const userId = req.user?.id || req.body?.userId || 'anonymous'

  const check = rateLimiter.checkHttpRequest(userId)
  if (!check.allowed) {
    res.status(429).json({
      success: false,
      error: `请求过于频繁，请 ${check.retryAfter} 秒后再试`,
      retryAfter: check.retryAfter
    })
    return
  }

  next()
}

// 应用到路由
app.post('/api/sessions', authMiddleware, rateLimitMiddleware, handler)
app.post('/api/sessions/:id/chat', authMiddleware, rateLimitMiddleware, handler)
```

**流程**：
1. 请求到达 → 2. 认证中间件 → 3. 限流中间件 → 4. 业务处理

### 4.2 WebSocket 限流

**位置**：`apps/server/src/websocket/server.ts`

```typescript
private async handleAgentRun(connection: WSConnection, message: WSMessage): Promise<void> {
  // 1. 检查用户级限流
  const userCheck = this.rateLimiter.checkHttpRequest(connection.userId)
  if (!userCheck.allowed) {
    this.sendToConnection(connection.id, {
      type: 'stream.error',
      payload: {
        error: `请求过于频繁，请 ${userCheck.retryAfter} 秒后再试`,
        retryAfter: userCheck.retryAfter
      }
    })
    return
  }

  // 2. 检查会话级限流
  const sessionCheck = this.rateLimiter.checkSessionMessage(sessionId)
  if (!sessionCheck.allowed) {
    this.sendToConnection(connection.id, {
      type: 'stream.error',
      payload: {
        error: `该会话请求过于频繁，请 ${sessionCheck.retryAfter} 秒后再试`
      }
    })
    return
  }

  // 继续处理...
}
```

**流程**：
1. WebSocket 消息 → 2. 用户限流检查 → 3. 会话限流检查 → 4. Agent Loop

### 4.3 LLM 调用限流

**位置**：`apps/server/src/services/llm-client.ts`

```typescript
async chat(messages: Message[], userId?: string): Promise<LLMResponse> {
  // 检查限流
  if (this.rateLimiter && userId) {
    const check = this.rateLimiter.checkLLMRequest(userId)
    if (!check.allowed) {
      throw new LLMAPIError(
        `请求过于频繁，请 ${check.retryAfter} 秒后再试`,
        429
      )
    }
  }

  // 调用 LLM API...
}
```

**位置**：`apps/server/src/services/agent-loop.ts`

```typescript
// 传递 userId 给 LLMClient
const response = await this.llmClient.chat(messages, this.userId)
```

**流程**：
1. Agent Loop → 2. LLM 限流检查 → 3. 调用 API → 4. 返回响应

---

## 5. 工具超时控制

### 5.1 设计原因

工具执行（如浏览器操作、bash 命令）如果没有超时：
- 浏览器页面加载卡死 → Agent Loop 永久阻塞
- 用户无法取消，只能重启服务

### 5.2 超时配置

**位置**：`apps/server/src/services/tool-bridge.ts`

```typescript
private getToolTimeout(toolName: string): number {
  const timeouts: Record<string, number> = {
    'browser': 60000,           // 浏览器操作 60s
    'browser_ai': 90000,        // AI 浏览器操作 90s（含语义解析）
    'browser_ai_execute': 60000,
    'browser_get_context': 30000,
    'bash': 30000,              // 命令行 30s
    'file_read': 5000,          // 文件读取 5s
    'file_write': 5000          // 文件写入 5s
  }
  return timeouts[toolName] || 30000
}
```

### 5.3 超时处理流程

```
工具执行流程：

后端                    WebSocket                    前端
  │                         │                          │
  ├──── tool.execute ──────►│─────────────────────────►│
  │                         │                          │
  │  ◄──── 启动定时器 ──────┤                          │
  │  (按工具类型设置超时)     │                          │
  │                         │                          │
  │                         │                          │► 执行工具
  │                         │                          │   (browser/bash)
  │                         │                          │
  │◄──────── 超时 ──────────┤                          │
  │                         │                          │
  ├─► 拒绝 pending 请求     │                          │
  │   返回 "Tool execution   │                          │
  │        timeout"          │                          │
  │                         │                          │
```

---

## 6. 监控与运维

### 6.1 健康检查接口

```bash
GET /health

响应：
{
  "status": "ok",
  "stats": {
    "rateLimit": {
      "globalHttpTokens": 185.5,      // 全局 HTTP Token 剩余
      "globalLlmTokens": 8.2,         // 全局 LLM Token 剩余
      "userHttpBuckets": 12,          // 活跃用户 HTTP 桶数
      "userLlmBuckets": 8,            // 活跃用户 LLM 桶数
      "sessionMessageBuckets": 15     // 活跃会话消息桶数
    }
  }
}
```

### 6.2 限流日志

当请求被限流时，服务器会记录日志：

```
[WebSocket] Rate limited: user-123, retryAfter: 3s
[API] Rate limited: user-456, path: /api/sessions
```

### 6.3 调整限流参数

通过环境变量调整：

```bash
# 全局 HTTP 速率 (默认 166/s = 10000/min)
RL_GLOBAL_HTTP_RPS=200

# 单用户 HTTP 速率 (默认 1.67/s = 100/min)
RL_USER_HTTP_RPS=2

# 单用户 LLM 速率 (默认 0.17/s = 10/min)
RL_USER_LLM_RPS=0.5

# 突发容量倍数 (默认 5)
RL_BURST_MULTIPLIER=10
```

---

## 7. 测试方法

### 7.1 单元测试

```bash
cd apps/server
npm test src/services/__tests__/rate-limiter.test.ts
```

### 7.2 集成测试

```bash
# 启动服务器
npm run dev

# 运行测试脚本
node test-rate-limiter.cjs
```

### 7.3 浏览器测试

```bash
# 打开浏览器测试页面
open test-rate-limiter-browser.html
```

### 7.4 手动测试

```bash
# 快速发送 10 个请求，观察限流
curl -X POST http://localhost:3000/api/sessions \
  -H "Authorization: Bearer test-token" \
  -d '{"userId": "test", "title": "Test"}'
```

---

## 8. 常见问题

### Q1: 为什么用户限流桶统计为 0？

**原因**：桶是按需创建的，只有该用户发起请求时才会创建。

**解决**：发送几个请求后再查看统计。

### Q2: 如何完全禁用限流？

```bash
# 设置非常大的值
RL_GLOBAL_HTTP_RPS=999999
RL_USER_HTTP_RPS=999999
RL_GLOBAL_LLM_RPS=999999
RL_USER_LLM_RPS=999999
```

### Q3: 限流返回什么状态码？

- **HTTP API**: 429 Too Many Requests
- **WebSocket**: `stream.error` 消息
- **LLM 调用**: 429 错误（被包装为 LLMAPIError）

### Q4: 多实例部署时限流会失效吗？

**当前实现**：内存级限流，多实例时每个实例独立计数。

**解决方案**：未来接入 Redis 实现分布式限流。

---

## 9. 未来扩展

### 9.1 Redis 分布式限流

```typescript
class RedisRateLimiter {
  async checkLLMRequest(userId: string): Promise<RateLimitCheck> {
    const key = `ratelimit:llm:${userId}`
    const current = await this.redis.incr(key)

    if (current === 1) {
      await this.redis.expire(key, 60) // 60秒窗口
    }

    return {
      allowed: current <= 10,
      retryAfter: current > 10 ? 60 - await this.redis.ttl(key) : 0
    }
  }
}
```

### 9.2 动态限流

根据系统负载动态调整限流阈值：

```typescript
if (cpuUsage > 80%) {
  rateLimiter.setGlobalHttpRate(normalRate * 0.5) // 降半速
}
```

### 9.3 用户等级配额

```typescript
const quotaTiers = {
  free: { llmRate: 0.17 },      // 10/min
  pro: { llmRate: 0.83 },       // 50/min
  enterprise: { llmRate: 3.33 } // 200/min
}
```

---

## 10. 总结

| 特性 | 实现状态 | 说明 |
|------|----------|------|
| Token Bucket 算法 | ✅ 已实现 | 内存级，精确控制速率和突发 |
| 全局 HTTP 限流 | ✅ 已实现 | 保护服务器整体 |
| 用户 HTTP 限流 | ✅ 已实现 | HTTP 中间件 + WebSocket 检查 |
| 全局 LLM 限流 | ✅ 已实现 | LLMClient 集成 |
| 用户 LLM 限流 | ✅ 已实现 | 按用户隔离 |
| 会话消息限流 | ✅ 已实现 | 防止会话内刷屏 |
| 工具超时 | ✅ 已实现 | 5s-90s 按类型配置 |
| 监控接口 | ✅ 已实现 | /health 返回限流统计 |
| Redis 分布式 | 📝 待实现 | 多实例部署需要 |
| 动态限流 | 📝 待实现 | 根据系统负载调整 |

---

*文档创建时间：2026-05-18*
