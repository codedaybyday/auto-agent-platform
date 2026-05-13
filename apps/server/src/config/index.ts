/**
 * 服务端配置
 */

import dotenv from 'dotenv'

dotenv.config()

export const config = {
  port: parseInt(process.env.PORT || '3000'),

  // JWT 配置
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

  // LLM 默认配置（服务端用，用户不可见）
  llm: {
    defaultModel: process.env.DEFAULT_MODEL || 'claude-3-5-sonnet-20241022',
    defaultBaseURL: process.env.DEFAULT_BASE_URL || 'https://api.anthropic.com',
    apiKey: process.env.LLM_API_KEY || ''
  }
}
