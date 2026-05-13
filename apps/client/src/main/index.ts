import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import type { Message, ModelConfig } from '@auto-agent/shared-types'
import { Agent, AgentConfig } from './agent/agent'

let mainWindow: BrowserWindow | null = null
let agent: Agent | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    frame: true,
    titleBarStyle: 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function setupAgentHandlers(): void {
  ipcMain.handle('agent:init', (_event, config: { apiKey: string; modelConfig: ModelConfig }) => {
    try {
      if (agent) {
        agent.removeAllListeners()
        agent.cleanup()
      }

      const agentConfig: AgentConfig = {
        apiKey: config.apiKey,
        model: config.modelConfig.model,
        baseURL: config.modelConfig.baseURL || undefined,
        protocol: config.modelConfig.protocol
      }

      agent = new Agent(agentConfig)

      agent.on('message', (message: Message) => {
        mainWindow?.webContents.send('agent:message', message)
      })

      agent.on('processing', (isProcessing: boolean) => {
        mainWindow?.webContents.send('agent:processing', isProcessing)
      })

      agent.on('tool_start', (data: { toolCall: { id: string; name: string; input: Record<string, unknown> } }) => {
        mainWindow?.webContents.send('agent:tool_start', data)
      })

      agent.on('tool_result', (data: { toolCall: { id: string; name: string; input: Record<string, unknown> }; result: { tool_use_id: string; content: string; is_error?: boolean } }) => {
        mainWindow?.webContents.send('agent:tool_result', data)
      })

      agent.on('tool_results', (message: Message) => {
        mainWindow?.webContents.send('agent:tool_results', message)
      })

      agent.on('history_cleared', () => {
        mainWindow?.webContents.send('agent:history_cleared')
      })

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('agent:send_message', async (_event, content: string) => {
    try {
      if (!agent) {
        return { success: false, error: 'Agent not initialized. Please set API key first.' }
      }

      await agent.sendMessage(content)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('agent:clear_history', () => {
    try {
      agent?.clearHistory()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle('agent:get_messages', () => {
    try {
      return { success: true, messages: agent?.getMessages() || [] }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.auto-agent.desktop')
  }

  createWindow()
  setupAgentHandlers()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    agent?.cleanup()
    app.quit()
  }
})

app.on('before-quit', () => {
  agent?.cleanup()
})
