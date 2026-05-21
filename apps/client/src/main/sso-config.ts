/**
 * SSO 配置共享模块
 * 集中管理 SSO 相关配置，避免代码重复
 */
import { app } from 'electron'
import { join } from 'path'
import { SSOAccessEnvType } from '@mtfe/sso-web-oidc-cli'

// SSO 客户端配置
export const SSO_CONFIG = {
  CLIENT_ID: '3e64c59645',
  ACCESS_ENV: SSOAccessEnvType.test,
  get STORAGE_DIR() {
    return join(app.getPath('userData'), 'sso')
  },
  get TOKEN_FILE_PATH() {
    return join(this.STORAGE_DIR, `${this.ACCESS_ENV}_${this.CLIENT_ID}.json`)
  },
  // Cookie 配置
  COOKIE_NAME_SUFFIX: '_ssoid',
  get COOKIE_NAME() {
    return `${this.CLIENT_ID}${this.COOKIE_NAME_SUFFIX}`
  }
} as const

/**
 * 读取 SSO Token 文件
 * @returns {Promise<{access_token?: string, refresh_token?: string} | null>}
 */
export async function readSSOToken(): Promise<{access_token?: string, refresh_token?: string, [key: string]: any} | null> {
  try {
    const { app } = await import('electron')
    const fs = await import('fs')
    const tokenPath = SSO_CONFIG.TOKEN_FILE_PATH

    if (!fs.existsSync(tokenPath)) {
      console.log('[SSOConfig] Token file not found:', tokenPath)
      return null
    }

    const content = fs.readFileSync(tokenPath, 'utf-8')
    const token = JSON.parse(content)

    return token
  } catch (error) {
    console.error('[SSOConfig] Failed to read token:', error)
    return null
  }
}

/**
 * 获取 SSO Cookie 值 (access_token)
 * @returns {Promise<string | null>}
 */
export async function getSSOCookieValue(): Promise<string | null> {
  const token = await readSSOToken()
  return token?.access_token || null
}
