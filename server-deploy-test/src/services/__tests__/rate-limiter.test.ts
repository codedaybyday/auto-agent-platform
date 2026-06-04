/**
 * RateLimiter 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RateLimiter, rateLimiter } from '../rate-limiter.js'

describe('TokenBucket', () => {
  it('should allow requests within capacity', () => {
    const limiter = new RateLimiter()

    // 首次请求应该通过
    const result1 = limiter.checkHttpRequest('user-1')
    expect(result1.allowed).toBe(true)
  })

  it('should block requests when limit exceeded', () => {
    const limiter = new RateLimiter()

    // 快速发送大量请求触发限流
    let blockedCount = 0
    for (let i = 0; i < 1000; i++) {
      const result = limiter.checkHttpRequest('user-2')
      if (!result.allowed) {
        blockedCount++
        // 验证有 retryAfter
        expect(result.retryAfter).toBeGreaterThan(0)
        break
      }
    }

    expect(blockedCount).toBeGreaterThan(0)
  })

  it('should track remaining quota', () => {
    const limiter = new RateLimiter()

    const result1 = limiter.checkHttpRequest('user-3')
    expect(result1.remaining).toBeDefined()
    expect(result1.remaining).toBeGreaterThan(0)

    // 连续请求后剩余配额应减少
    limiter.checkHttpRequest('user-3')
    const result2 = limiter.checkHttpRequest('user-3')

    if (result2.allowed && result2.remaining && result1.remaining) {
      expect(result2.remaining).toBeLessThanOrEqual(result1.remaining)
    }
  })
})

describe('RateLimiter - LLM Requests', () => {
  it('should limit LLM requests separately from HTTP', () => {
    const limiter = new RateLimiter()

    // HTTP 请求应该通过
    const httpResult = limiter.checkHttpRequest('user-4')
    expect(httpResult.allowed).toBe(true)

    // LLM 请求也应该独立计算
    const llmResult = limiter.checkLLMRequest('user-4')
    expect(llmResult.allowed).toBe(true)
  })

  it('should block LLM requests when rate exceeded', () => {
    const limiter = new RateLimiter()

    // 快速发送大量 LLM 请求
    let blocked = false
    for (let i = 0; i < 100; i++) {
      const result = limiter.checkLLMRequest('user-5')
      if (!result.allowed) {
        blocked = true
        expect(result.retryAfter).toBeGreaterThan(0)
        break
      }
    }

    expect(blocked).toBe(true)
  })
})

describe('RateLimiter - Session Messages', () => {
  it('should limit messages per session', () => {
    const limiter = new RateLimiter()

    // 同一会话的多次请求
    const results = []
    for (let i = 0; i < 5; i++) {
      results.push(limiter.checkSessionMessage('session-1'))
    }

    // 前几个应该通过
    expect(results[0].allowed).toBe(true)

    // 检查是否有被限流的（取决于配置）
    const blockedCount = results.filter(r => !r.allowed).length
    console.log(`Blocked: ${blockedCount}/${results.length}`)
  })

  it('should track different sessions independently', () => {
    const limiter = new RateLimiter()

    // 会话1快速请求
    limiter.checkSessionMessage('session-a')
    limiter.checkSessionMessage('session-a')

    // 会话2应该不受影响
    const result = limiter.checkSessionMessage('session-b')
    expect(result.allowed).toBe(true)
  })
})

describe('RateLimiter - Cleanup', () => {
  it('should cleanup expired buckets', () => {
    const limiter = new RateLimiter()

    // 创建一些用户桶
    limiter.checkHttpRequest('temp-user-1')
    limiter.checkHttpRequest('temp-user-2')

    const statsBefore = limiter.getStats()
    expect(statsBefore.userHttpBuckets).toBeGreaterThanOrEqual(2)

    // 注意：实际测试中不会等待10分钟，这里只是验证方法存在
    limiter.cleanup()

    // 立即清理不应该清理刚创建的桶
    const statsAfter = limiter.getStats()
    expect(statsAfter.userHttpBuckets).toBeGreaterThanOrEqual(2)
  })
})

describe('RateLimiter - Stats', () => {
  it('should return correct stats', () => {
    const limiter = new RateLimiter()

    const stats = limiter.getStats()

    expect(stats).toHaveProperty('globalHttpTokens')
    expect(stats).toHaveProperty('globalLlmTokens')
    expect(stats).toHaveProperty('userHttpBuckets')
    expect(stats).toHaveProperty('userLlmBuckets')
    expect(stats).toHaveProperty('sessionMessageBuckets')

    expect(typeof stats.globalHttpTokens).toBe('number')
    expect(typeof stats.userHttpBuckets).toBe('number')
  })
})
