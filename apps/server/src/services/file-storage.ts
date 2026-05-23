/**
 * 文件存储服务
 * 
 * 用于存储临时文件（如截图），并提供访问链接
 * 特性：
 * - 内存存储（可扩展为磁盘/S3）
 * - 自动过期机制（TTL）
 * - 按 sessionId 隔离
 * - 文件大小限制
 * - 支持批量清理
 */

import crypto from 'crypto'

export interface StoredFile {
  id: string
  sessionId: string
  name: string
  mimeType: string
  data: Buffer
  size: number
  createdAt: number
  expiresAt: number
  url?: string
}

export interface FileStorageConfig {
  /** 文件 TTL（毫秒），默认 24 小时 */
  fileTTL: number
  /** 单个文件最大大小（字节），默认 10MB */
  maxFileSize: number
  /** 最多保存多少个文件，默认 1000 */
  maxFileCount: number
  /** 清理间隔（毫秒），默认 5 分钟 */
  cleanupInterval: number
  /** 服务器基础 URL（用于生成文件访问链接）*/
  baseUrl: string
}

export class FileStorageService {
  private files = new Map<string, StoredFile>()
  private config: FileStorageConfig
  private cleanupTimer: NodeJS.Timeout | null = null

  constructor(config: Partial<FileStorageConfig> = {}) {
    this.config = {
      fileTTL: config.fileTTL ?? 24 * 60 * 60 * 1000, // 24小时
      maxFileSize: config.maxFileSize ?? 10 * 1024 * 1024, // 10MB
      maxFileCount: config.maxFileCount ?? 1000,
      cleanupInterval: config.cleanupInterval ?? 5 * 60 * 1000, // 5分钟
      baseUrl: config.baseUrl ?? 'http://localhost:3000'
    }

    console.log('[FileStorage] Initialized with config:', {
      fileTTL: `${this.config.fileTTL / 1000}s`,
      maxFileSize: `${this.config.maxFileSize / 1024 / 1024}MB`,
      maxFileCount: this.config.maxFileCount,
      baseUrl: this.config.baseUrl
    })

    // 启动定时清理
    this.startCleanup()
  }

  /**
   * 保存文件
   */
  save(
    sessionId: string,
    data: Buffer,
    name: string = 'file',
    mimeType: string = 'application/octet-stream'
  ): { id: string; url: string } {
    // 检查文件大小
    if (data.length > this.config.maxFileSize) {
      throw new Error(
        `File size ${data.length} exceeds limit ${this.config.maxFileSize}`
      )
    }

    // 检查文件数量
    if (this.files.size >= this.config.maxFileCount) {
      throw new Error(`File storage full (${this.config.maxFileCount} files)`)
    }

    // 生成文件 ID
    const id = this.generateFileId()

    const now = Date.now()
    const file: StoredFile = {
      id,
      sessionId,
      name,
      mimeType,
      data,
      size: data.length,
      createdAt: now,
      expiresAt: now + this.config.fileTTL,
      url: `${this.config.baseUrl}/api/files/${id}`
    }

    this.files.set(id, file)

    console.log(`[FileStorage] Saved file: ${id} (${data.length} bytes)`)

    return {
      id,
      url: file.url!
    }
  }

  /**
   * 获取文件
   */
  get(fileId: string): StoredFile | null {
    const file = this.files.get(fileId)

    if (!file) {
      return null
    }

    // 检查是否过期
    if (file.expiresAt < Date.now()) {
      this.files.delete(fileId)
      return null
    }

    return file
  }

  /**
   * 删除文件
   */
  delete(fileId: string): boolean {
    return this.files.delete(fileId)
  }

  /**
   * 删除会话的所有文件
   */
  deleteSession(sessionId: string): number {
    let count = 0
    for (const [fileId, file] of this.files) {
      if (file.sessionId === sessionId) {
        this.files.delete(fileId)
        count++
      }
    }
    console.log(`[FileStorage] Deleted ${count} files for session ${sessionId}`)
    return count
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalFiles: number
    totalSize: number
    sessionCount: number
  } {
    let totalSize = 0
    const sessions = new Set<string>()

    for (const file of this.files.values()) {
      totalSize += file.size
      sessions.add(file.sessionId)
    }

    return {
      totalFiles: this.files.size,
      totalSize,
      sessionCount: sessions.size
    }
  }

  /**
   * 清理过期文件
   */
  cleanup(): number {
    const now = Date.now()
    let count = 0

    for (const [fileId, file] of this.files) {
      if (file.expiresAt < now) {
        this.files.delete(fileId)
        count++
      }
    }

    if (count > 0) {
      console.log(`[FileStorage] Cleaned up ${count} expired files`)
    }

    return count
  }

  /**
   * 启动定时清理
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup()
    }, this.config.cleanupInterval)
  }

  /**
   * 停止定时清理
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /**
   * 生成文件 ID
   */
  private generateFileId(): string {
    return crypto.randomBytes(16).toString('hex')
  }
}

// 导出全局单例
export const fileStorage = new FileStorageService({
  baseUrl: process.env.SERVER_BASE_URL || 'http://localhost:3000'
})
