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

  // LLM 配置（支持 OpenAI 兼容格式）
  llm: {
    model: process.env.LLM_MODEL || 'gpt-4',
    apiKey: process.env.LLM_API_KEY || '',
    baseURL: process.env.LLM_BASE_URL || 'https://api.openai.com/v1'
  }
}
