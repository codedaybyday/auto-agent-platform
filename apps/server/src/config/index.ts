/**
 * 服务端配置
 */

import dotenv from 'dotenv'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// 加载 .env 文件（从项目根目录或当前目录）
dotenv.config({ path: resolve(__dirname, '../../.env') })
dotenv.config({ path: resolve(process.cwd(), '.env') })

export const config = {
  port: parseInt(process.env.PORT || '3000'),

  // JWT 配置（TODO: 接入外部登录系统）
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },

  // 数据库配置（后续添加）
  database: {
    url: process.env.DATABASE_URL || 'postgresql://localhost:5432/auto-agent'
  },

  // Redis 配置（后续添加）
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  },

  // LLM 配置（支持 OpenAI 兼容格式，包括 Ollama 本地部署）
  llm: {
    model: process.env.LLM_MODEL || 'gpt-4',
    apiKey: process.env.LLM_API_KEY || '',
    baseURL: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    // Ollama 特定配置
    provider: (process.env.LLM_PROVIDER || 'openai') as 'openai' | 'ollama' | 'anthropic',
    // Ollama 默认地址: http://localhost:11434/v1
    isLocal: process.env.LLM_BASE_URL?.includes('localhost') || process.env.LLM_BASE_URL?.includes('127.0.0.1') || false
  },

  // 限流配置
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
}
