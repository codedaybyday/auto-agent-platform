import { ipcMain } from 'electron'
import fs from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { SSOCliClient, SSOAccessEnvType, SimpleFileTokenStorage } from '@mtfe/sso-web-oidc-cli'

export let ssoClient: SSOCliClient

const CLIENT_ID = '3e64c59645' // 测试环境
const tokenFilePath = join(app.getPath('userData'), 'sso', `${SSOAccessEnvType.test}_${CLIENT_ID}.json`)

export function initSSOClient() {
  const accessEnv = SSOAccessEnvType.test
  
  const fileTokenStorage = new SimpleFileTokenStorage({
    clientId: CLIENT_ID,
    accessEnv,
    storageDir: join(app.getPath('userData'), 'sso'),
  })

  ssoClient = new SSOCliClient({
    clientId: CLIENT_ID,
    accessEnv,
    localPortList: [8084, 8085],
    isDebug: process.env.NODE_ENV === 'development',
    tokenStorage: fileTokenStorage
  })
}

export function bindSSOHandlers(): void {
  // 获取用户信息 (whoami)
  ipcMain.handle('sso:whoami', async () => {
    try {
      const result = await ssoClient.whoami()
      console.debug('whoami result: ', result)

      if (result && result.code === 0 && result.data) {
        return { success: true, data: result.data, error: null }
      } else {
        return { success: false, data: null, error: result?.msg || '获取用户信息失败' }
      }
    } catch (error: any) {
      console.error('SSO whoami error:', error)
      return { success: false, data: null, error: error.message }
    }
  })

  // SSO 登录
  ipcMain.handle('sso:login', async () => {
    try {
      const result = await ssoClient.login()
      console.log('sso login result: ', result)

      if (result && result.access_token) {
        return { success: true, error: null }
      } else {
        return { success: false, error: '登录失败' }
      }
    } catch (error: any) {
      console.error('SSO login error:', error)
      return { success: false, error: error?.msg || error?.message }
    }
  })

  // SSO 登出
  ipcMain.handle('sso:logout', async () => {
    try {
      const result = await ssoClient.logout()
      console.debug('logout result: ', result)

      // 登出成功后清空 token 信息
      if (result && result.code === 0) {
        fs.rmSync(tokenFilePath)
        console.debug('SSO token 已清空')
      }

      return { success: true, error: null }
    } catch (error: any) {
      console.error('SSO logout error:', error)
      return { success: false, error: error.message }
    }
  })
}
