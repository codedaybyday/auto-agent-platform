import { app, BrowserWindow } from 'electron'

// 导入新的模块
import { initSSOClient, bindSSOHandlers } from './handlers/sso-handler'
import { connectToServer, closeConnection, initServerConnection } from './core/server-connection'
import { createWindow, getAllWindows } from './services/window-manager'
import { setupAgentHandlers } from './handlers/agent-handlers'
import { handleServerMessage } from './handlers/message-handler'
import { cleanupAllTools } from './tools/executor'

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

  // 启动时连接服务端
  connectToServer(mainWindow).catch(console.error)

  // 运行 Bash 工具测试
  try {
    const { testBashTool } = await import('./test-bash.js')
    await testBashTool()
  } catch (error) {
    console.error('[Main] Bash tool test failed:', error)
  }

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
