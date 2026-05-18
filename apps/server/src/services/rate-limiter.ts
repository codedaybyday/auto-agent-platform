/**
 * 多层限流服务
 * 基于 Token Bucket 算法实现全局/用户/会话多级限流
 */

import { config } from '../config/index.js'

interface RateLimitConfig {
  /** 桶容量（最大突发请求数） */
  capacity: number
  /** 每秒填充速率 */
  refillRate: number
}

interface BucketMetadata {
  bucket: TokenBucket
  lastAccess: number
  userId?: string
  sessionId?: string
}

/**
 * Token Bucket 实现
 */
class TokenBucket {
  private tokens: number
  private lastRefill: number

  constructor(private config: RateLimitConfig) {
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
   * 查看当前可用 token 数（不消费）
   */
  peek(): number {
    this.refill()
    return this.tokens
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
 * 限流检查结果
 */
export interface RateLimitCheck {
  allowed: boolean
  /** 需要等待的秒数 */
  retryAfter?: number
  /** 当前剩余配额 */
  remaining?: number
}

/**
 * 多层限流器
 * 支持：全局HTTP、用户HTTP、全局LLM、用户LLM、会话消息
 */
export class RateLimiter {
  // 全局限流桶
  private globalHttpBucket: TokenBucket

  // 用户级HTTP限流桶
  private userHttpBuckets = new Map<string, BucketMetadata>()

  // 会话级消息限流桶
  private sessionMessageBuckets = new Map<string, BucketMetadata>()

  // LLM 全局限流桶
  private llmGlobalBucket: TokenBucket

  // 用户级LLM限流桶
  private llmUserBuckets = new Map<string, BucketMetadata>()

  // 配置
  private config: {
    globalHttpCapacity: number
    globalHttpRefillRate: number
    userHttpCapacity: number
    userHttpRefillRate: number
    globalLlmCapacity: number
    globalLlmRefillRate: number
    userLlmCapacity: number
    userLlmRefillRate: number
    sessionMessageCapacity: number
    sessionMessageRefillRate: number
    bucketTTL: number // 桶的过期时间（毫秒）
  }

  constructor() {
    const rlConfig = config.rateLimit
    const burst = rlConfig.burstMultiplier

    this.config = {
      // 全局HTTP: 默认 166/s (10000/min)
      globalHttpCapacity: Math.ceil(rlConfig.globalHttpRPS * burst),
      globalHttpRefillRate: rlConfig.globalHttpRPS,

      // 用户HTTP: 默认 1.67/s (100/min)
      userHttpCapacity: Math.ceil(rlConfig.userHttpRPS * burst),
      userHttpRefillRate: rlConfig.userHttpRPS,

      // 全局LLM: 默认 1.67/s (100/min)
      globalLlmCapacity: Math.ceil(rlConfig.globalLLMRPS * burst),
      globalLlmRefillRate: rlConfig.globalLLMRPS,

      // 用户LLM: 默认 0.17/s (10/min)
      userLlmCapacity: Math.ceil(rlConfig.userLLMRPS * burst),
      userLlmRefillRate: rlConfig.userLLMRPS,

      // 会话消息: 默认 0.33/s (20/min)
      sessionMessageCapacity: Math.ceil(rlConfig.sessionMessageRPS * burst),
      sessionMessageRefillRate: rlConfig.sessionMessageRPS,

      // 桶过期时间: 10分钟无访问则清理
      bucketTTL: 10 * 60 * 1000
    }

    // 初始化全局桶
    this.globalHttpBucket = new TokenBucket({
      capacity: this.config.globalHttpCapacity,
      refillRate: this.config.globalHttpRefillRate
    })

    this.llmGlobalBucket = new TokenBucket({
      capacity: this.config.globalLlmCapacity,
      refillRate: this.config.globalLlmRefillRate
    })

    console.log('[RateLimiter] Initialized with config:', {
      globalHttp: `${this.config.globalHttpRefillRate}/s (capacity: ${this.config.globalHttpCapacity})`,
      userHttp: `${this.config.userHttpRefillRate}/s (capacity: ${this.config.userHttpCapacity})`,
      globalLlm: `${this.config.globalLlmRefillRate}/s (capacity: ${this.config.globalLlmCapacity})`,
      userLlm: `${this.config.userLlmRefillRate}/s (capacity: ${this.config.userLlmCapacity})`,
      sessionMsg: `${this.config.sessionMessageRefillRate}/s (capacity: ${this.config.sessionMessageCapacity})`
    })
  }

  /**
   * 检查HTTP请求限流（全局 + 用户级）
   */
  checkHttpRequest(userId: string): RateLimitCheck {
    // 1. 检查全局
    if (!this.globalHttpBucket.consume()) {
      return {
        allowed: false,
        retryAfter: Math.ceil(this.globalHttpBucket.getWaitTime() / 1000)
      }
    }

    // 2. 检查用户级
    const userBucket = this.getOrCreateUserHttpBucket(userId)
    if (!userBucket.bucket.consume()) {
      // 回滚全局桶
      // 注意：实际实现中更精确的做法是不先消费全局桶，但简化起见这里不回滚
      return {
        allowed: false,
        retryAfter: Math.ceil(userBucket.bucket.getWaitTime() / 1000)
      }
    }

    return {
      allowed: true,
      remaining: Math.floor(userBucket.bucket.peek())
    }
  }

  /**
   * 检查LLM请求限流（全局 + 用户级）
   */
  checkLLMRequest(userId: string): RateLimitCheck {
    // 1. 检查全局
    if (!this.llmGlobalBucket.consume()) {
      return {
        allowed: false,
        retryAfter: Math.ceil(this.llmGlobalBucket.getWaitTime() / 1000)
      }
    }

    // 2. 检查用户级
    const userBucket = this.getOrCreateUserLlmBucket(userId)
    if (!userBucket.bucket.consume()) {
      return {
        allowed: false,
        retryAfter: Math.ceil(userBucket.bucket.getWaitTime() / 1000)
      }
    }

    return {
      allowed: true,
      remaining: Math.floor(userBucket.bucket.peek())
    }
  }

  /**
   * 检查会话消息限流
   */
  checkSessionMessage(sessionId: string): RateLimitCheck {
    const bucket = this.getOrCreateSessionMessageBucket(sessionId)

    if (!bucket.bucket.consume()) {
      return {
        allowed: false,
        retryAfter: Math.ceil(bucket.bucket.getWaitTime() / 1000)
      }
    }

    return {
      allowed: true,
      remaining: Math.floor(bucket.bucket.peek())
    }
  }

  /**
   * 获取用户HTTP限流桶
   */
  private getOrCreateUserHttpBucket(userId: string): BucketMetadata {
    let meta = this.userHttpBuckets.get(userId)
    if (!meta) {
      meta = {
        bucket: new TokenBucket({
          capacity: this.config.userHttpCapacity,
          refillRate: this.config.userHttpRefillRate
        }),
        lastAccess: Date.now(),
        userId
      }
      this.userHttpBuckets.set(userId, meta)
    } else {
      meta.lastAccess = Date.now()
    }
    return meta
  }

  /**
   * 获取用户LLM限流桶
   */
  private getOrCreateUserLlmBucket(userId: string): BucketMetadata {
    let meta = this.llmUserBuckets.get(userId)
    if (!meta) {
      meta = {
        bucket: new TokenBucket({
          capacity: this.config.userLlmCapacity,
          refillRate: this.config.userLlmRefillRate
        }),
        lastAccess: Date.now(),
        userId
      }
      this.llmUserBuckets.set(userId, meta)
    } else {
      meta.lastAccess = Date.now()
    }
    return meta
  }

  /**
   * 获取会话消息限流桶
   */
  private getOrCreateSessionMessageBucket(sessionId: string): BucketMetadata {
    let meta = this.sessionMessageBuckets.get(sessionId)
    if (!meta) {
      meta = {
        bucket: new TokenBucket({
          capacity: this.config.sessionMessageCapacity,
          refillRate: this.config.sessionMessageRefillRate
        }),
        lastAccess: Date.now(),
        sessionId
      }
      this.sessionMessageBuckets.set(sessionId, meta)
    } else {
      meta.lastAccess = Date.now()
    }
    return meta
  }

  /**
   * 清理过期桶（定期调用以释放内存）
   */
  cleanup(): void {
    const now = Date.now()
    let cleanedCount = 0

    // 清理用户HTTP桶
    for (const [key, meta] of this.userHttpBuckets) {
      if (now - meta.lastAccess > this.config.bucketTTL) {
        this.userHttpBuckets.delete(key)
        cleanedCount++
      }
    }

    // 清理用户LLM桶
    for (const [key, meta] of this.llmUserBuckets) {
      if (now - meta.lastAccess > this.config.bucketTTL) {
        this.llmUserBuckets.delete(key)
        cleanedCount++
      }
    }

    // 清理会话消息桶
    for (const [key, meta] of this.sessionMessageBuckets) {
      if (now - meta.lastAccess > this.config.bucketTTL) {
        this.sessionMessageBuckets.delete(key)
        cleanedCount++
      }
    }

    if (cleanedCount > 0) {
      console.log(`[RateLimiter] Cleaned up ${cleanedCount} expired buckets`)
    }
  }

  /**
   * 获取限流统计信息
   */
  getStats(): {
    globalHttpTokens: number
    globalLlmTokens: number
    userHttpBuckets: number
    userLlmBuckets: number
    sessionMessageBuckets: number
  } {
    return {
      globalHttpTokens: this.globalHttpBucket.peek(),
      globalLlmTokens: this.llmGlobalBucket.peek(),
      userHttpBuckets: this.userHttpBuckets.size,
      userLlmBuckets: this.llmUserBuckets.size,
      sessionMessageBuckets: this.sessionMessageBuckets.size
    }
  }
}

/**
 * 创建全局限流器实例
 */
export const rateLimiter = new RateLimiter()
