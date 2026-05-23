/**
 * 文件服务路由
 * 
 * POST /api/files/upload       - 上传文件（返回文件 URL）
 * GET  /api/files/:fileId       - 下载文件
 * GET  /api/files/:fileId/info  - 获取文件信息
 */

import { Router, Request, Response } from 'express'
import { fileStorage } from '../services/file-storage.js'

export function createFilesRouter(): Router {
  const router = Router()

  /**
   * 上传文件
   * POST /api/files/upload
   */
  router.post('/upload', async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['x-session-id'] as string
      const filename = (req.headers['x-filename'] as string) || 'file'
      const mimeType = (req.headers['content-type'] as string) || 'application/octet-stream'

      if (!sessionId) {
        res.status(400).json({
          error: 'Missing x-session-id header'
        })
        return
      }

      // 收集请求体数据
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        try {
          const buffer = Buffer.concat(chunks)

          // 保存文件
          const { id, url } = fileStorage.save(sessionId, buffer, filename, mimeType)

          console.log(`[Files] Uploaded file: ${filename} (${buffer.length} bytes) -> ${url}`)

          res.json({
            success: true,
            id,
            url,
            size: buffer.length
          })
        } catch (error) {
          console.error('[Files] Error saving file:', error)
          res.status(400).json({
            error: error instanceof Error ? error.message : 'Failed to save file'
          })
        }
      })

      req.on('error', error => {
        console.error('[Files] Error uploading file:', error)
        res.status(500).json({
          error: 'Upload error'
        })
      })
    } catch (error) {
      console.error('[Files] Error handling upload:', error)
      res.status(500).json({
        error: 'Internal server error'
      })
    }
  })

  /**
   * 下载文件
   * GET /api/files/:fileId
   */
  router.get('/:fileId', (req: Request, res: Response) => {
    const { fileId } = req.params

    try {
      const file = fileStorage.get(fileId)

      if (!file) {
        res.status(404).json({
          error: 'File not found or expired'
        })
        return
      }

      // 设置响应头
      res.setHeader('Content-Type', file.mimeType)
      res.setHeader('Content-Length', file.size)
      res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`)
      res.setHeader('Cache-Control', 'public, max-age=3600')

      // 发送文件数据
      res.send(file.data)

      console.log(`[Files] Downloaded file ${fileId} (${file.size} bytes)`)
    } catch (error) {
      console.error('[Files] Error downloading file:', error)
      res.status(500).json({
        error: 'Internal server error'
      })
    }
  })

  /**
   * 获取文件信息
   * GET /api/files/:fileId/info
   */
  router.get('/:fileId/info', (req: Request, res: Response) => {
    const { fileId } = req.params

    try {
      const file = fileStorage.get(fileId)

      if (!file) {
        res.status(404).json({
          error: 'File not found or expired'
        })
        return
      }

      res.json({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        createdAt: file.createdAt,
        expiresAt: file.expiresAt,
        url: file.url
      })
    } catch (error) {
      console.error('[Files] Error getting file info:', error)
      res.status(500).json({
        error: 'Internal server error'
      })
    }
  })

  /**
   * 获取存储统计信息（调试用）
   * GET /api/files/stats
   */
  router.get('/debug/stats', (req: Request, res: Response) => {
    try {
      const stats = fileStorage.getStats()
      res.json({
        ...stats,
        totalSizeMB: (stats.totalSize / 1024 / 1024).toFixed(2)
      })
    } catch (error) {
      console.error('[Files] Error getting stats:', error)
      res.status(500).json({
        error: 'Internal server error'
      })
    }
  })

  return router
}
