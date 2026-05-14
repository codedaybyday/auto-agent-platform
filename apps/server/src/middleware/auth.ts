/**
 * 认证中间件
 *
 * TODO: 接入外部登录系统
 * 当前为占位实现，允许所有请求通过
 *
 * 后续接入方式：
 * 1. JWT 验证 - 验证 Authorization header 中的 token
 * 2. OAuth2 - 接入第三方登录（GitHub、Google、企业 SSO）
 * 3. Session - 基于 Cookie 的会话管理
 * 4. API Key - 为每个用户分配 API Key
 */

import type { Request, Response, NextFunction } from 'express'

// TODO: 替换为实际的认证逻辑
export interface AuthRequest extends Request {
  user?: {
    id: string
    email?: string
    name?: string
    tier?: 'free' | 'pro' | 'enterprise'
    // 外部登录系统可能返回的其他字段
    [key: string]: any
  }
}

/**
 * 认证中间件
 *
 * FIXME: 当前为占位实现，直接信任客户端提供的 userId
 * 接入外部登录系统后，需要：
 * 1. 验证 token 有效性
 * 2. 解析用户信息
 * 3. 处理 token 过期刷新
 * 4. 处理权限校验
 */
export function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  // ========== 占位实现 START ==========

  // 从 header 中获取用户信息（临时方案）
  // 外部登录系统接入后，应改为从 Authorization header 解析 token
  const userId = req.headers['x-user-id'] as string

  if (!userId) {
    // 开发阶段允许匿名访问
    // 生产环境应返回 401
    if (process.env.NODE_ENV === 'production') {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    // 开发模式：使用默认用户
    req.user = {
      id: 'anonymous',
      tier: 'free'
    }
  } else {
    // 临时：直接信任客户端提供的 userId
    // TODO: 验证 userId 与 token 的对应关系
    req.user = {
      id: userId,
      tier: 'free'
    }
  }

  // ========== 占位实现 END ==========

  next()
}

/**
 * 可选认证中间件
 * 用于不需要登录但登录后有增强功能的接口
 */
export function optionalAuthMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const userId = req.headers['x-user-id'] as string

  if (userId) {
    req.user = {
      id: userId,
      tier: 'free'
    }
  }

  next()
}

/**
 * TODO: 接入外部登录系统的接口定义
 *
 * 接入时需要实现的接口：
 */

// TODO: 接入外部登录系统后实现
export interface ExternalAuthProvider {
  /** 验证 token 并返回用户信息 */
  verifyToken(token: string): Promise<{
    valid: boolean
    user?: {
      id: string
      email: string
      name?: string
    }
    error?: string
  }>

  /** 刷新 token */
  refreshToken(refreshToken: string): Promise<{
    accessToken: string
    refreshToken: string
    expiresIn: number
  }>

  /** 登出 */
  revokeToken(token: string): Promise<void>
}

// TODO: 支持的登录方式（后续选择实现）
export enum LoginMethod {
  // JWT 自建登录
  JWT = 'jwt',

  // OAuth2 第三方
  GITHUB = 'github',
  GOOGLE = 'google',
  MICROSOFT = 'microsoft',

  // 企业 SSO
  SAML = 'saml',
  OIDC = 'oidc',

  // API Key（用于程序化访问）
  API_KEY = 'api_key'
}

// TODO: 用户同步接口
export interface UserSyncService {
  /** 从外部系统同步用户信息 */
  syncUser(externalUserId: string): Promise<void>

  /** 获取用户配额信息 */
  getUserQuota(userId: string): Promise<{
    tier: string
    maxSessions: number
    maxTokens: number
  }>
}
