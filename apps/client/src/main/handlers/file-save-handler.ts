/**
 * 代码保存到文件 IPC 处理器
 * 处理前端代码块的保存请求
 */

import { ipcMain, BrowserWindow, dialog } from 'electron'
import { fileWriteTool } from '../workspace/file-tools.js'
import { log } from '@auto-agent/shared-utils'

/**
 * 设置文件保存处理器
 */
export function setupFileSaveHandlers(): void {
  // 保存代码到文件
  ipcMain.handle('file:save_code', async (_event, filename: string, content: string) => {
    try {
      log.info('FileSave', `Saving code to file: ${filename}`)

      // 使用文件写入工具保存到沙盒
      const result = await fileWriteTool({
        path: filename,
        content: content,
        encoding: 'utf8'
      })

      if (result.success) {
        log.success('FileSave', `File saved successfully: ${filename}`)
        return { success: true }
      } else {
        log.error('FileSave', `Failed to save file: ${result.error}`)
        return { success: false, error: result.error }
      }
    } catch (error) {
      log.error('FileSave', 'Unexpected error saving file', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })
}
