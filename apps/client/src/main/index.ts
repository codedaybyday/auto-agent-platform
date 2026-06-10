import { app, BrowserWindow } from 'electron'

// 导入新的模块
import { initSSOClient, bindSSOHandlers } from './handlers/sso-handler'
import { connectToServer, closeConnection, initServerConnection } from './core/server-connection'
import { createWindow, getAllWindows } from './services/window-manager'
import { setupAgentHandlers } from './handlers/agent-handlers'
import { handleServerMessage } from './handlers/message-handler'
import { setupMCPConfigHandlers } from './handlers/mcp-config-handler'
import { setupFileSaveHandlers } from './handlers/file-save-handler'
import { cleanupAllTools } from './tools/executor'
import { browserManager } from './tools/browser-manager'
import { log } from '@auto-agent/shared-utils'

app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.auto-agent.desktop')
  }

  initSSOClient()
  bindSSOHandlers()
  createWindow()
  const mainWindow = BrowserWindow.getAllWindows()[0] || null

  // 先初始化服务器连接配置，再设置 IPC handlers
  initServerConnection({
    messageHandler: handleServerMessage,
    mainWindow
  })

  setupAgentHandlers(mainWindow)
  setupMCPConfigHandlers()
  setupFileSaveHandlers()

  // 启动时连接服务端
  connectToServer(mainWindow).catch(err => log.error('Main', 'Failed to connect to server', err))

  // 运行 Bash 工具测试
  try {
    const { testBashTool } = await import('./test-bash.js')
    await testBashTool()
  } catch (error) {
    log.error('Main', 'Bash tool test failed', error)
  }

  // 预启动 Chrome（后台静默初始化，减少首次使用等待时间）
  browserManager.prelaunchChrome().catch(err => {
    log.warn('Main', 'Chrome prelaunch failed (will retry on first use)', err)
  })

  app.on('activate', () => {
    if (getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    closeConnection()
    app.quit()
  }
})

app.on('before-quit', async () => {
  closeConnection()
  await cleanupAllTools()
})
