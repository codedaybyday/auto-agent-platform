# Agent Loop 多用户并发方案

> 方案1（Agent-loop 在后端）的多用户并发处理设计

## 1. 并发场景分析

### 1.1 什么是多用户并发

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           多用户并发场景                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  用户 A (在线)          用户 B (在线)          用户 C (在线)                   │
│     │                      │                      │                         │
│     ▼                      ▼                      ▼                         │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐              │
│  │ 会话 A1      │      │ 会话 B1      │      │ 会话 C1      │              │
│  │  - Agent Loop│      │  - Agent Loop│      │  - Agent Loop│              │
│  │  - 运行中     │      │  - 运行中     │      │  - 等待中     │              │
│  └──────────────┘      └──────────────┘      └──────────────┘              │
│       │                      │                      │                       │
│       ▼                      ▼                      ▼                       │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐              │
│  │ 本地浏览器    │      │ 本地浏览器    │      │ 本地浏览器    │              │
│  │ 实例 A        │      │ 实例 B        │      │ 实例 C        │              │
│  └──────────────┘      └──────────────┘      └──────────────┘              │
│                                                                             │
│  并发挑战：                                                                   │
│  1. 如何隔离不同用户的 Agent Loop？                                           │
│  2. 如何管理大量 WebSocket 连接？                                             │
│  3. 如何防止单个用户耗尽服务器资源？                                           │
│  4. 多实例部署时如何保持会话粘性？                                             │
│  5. 数据库并发写入如何处理？                                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 并发带来的问题

| 问题 | 描述 | 风险 |
|------|------|------|
| **内存泄漏** | 每个 Agent Loop 占用内存，用户多了累积 | 服务器 OOM |
| **浏览器实例爆炸** | 每个用户一个 Playwright 实例 | 系统资源耗尽 |
| **WebSocket 连接数** | 单机连接上限（约 1-10万） | 新用户无法连接 |
| **LLM API 限流** | 并发调用触发 Claude 限流 | 服务不可用 |
| **数据库锁竞争** | 多会话同时写入历史记录 | 性能下降/死锁 |
| **会话状态丢失** | 多实例部署时用户连到不同机器 | 状态不一致 |

## 2. 并发架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              负载均衡层 (Nginx/CDN)                          │
│                    SSL 终止 / 静态资源缓存 / 限流                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           WebSocket 网关层                                    │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  功能：                                                                │  │
│  │  - 连接管理（支持 10万+ 并发连接）                                       │  │
│  │  - 会话路由（根据 userId 路由到正确实例）                                │  │
│  │  - 心跳检测                                                            │  │
│  │  - 负载均衡（选择低负载实例）                                            │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
            ┌─────────────────────────┼─────────────────────────┐
            ▼                         ▼                         ▼
┌───────────────────┐     ┌───────────────────┐     ┌───────────────────┐
│   后端实例 1       │     │   后端实例 2       │     │   后端实例 N       │
│  (Agent Worker)   │     │  (Agent Worker)   │     │  (Agent Worker)   │
│                   │     │                   │     │                   │
│  ┌─────────────┐  │     │  ┌─────────────┐  │     │  ┌─────────────┐  │
│  │ Agent Loop  │  │     │  │ Agent Loop  │  │     │  │ Agent Loop  │  │
│  │ 用户A-会话1 │  │     │  │ 用户B-会话1 │  │     │  │ 用户C-会话1 │  │
│  ├─────────────┤  │     │  ├─────────────┤  │     │  ├─────────────┤  │
│  │ Agent Loop  │  │     │  │ Agent Loop  │  │     │  │ Agent Loop  │  │
│  │ 用户A-会话2 │  │     │  │ 用户B-会话2 │  │     │  │ 用户D-会话1 │  │
│  └─────────────┘  │     │  └─────────────┘  │     │  └─────────────┘  │
└────────┬──────────┘     └────────┬──────────┘     └────────┬──────────┘
         │                         │                         │
         └─────────────────────────┼─────────────────────────┘
                                   ▼
              ┌──────────────────────────────────────────┐
              │              Redis 集群                   │
              │  ┌────────────┐ ┌────────────┐           │
              │  │ 会话状态   │ │ 分布式锁   │           │
              │  │ WebSocket  │ │ 限流计数   │           │
              │  │ 订阅发布   │ │ 在线状态   │           │
              │  └────────────┘ └────────────┘           │
              └──────────────────────────────────────────┘
                                   │
                                   ▼
              ┌──────────────────────────────────────────┐
              │           PostgreSQL 主从                 │
              │  - 用户数据 / 会话历史                    │
              │  - 读写分离                               │
              └──────────────────────────────────────────┘
```

### 2.2 会话隔离架构

```typescript
// apps/server/src/services/session-manager.ts

interface SessionContext {
  sessionId: string
  userId: string
  instanceId: string        // 所在后端实例ID
  wsConnectionId: string    // WebSocket 连接ID
  createdAt: Date
  lastActiveAt: Date
  status: 'active' | 'idle' | 'suspended'
}

class SessionManager {
  // 本地缓存（当前实例的会话）
  private localSessions = new Map<string, Session>()
  
  // Redis 存储（全局会话状态）
  private redis: Redis
  
  /**
   * 创建新会话
   * 限制：单个用户最大并发会话数
   */
  async createSession(userId: string, options: SessionOptions): Promise<Session> {
    // 1. 检查用户会话数限制
    const userSessionCount = await this.getUserSessionCount(userId)
    if (userSessionCount >= this.config.maxSessionsPerUser) {
      throw new Error(`用户 ${userId} 已达到最大会话数限制 (${this.config.maxSessionsPerUser})`)
    }
    
    // 2. 生成会话ID
    const sessionId = generateUUID()
    
    // 3. 检查全局资源限制
    const globalSessionCount = await this.getGlobalSessionCount()
    if (globalSessionCount >= this.config.maxGlobalSessions) {
      throw new Error('服务器已达到全局会话数上限，请稍后重试')
    }
    
    // 4. 创建会话
    const session = new Session({
      id: sessionId,
      userId,
      instanceId: this.instanceId,
      maxIterations: options.maxIterations || 50,
      createdAt: new Date()
    })
    
    // 5. 本地存储
    this.localSessions.set(sessionId, session)
    
    // 6. Redis 全局注册
    await this.redis.hset(`user:${userId}:sessions`, sessionId, JSON.stringify({
      instanceId: this.instanceId,
      createdAt: Date.now(),
      status: 'active'
    }))
    
    // 7. 增加计数器
    await this.redis.incr('global:session_count')
    await this.redis.incr(`user:${userId}:session_count`)
    
    return session
  }
  
  /**
   * 获取会话（支持跨实例查找）
   */
  async getSession(sessionId: string): Promise<Session | null> {
    // 1. 先查本地
    const localSession = this.localSessions.get(sessionId)
    if (localSession) {
      return localSession
    }
    
    // 2. 查 Redis 看会话在哪个实例
    const sessionInfo = await this.redis.hgetall(`session:${sessionId}`)
    if (!sessionInfo) {
      return null
    }
    
    // 3. 如果在其他实例，需要转发请求（或通过 Redis Pub/Sub 通信）
    if (sessionInfo.instanceId !== this.instanceId) {
      // 选项1：返回错误，让网关重定向到正确实例
      // 选项2：通过 Redis 转发请求
      return this.getSessionFromRemoteInstance(sessionInfo.instanceId, sessionId)
    }
    
    return null
  }
  
  /**
   * 清理用户所有会话（用于登出或资源回收）
   */
  async cleanupUserSessions(userId: string): Promise<void> {
    const sessions = await this.redis.hgetall(`user:${userId}:sessions`)
    
    for (const [sessionId, info] of Object.entries(sessions)) {
      const sessionInfo = JSON.parse(info)
      
      if (sessionInfo.instanceId === this.instanceId) {
        // 本地清理
        const session = this.localSessions.get(sessionId)
        if (session) {
          await session.destroy()
          this.localSessions.delete(sessionId)
        }
      } else {
        // 通知远程实例清理
        await this.redis.publish(`instance:${sessionInfo.instanceId}:cleanup`, sessionId)
      }
    }
    
    // 清理 Redis 记录
    await this.redis.del(`user:${userId}:sessions`)
    await this.redis.del(`user:${userId}:session_count`)
  }
  
  /**
   * 定期清理僵尸会话
   */
  async cleanupZombieSessions(): Promise<void> {
    const allSessions = await this.redis.keys('session:*')
    const now = Date.now()
    const timeout = 30 * 60 * 1000  // 30分钟无活动视为僵尸
    
    for (const key of allSessions) {
      const sessionInfo = await this.redis.hgetall(key)
      if (now - parseInt(sessionInfo.lastActiveAt) > timeout) {
        await this.destroySession(key.replace('session:', ''))
      }
    }
  }
}
```

## 3. 资源限制与配额

### 3.1 多层级限流（已实现）

基于 Token Bucket 算法的内存级限流实现，支持未来无缝升级到 Redis 分布式限流。

**实现文件**: `/apps/server/src/services/rate-limiter.ts`

```typescript
/**
 * Token Bucket 实现
 */
class TokenBucket {
  private tokens: number
  private lastRefill: number

  constructor(private config: { capacity: number; refillRate: number }) {
    this.tokens = config.capacity
    this.lastRefill = Date.now()
  }

  /**
   * 尝试消费 token
   * @param count 消费数量，默认1
   * @returns 是否允许通过
   */
  consume(count: number = 1): boolean {
    this.refill()
    if (this.tokens >= count) {
      this.tokens -= count
      return true
    }
    return false
  }

  /**
   * 获取下次可用时间（毫秒）
   */
  getWaitTime(): number {
    this.refill()
    if (this.tokens >= 1) return 0
    const needed = 1 - this.tokens
    return Math.ceil(needed / this.config.refillRate * 1000)
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000
    this.tokens = Math.min(
      this.config.capacity,
      this.tokens + elapsed * this.config.refillRate
    )
    this.lastRefill = now
  }
}

/**
 * 多层限流器
 */
export class RateLimiter {
  private globalHttpBucket: TokenBucket
  private userHttpBuckets = new Map<string, BucketMetadata>()
  private sessionMessageBuckets = new Map<string, BucketMetadata>()
  private llmGlobalBucket: TokenBucket
  private llmUserBuckets = new Map<string, BucketMetadata>()

  constructor() {
    const burst = config.rateLimit.burstMultiplier

    // 全局HTTP: 默认 166/s (10000/min)
    this.globalHttpBucket = new TokenBucket({
      capacity: Math.ceil(166 * burst),
      refillRate: 166
    })

    // LLM全局: 默认 1.67/s (100/min)
    this.llmGlobalBucket = new TokenBucket({
      capacity: Math.ceil(1.67 * burst),
      refillRate: 1.67
    })
  }

  /**
   * 检查HTTP请求限流（全局 + 用户级）
   */
  checkHttpRequest(userId: string): { allowed: boolean; retryAfter?: number }

  /**
   * 检查LLM请求限流（全局 + 用户级）
   */
  checkLLMRequest(userId: string): { allowed: boolean; retryAfter?: number }

  /**
   * 检查会话消息限流
   */
  checkSessionMessage(sessionId: string): { allowed: boolean; retryAfter?: number }

  /**
   * 清理过期桶（每5分钟调用一次）
   */
  cleanup(): void
}
```

**限流策略配置** (`/apps/server/src/config/index.ts`):

```typescript
rateLimit: {
  // 全局HTTP请求: 默认 166/s (10000/分钟)
  globalHttpRPS: parseFloat(process.env.RL_GLOBAL_HTTP_RPS || '166'),

  // 单用户HTTP请求: 默认 1.67/s (100/分钟)
  userHttpRPS: parseFloat(process.env.RL_USER_HTTP_RPS || '1.67'),

  // 全局LLM请求: 默认 1.67/s (100/分钟)
  globalLLMRPS: parseFloat(process.env.RL_GLOBAL_LLM_RPS || '1.67'),

  // 单用户LLM请求: 默认 0.17/s (10/分钟)
  userLLMRPS: parseFloat(process.env.RL_USER_LLM_RPS || '0.17'),

  // 单会话消息频率: 默认 0.33/s (20/分钟, 约1条/3秒)
  sessionMessageRPS: parseFloat(process.env.RL_SESSION_MSG_RPS || '0.33'),

  // 桶容量倍数（突发容量 = 速率 * 倍数）
  burstMultiplier: parseInt(process.env.RL_BURST_MULTIPLIER || '5')
}
```

**集成点 1 - WebSocket 消息限流** (`/apps/server/src/websocket/server.ts`):

```typescript
private async handleAgentRun(connection: WSConnection, message: WSMessage): Promise<void> {
  // 1. 检查用户级HTTP限流
  const userCheck = this.rateLimiter.checkHttpRequest(connection.userId)
  if (!userCheck.allowed) {
    this.sendToConnection(connection.id, {
      type: 'stream.error',
      messageId: this.generateId(),
      timestamp: Date.now(),
      payload: {
        error: `请求过于频繁，请 ${userCheck.retryAfter} 秒后再试`,
        retryAfter: userCheck.retryAfter
      }
    })
    return
  }

  // 2. 检查会话级消息限流
  const sessionCheck = this.rateLimiter.checkSessionMessage(sessionId)
  if (!sessionCheck.allowed) {
    this.sendToConnection(connection.id, {
      type: 'stream.error',
      messageId: this.generateId(),
      timestamp: Date.now(),
      payload: {
        error: `该会话请求过于频繁，请 ${sessionCheck.retryAfter} 秒后再试`,
        retryAfter: sessionCheck.retryAfter
      }
    })
    return
  }

  // 继续处理...
}
```

**集成点 2 - LLM 调用限流** (`/apps/server/src/services/llm-client.ts`):

```typescript
async chat(messages: Message[], userId?: string): Promise<LLMResponse> {
  // 检查限流（如果提供了userId）
  if (this.rateLimiter && userId) {
    const check = this.rateLimiter.checkLLMRequest(userId)
    if (!check.allowed) {
      throw new LLMAPIError(
        `请求过于频繁，请 ${check.retryAfter} 秒后再试`,
        429
      )
    }
  }

  // 继续调用LLM...
}
```

### 3.2 资源配额管理

```typescript
// apps/server/src/services/quota-manager.ts

interface UserQuota {
  maxConcurrentSessions: number  // 最大并发会话数
  maxDailyTokens: number         // 每日 Token 上限
  maxDailyToolCalls: number      // 每日工具调用次数
  maxStorageMB: number           // 历史记录存储上限
}

class QuotaManager {
  private redis: Redis
  
  // 不同等级用户的配额
  private readonly quotaTiers: Record<string, UserQuota> = {
    free: {
      maxConcurrentSessions: 3,
      maxDailyTokens: 100000,      // 约 50 次对话
      maxDailyToolCalls: 50,
      maxStorageMB: 100
    },
    pro: {
      maxConcurrentSessions: 10,
      maxDailyTokens: 1000000,     // 约 500 次对话
      maxDailyToolCalls: 500,
      maxStorageMB: 1000
    },
    enterprise: {
      maxConcurrentSessions: 50,
      maxDailyTokens: 10000000,
      maxDailyToolCalls: 5000,
      maxStorageMB: 10000
    }
  }
  
  /**
   * 检查用户是否有足够配额
   */
  async checkQuota(userId: string, operation: QuotaOperation): Promise<boolean> {
    const userTier = await this.getUserTier(userId)
    const quota = this.quotaTiers[userTier]
    
    switch (operation.type) {
      case 'create_session':
        const currentSessions = await this.getCurrentSessionCount(userId)
        return currentSessions < quota.maxConcurrentSessions
        
      case 'llm_request':
        const estimatedTokens = operation.estimatedTokens || 4000
        const dailyTokens = await this.getDailyTokenUsage(userId)
        return (dailyTokens + estimatedTokens) <= quota.maxDailyTokens
        
      case 'tool_call':
        const dailyToolCalls = await this.getDailyToolCallCount(userId)
        return dailyToolCalls < quota.maxDailyToolCalls
        
      default:
        return true
    }
  }
  
  /**
   * 消耗配额
   */
  async consumeQuota(
    userId: string, 
    operation: QuotaOperation,
    actualValue: number
  ): Promise<void> {
    const today = new Date().toISOString().split('T')[0]
    
    switch (operation.type) {
      case 'llm_request':
        await this.redis.incrby(`quota:${userId}:${today}:tokens`, actualValue)
        // 设置过期时间（7天后自动清理）
        await this.redis.expire(`quota:${userId}:${today}:tokens`, 7 * 24 * 3600)
        break
        
      case 'tool_call':
        await this.redis.incr(`quota:${userId}:${today}:tools`)
        await this.redis.expire(`quota:${userId}:${today}:tools`, 7 * 24 * 3600)
        break
    }
  }
  
  /**
   * 获取配额使用情况（用于前端展示）
   */
  async getQuotaUsage(userId: string): Promise<QuotaUsage> {
    const userTier = await this.getUserTier(userId)
    const quota = this.quotaTiers[userTier]
    const today = new Date().toISOString().split('T')[0]
    
    return {
      tier: userTier,
      sessions: {
        used: await this.getCurrentSessionCount(userId),
        total: quota.maxConcurrentSessions
      },
      tokens: {
        used: await this.getDailyTokenUsage(userId),
        total: quota.maxDailyTokens
      },
      toolCalls: {
        used: await this.getDailyToolCallCount(userId),
        total: quota.maxDailyToolCalls
      }
    }
  }
}
```

## 4. WebSocket 连接管理

### 4.1 连接生命周期

```typescript
// apps/server/src/websocket/connection-manager.ts

interface WSConnection {
  id: string
  userId: string
  socket: WebSocket
  connectedAt: Date
  lastPingAt: Date
  isAlive: boolean
  subscriptions: Set<string>  // 订阅的会话ID
}

class WebSocketConnectionManager {
  // 本地连接映射
  private connections = new Map<string, WSConnection>()
  
  // 用户 -> 连接映射（一个用户可能有多个连接）
  private userConnections = new Map<string, Set<string>>()
  
  // Redis 订阅（用于跨实例消息广播）
  private redisSubscriber: Redis
  private redisPublisher: Redis
  
  constructor() {
    // 订阅 Redis 频道，接收其他实例的消息
    this.redisSubscriber.subscribe('ws:broadcast')
    this.redisSubscriber.on('message', (channel, message) => {
      this.handleBroadcast(message)
    })
  }
  
  /**
   * 添加新连接
   */
  addConnection(userId: string, socket: WebSocket): string {
    const connectionId = generateUUID()
    
    const conn: WSConnection = {
      id: connectionId,
      userId,
      socket,
      connectedAt: new Date(),
      lastPingAt: new Date(),
      isAlive: true,
      subscriptions: new Set()
    }
    
    this.connections.set(connectionId, conn)
    
    // 记录用户连接
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set())
    }
    this.userConnections.get(userId)!.add(connectionId)
    
    // 设置事件处理器
    socket.on('pong', () => {
      conn.isAlive = true
      conn.lastPingAt = new Date()
    })
    
    socket.on('close', () => {
      this.removeConnection(connectionId)
    })
    
    socket.on('error', (error) => {
      console.error(`WebSocket error for user ${userId}:`, error)
      this.removeConnection(connectionId)
    })
    
    return connectionId
  }
  
  /**
   * 订阅会话（接收该会话的消息）
   */
  subscribeToSession(connectionId: string, sessionId: string): void {
    const conn = this.connections.get(connectionId)
    if (conn) {
      conn.subscriptions.add(sessionId)
      
      // Redis 记录：哪个实例在处理这个会话
      this.redis.hset(`session:${sessionId}:subscribers`, connectionId, this.instanceId)
    }
  }
  
  /**
   * 发送消息给特定连接
   */
  sendToConnection(connectionId: string, message: WSMessage): void {
    const conn = this.connections.get(connectionId)
    if (conn && conn.socket.readyState === WebSocket.OPEN) {
      conn.socket.send(JSON.stringify(message))
    }
  }
  
  /**
   * 发送消息给用户的所有连接
   */
  sendToUser(userId: string, message: WSMessage): void {
    const connectionIds = this.userConnections.get(userId)
    if (connectionIds) {
      for (const connId of connectionIds) {
        this.sendToConnection(connId, message)
      }
    }
  }
  
  /**
   * 广播消息给所有订阅了该会话的连接（跨实例）
   */
  async broadcastToSession(sessionId: string, message: WSMessage): Promise<void> {
    // 1. 先发送给本地订阅者
    for (const [connId, conn] of this.connections) {
      if (conn.subscriptions.has(sessionId)) {
        this.sendToConnection(connId, message)
      }
    }
    
    // 2. 通过 Redis 通知其他实例
    await this.redisPublisher.publish('ws:broadcast', JSON.stringify({
      sessionId,
      message,
      excludeInstance: this.instanceId
    }))
  }
  
  /**
   * 心跳检测
   */
  startHeartbeat(): void {
    const interval = setInterval(() => {
      for (const [connId, conn] of this.connections) {
        if (!conn.isAlive) {
          // 30秒无响应，断开连接
          conn.socket.terminate()
          this.removeConnection(connId)
          continue
        }
        
        conn.isAlive = false
        conn.socket.ping()
      }
    }, 30000)
    
    // 清理 interval 当服务器关闭时
    process.on('SIGTERM', () => clearInterval(interval))
  }
  
  /**
   * 获取连接统计
   */
  getStats(): ConnectionStats {
    return {
      totalConnections: this.connections.size,
      uniqueUsers: this.userConnections.size,
      connectionsPerUser: Array.from(this.userConnections.values()).map(s => s.size)
    }
  }
}
```

### 4.2 跨实例通信

```typescript
// apps/server/src/websocket/cross-instance-communication.ts

/**
 * 当多实例部署时，一个用户的会话可能在实例A，
 * 但用户的新连接在实例B，需要跨实例协调
 */

class CrossInstanceCoordinator {
  private redis: Redis
  private instanceId: string
  
  constructor(instanceId: string, redis: Redis) {
    this.instanceId = instanceId
    this.redis = redis
    
    // 订阅本实例的专属频道
    this.redis.subscribe(`instance:${instanceId}:commands`)
    this.redis.on('message', (channel, message) => {
      this.handleRemoteCommand(JSON.parse(message))
    })
  }
  
  /**
   * 转发请求到会话所在的实例
   */
  async forwardToSessionOwner(
    sessionId: string, 
    command: Command
  ): Promise<any> {
    // 1. 查找会话所在实例
    const sessionInfo = await this.redis.hgetall(`session:${sessionId}`)
    if (!sessionInfo) {
      throw new Error('Session not found')
    }
    
    const ownerInstance = sessionInfo.instanceId
    
    // 2. 如果在本地，直接处理
    if (ownerInstance === this.instanceId) {
      return this.executeCommand(command)
    }
    
    // 3. 如果在远程，通过 Redis 发送命令并等待响应
    const requestId = generateUUID()
    
    return new Promise((resolve, reject) => {
      // 设置一次性监听器等待响应
      const responseHandler = (channel: string, message: string) => {
        const response = JSON.parse(message)
        if (response.requestId === requestId) {
          this.redis.unsubscribe(`instance:${this.instanceId}:responses:${requestId}`)
          
          if (response.error) {
            reject(new Error(response.error))
          } else {
            resolve(response.data)
          }
        }
      }
      
      this.redis.subscribe(`instance:${this.instanceId}:responses:${requestId}`, responseHandler)
      
      // 发送命令到目标实例
      this.redis.publish(`instance:${ownerInstance}:commands`, JSON.stringify({
        requestId,
        replyTo: this.instanceId,
        command
      }))
      
      // 超时处理
      setTimeout(() => {
        this.redis.unsubscribe(`instance:${this.instanceId}:responses:${requestId}`)
        reject(new Error('Cross-instance request timeout'))
      }, 30000)
    })
  }
  
  /**
   * 处理来自其他实例的命令
   */
  private async handleRemoteCommand(message: { requestId: string; replyTo: string; command: Command }): Promise<void> {
    try {
      const result = await this.executeCommand(message.command)
      
      // 发送响应回请求实例
      this.redis.publish(`instance:${message.replyTo}:responses:${message.requestId}`, JSON.stringify({
        requestId: message.requestId,
        data: result
      }))
    } catch (error) {
      this.redis.publish(`instance:${message.replyTo}:responses:${message.requestId}`, JSON.stringify({
        requestId: message.requestId,
        error: error instanceof Error ? error.message : 'Unknown error'
      }))
    }
  }
}
```

## 5. 浏览器实例管理（资源密集型）

```typescript
// apps/server/src/services/browser-pool.ts

/**
 * 浏览器实例是资源消耗大户，需要特殊管理
 */

interface BrowserInstance {
  id: string
  userId: string
  sessionId: string
  browser: Browser
  context: BrowserContext
  page: Page
  createdAt: Date
  lastUsedAt: Date
  useCount: number
}

class BrowserPool {
  // 活跃浏览器实例
  private browsers = new Map<string, BrowserInstance>()
  
  // 用户 -> 浏览器映射（限制单个用户的浏览器数量）
  private userBrowsers = new Map<string, Set<string>>()
  
  private config = {
    maxBrowsersPerUser: 2,      // 单个用户最多2个浏览器
    maxGlobalBrowsers: 100,     // 全局最多100个浏览器
    idleTimeout: 10 * 60 * 1000, // 10分钟空闲回收
    maxUseCount: 50             // 使用50次后强制重启（防止内存泄漏）
  }
  
  /**
   * 获取或创建浏览器实例
   */
  async acquireBrowser(userId: string, sessionId: string): Promise<BrowserInstance> {
    const browserId = `${userId}:${sessionId}`
    
    // 1. 检查是否已存在
    const existing = this.browsers.get(browserId)
    if (existing) {
      existing.lastUsedAt = new Date()
      existing.useCount++
      
      // 如果使用次数过多，回收并重建
      if (existing.useCount > this.config.maxUseCount) {
        await this.releaseBrowser(browserId)
      } else {
        return existing
      }
    }
    
    // 2. 检查用户限制
    const userBrowserCount = this.userBrowsers.get(userId)?.size || 0
    if (userBrowserCount >= this.config.maxBrowsersPerUser) {
      // 回收用户最早的浏览器
      await this.recycleOldestUserBrowser(userId)
    }
    
    // 3. 检查全局限制
    if (this.browsers.size >= this.config.maxGlobalBrowsers) {
      // 回收全局最早的空闲浏览器
      await this.recycleOldestIdleBrowser()
    }
    
    // 4. 创建新浏览器
    const browser = await chromium.launch({
      headless: true,  // 生产环境无头模式
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    })
    
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
    })
    
    const page = await context.newPage()
    
    const instance: BrowserInstance = {
      id: browserId,
      userId,
      sessionId,
      browser,
      context,
      page,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      useCount: 0
    }
    
    this.browsers.set(browserId, instance)
    
    // 记录用户浏览器
    if (!this.userBrowsers.has(userId)) {
      this.userBrowsers.set(userId, new Set())
    }
    this.userBrowsers.get(userId)!.add(browserId)
    
    return instance
  }
  
  /**
   * 释放浏览器实例
   */
  async releaseBrowser(browserId: string): Promise<void> {
    const instance = this.browsers.get(browserId)
    if (!instance) return
    
    // 关闭浏览器
    await instance.browser.close()
    
    // 清理映射
    this.browsers.delete(browserId)
    this.userBrowsers.get(instance.userId)?.delete(browserId)
    
    console.log(`Browser ${browserId} released`)
  }
  
  /**
   * 定期清理空闲浏览器
   */
  startIdleCleanup(): void {
    setInterval(async () => {
      const now = Date.now()
      
      for (const [browserId, instance] of this.browsers) {
        const idleTime = now - instance.lastUsedAt.getTime()
        
        if (idleTime > this.config.idleTimeout) {
          console.log(`Cleaning up idle browser: ${browserId}`)
          await this.releaseBrowser(browserId)
        }
      }
    }, 60000)  // 每分钟检查一次
  }
  
  /**
   * 获取池状态（用于监控）
   */
  getStats(): BrowserPoolStats {
    const stats: BrowserPoolStats = {
      totalBrowsers: this.browsers.size,
      browsersPerUser: {},
      averageIdleTime: 0
    }
    
    let totalIdleTime = 0
    const now = Date.now()
    
    for (const [userId, browserIds] of this.userBrowsers) {
      stats.browsersPerUser[userId] = browserIds.size
    }
    
    for (const instance of this.browsers.values()) {
      totalIdleTime += now - instance.lastUsedAt.getTime()
    }
    
    if (this.browsers.size > 0) {
      stats.averageIdleTime = totalIdleTime / this.browsers.size
    }
    
    return stats
  }
}
```

## 6. 数据库并发优化

```typescript
// apps/server/src/db/connection-pool.ts

import { Pool } from 'pg'

class DatabaseManager {
  private pool: Pool
  
  constructor() {
    this.pool = new Pool({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      
      // 连接池配置
      max: 20,                    // 最大连接数
      min: 5,                     // 最小连接数
      acquire: 30000,             // 获取连接超时
      idle: 10000,                // 连接空闲时间
      
      // 连接重试
      retry: {
        max: 3
      }
    })
  }
  
  /**
   * 乐观锁更新会话状态（防止并发覆盖）
   */
  async updateSessionWithOptimisticLock(
    sessionId: string, 
    updates: Partial<Session>,
    expectedVersion: number
  ): Promise<boolean> {
    const result = await this.pool.query(`
      UPDATE sessions 
      SET 
        data = $1,
        version = version + 1,
        updated_at = NOW()
      WHERE id = $2 AND version = $3
      RETURNING id
    `, [JSON.stringify(updates), sessionId, expectedVersion])
    
    return result.rowCount > 0
  }
  
  /**
   * 批量写入消息（减少数据库往返）
   */
  async batchInsertMessages(messages: Message[]): Promise<void> {
    const client = await this.pool.connect()
    
    try {
      await client.query('BEGIN')
      
      // 使用 COPY 或批量 INSERT 提高效率
      const values = messages.map((m, i) => 
        `($${i*4+1}, $${i*4+2}, $${i*4+3}, $${i*4+4})`
      ).join(',')
      
      const params = messages.flatMap(m => [
        m.sessionId, m.role, m.content, m.timestamp
      ])
      
      await client.query(`
        INSERT INTO messages (session_id, role, content, timestamp)
        VALUES ${values}
      `, params)
      
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
  
  /**
   * 读写分离查询
   */
  async queryRead(sql: string, params?: any[]): Promise<any> {
    // 主库（写入）
    return this.pool.query(sql, params)
  }
  
  async queryWrite(sql: string, params?: any[]): Promise<any> {
    // 从库（读取）- 实际配置中连接到只读副本
    return this.pool.query(sql, params)
  }
}
```

## 7. 监控与告警

```typescript
// apps/server/src/monitoring/metrics.ts

import { Counter, Histogram, Gauge } from 'prom-client'

class MetricsCollector {
  // 请求计数
  private requestCounter = new Counter({
    name: 'agent_requests_total',
    help: 'Total number of agent requests',
    labelNames: ['user_tier', 'status']
  })
  
  // 请求延迟
  private requestDuration = new Histogram({
    name: 'agent_request_duration_seconds',
    help: 'Duration of agent requests',
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60]
  })
  
  // 活跃会话数
  private activeSessions = new Gauge({
    name: 'agent_active_sessions',
    help: 'Number of active sessions',
    labelNames: ['instance_id']
  })
  
  // WebSocket 连接数
  private wsConnections = new Gauge({
    name: 'agent_websocket_connections',
    help: 'Number of WebSocket connections',
    labelNames: ['instance_id']
  })
  
  // Token 使用量
  private tokenUsage = new Counter({
    name: 'agent_token_usage_total',
    help: 'Total token usage',
    labelNames: ['user_id', 'model']
  })
  
  // 浏览器池状态
  private browserPoolSize = new Gauge({
    name: 'agent_browser_pool_size',
    help: 'Current browser pool size'
  })
  
  recordRequest(userTier: string, duration: number, success: boolean): void {
    this.requestCounter.inc({ user_tier: userTier, status: success ? 'success' : 'error' })
    this.requestDuration.observe(duration)
  }
  
  updateActiveSessions(count: number): void {
    this.activeSessions.set(count)
  }
  
  recordTokenUsage(userId: string, model: string, tokens: number): void {
    this.tokenUsage.inc({ user_id: userId, model }, tokens)
  }
}
```

### 3.2 工具执行超时控制（已实现）

针对不同工具类型配置合适的超时时间，防止单个工具卡住阻塞整个 Agent Loop。

**实现文件**: `/apps/server/src/services/tool-bridge.ts`

```typescript
/**
 * 根据工具类型获取超时时间
 */
private getToolTimeout(toolName: string): number {
  const timeouts: Record<string, number> = {
    'browser': 60000,           // 浏览器操作60s
    'browser_ai': 90000,        // AI浏览器操作90s（包含语义解析时间）
    'browser_ai_execute': 60000,
    'browser_get_context': 30000,
    'bash': 30000,              // 命令行30s
    'file_read': 5000,          // 文件读取5s
    'file_write': 5000          // 文件写入5s
  }
  return timeouts[toolName] || 30000
}

private async executeLocalTool(toolCall: ToolCall): Promise<ToolResult> {
  // ...
  const timeout = this.getToolTimeout(toolCall.name)

  const response = await this.sendWebSocketRequest(requestId, {
    toolCall,
    timeout
  })
  // ...
}
```

### 3.3 限流监控

通过 `/health` 和 `/debug/stats` 接口查看限流统计：

```json
{
  "status": "ok",
  "stats": {
    "rateLimit": {
      "globalHttpTokens": 185.5,
      "globalLlmTokens": 8.2,
      "userHttpBuckets": 12,
      "userLlmBuckets": 8,
      "sessionMessageBuckets": 15
    }
  }
}
```

---

## 8. 总结：并发架构检查清单

### 会话管理
- [x] 用户级会话数限制（10个/用户）
- [x] 全局会话数上限（1000个）
- [x] 僵尸会话自动清理（30分钟无活动）
- [ ] 跨实例会话查找（需Redis）

### 资源限制
- [x] 多层限流（全局/用户/会话/LLM）- **Token Bucket内存级实现**
- [x] 工具执行超时控制（5s-90s按类型）
- [ ] 配额管理（免费/付费等级）- 待实现
- [ ] 浏览器实例池管理（需独立Browser Pool）
- [x] 内存和连接数监控

### WebSocket
- [x] 连接心跳检测（30秒间隔）
- [ ] 跨实例消息广播（需Redis Pub/Sub）
- [x] 会话订阅管理
- [ ] 断线重连机制（客户端实现）

### 数据库
- [ ] 连接池配置（需PostgreSQL）
- [ ] 乐观锁防止覆盖
- [ ] 批量写入优化
- [ ] 读写分离

### 监控
- [x] 实时指标收集（/health, /debug/stats）
- [ ] 资源使用告警
- [x] 错误率监控（错误日志）
- [ ] 性能瓶颈分析（Prometheus/Grafana）

---

*文档创建时间：2026-05-14*

---

**更新记录**:
- 2026-05-18: 添加多层限流系统实现（Token Bucket算法）、工具超时控制、限流监控接口
