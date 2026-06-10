/**
 * Workspace Sandbox - 文件沙盒空间管理（Client 端）
 *
 * 功能：
 * - 每个用户拥有独立的文件沙盒空间（用户级别隔离）
 * - 同一用户的所有会话共享同一个工作空间
 * - 文件操作限制在沙盒内，与外界隔离
 * - 防止路径穿越攻击
 * - 支持空间配额管理
 * - 沙盒根目录可配置
 */

import { mkdirSync, existsSync, rmSync, readdirSync, statSync } from 'fs'
import { join, resolve, normalize, isAbsolute, relative } from 'path'
import { homedir } from 'os'

export interface SandboxConfig {
  /** 沙盒根目录 */
  basePath: string
  /** 用户ID（沙盒隔离级别：用户级别） */
  userId: string
  /** 最大容量（字节） */
  maxSize: number
  /** 最大文件数 */
  maxFiles: number
}

export interface FileOperationResult {
  success: boolean
  realPath?: string
  sandboxPath?: string
  error?: string
}

export class WorkspaceSandbox {
  private config: SandboxConfig
  private sandboxPath: string

  constructor(config: Partial<SandboxConfig> & { userId: string }) {
    const defaultBasePath = process.env.AUTOAGENT_WORKSPACE_PATH ||
      join(homedir(), 'AutoAgentWorkspace')

    this.config = {
      basePath: config.basePath || defaultBasePath,
      userId: config.userId,
      maxSize: config.maxSize ?? 100 * 1024 * 1024, // 100MB
      maxFiles: config.maxFiles ?? 1000
    }

    // 沙盒路径：basePath/userId/
    this.sandboxPath = resolve(join(this.config.basePath, this.config.userId))

    // 确保沙盒目录存在
    this.ensureSandboxExists()

    console.log('[WorkspaceSandbox] Initialized for user:', this.config.userId, {
      path: this.sandboxPath
    })
  }

  /**
   * 确保沙盒目录存在
   */
  private ensureSandboxExists(): void {
    if (!existsSync(this.sandboxPath)) {
      mkdirSync(this.sandboxPath, { recursive: true })
      console.log('[WorkspaceSandbox] Created directory:', this.sandboxPath)
    }
  }

  /**
   * 解析路径为沙盒内绝对路径
   * - 相对路径：基于沙盒根目录
   * - 绝对路径：拒绝或转换为相对路径处理
   */
  resolvePath(userPath: string): FileOperationResult {
    try {
      // 空路径检查
      if (!userPath || userPath.trim() === '') {
        return {
          success: false,
          error: 'Path is required'
        }
      }

      // 清理路径，移除多余的分隔符和 . ..
      const cleanPath = normalize(userPath.trim())

      // 路径穿越攻击检查：路径包含 .. 或试图跳出沙盒
      if (cleanPath.includes('..') || cleanPath.startsWith('~')) {
        return {
          success: false,
          error: 'Invalid path: path traversal detected'
        }
      }

      // 如果是绝对路径，提取相对部分或拒绝
      let relativePath: string
      if (isAbsolute(cleanPath)) {
        // 检查是否已经在沙盒内
        const relToSandbox = relative(this.sandboxPath, cleanPath)
        if (relToSandbox.startsWith('..') || relToSandbox === '') {
          return {
            success: false,
            error: 'Absolute paths outside sandbox are not allowed'
          }
        }
        relativePath = relToSandbox
      } else {
        relativePath = cleanPath
      }

      // 再次检查相对路径是否包含 ..
      if (relativePath.includes('..')) {
        return {
          success: false,
          error: 'Invalid path: path traversal detected'
        }
      }

      // 计算最终沙盒内路径
      const realPath = resolve(join(this.sandboxPath, relativePath))

      // 最终安全检查：确保解析后的路径仍在沙盒内
      const finalRelPath = relative(this.sandboxPath, realPath)
      if (finalRelPath.startsWith('..') || finalRelPath === '') {
        return {
          success: false,
          error: 'Path escapes sandbox boundary'
        }
      }

      return {
        success: true,
        realPath,
        sandboxPath: relativePath
      }
    } catch (error) {
      return {
        success: false,
        error: `Path resolution error: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  /**
   * 获取沙盒根路径
   */
  getSandboxPath(): string {
    return this.sandboxPath
  }

  /**
   * 获取相对沙盒的路径
   */
  getRelativePath(absolutePath: string): string {
    return relative(this.sandboxPath, absolutePath)
  }

  /**
   * 检查路径是否在沙盒内
   */
  isPathInSandbox(absolutePath: string): boolean {
    const rel = relative(this.sandboxPath, resolve(absolutePath))
    return !rel.startsWith('..') && rel !== ''
  }

  /**
   * 获取沙盒统计信息
   */
  getStats(): { size: number; fileCount: number; maxSize: number; maxFiles: number } {
    let size = 0
    let fileCount = 0

    try {
      const walkDir = (dir: string) => {
        const entries = readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = join(dir, entry.name)
          if (entry.isDirectory()) {
            walkDir(fullPath)
          } else {
            fileCount++
            try {
              const stats = statSync(fullPath)
              size += stats.size
            } catch {
              // ignore
            }
          }
        }
      }

      if (existsSync(this.sandboxPath)) {
        walkDir(this.sandboxPath)
      }
    } catch (error) {
      console.warn('[WorkspaceSandbox] Failed to get stats', error)
    }

    return {
      size,
      fileCount,
      maxSize: this.config.maxSize,
      maxFiles: this.config.maxFiles
    }
  }

  /**
   * 检查是否超出容量限制
   */
  checkQuota(newFileSize: number = 0): { allowed: boolean; reason?: string } {
    const stats = this.getStats()

    if (stats.fileCount >= this.config.maxFiles) {
      return { allowed: false, reason: `File count limit reached (${this.config.maxFiles})` }
    }

    if (stats.size + newFileSize > this.config.maxSize) {
      return { allowed: false, reason: `Storage quota exceeded (${this.config.maxSize} bytes)` }
    }

    return { allowed: true }
  }

  /**
   * 清理沙盒（删除所有文件）
   */
  cleanup(): void {
    try {
      if (existsSync(this.sandboxPath)) {
        rmSync(this.sandboxPath, { recursive: true, force: true })
        console.log('[WorkspaceSandbox] Cleaned up:', this.sandboxPath)
      }
    } catch (error) {
      console.error('[WorkspaceSandbox] Failed to cleanup:', this.sandboxPath, error)
    }
  }

  /**
   * 获取用户ID
   */
  getUserId(): string {
    return this.config.userId
  }
}

/**
 * 沙盒管理器 - 管理所有用户的沙盒（用户级别隔离）
 */
export class SandboxManager {
  private sandboxes = new Map<string, WorkspaceSandbox>()
  private basePath: string

  constructor(basePath?: string) {
    this.basePath = basePath || process.env.AUTOAGENT_WORKSPACE_PATH ||
      join(homedir(), 'AutoAgentWorkspace')
    // 确保基础目录存在
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true })
    }
  }

  /**
   * 获取或创建沙盒（按用户隔离）
   */
  getOrCreateSandbox(userId: string): WorkspaceSandbox {
    let sandbox = this.sandboxes.get(userId)
    if (!sandbox) {
      sandbox = new WorkspaceSandbox({
        userId,
        basePath: this.basePath
      })
      this.sandboxes.set(userId, sandbox)
    }
    return sandbox
  }

  /**
   * 获取沙盒（如果不存在返回 null）
   */
  getSandbox(userId: string): WorkspaceSandbox | null {
    return this.sandboxes.get(userId) || null
  }

  /**
   * 释放沙盒（用户注销时调用）
   */
  releaseSandbox(userId: string): void {
    const sandbox = this.sandboxes.get(userId)
    if (sandbox) {
      this.sandboxes.delete(userId)
      console.log('[SandboxManager] Released sandbox for user:', userId)
    }
  }

  /**
   * 获取所有沙盒统计
   */
  getAllStats(): { userId: string; stats: ReturnType<WorkspaceSandbox['getStats']> }[] {
    const result = []
    for (const [userId, sandbox] of this.sandboxes) {
      result.push({ userId, stats: sandbox.getStats() })
    }
    return result
  }
}

// 导出全局单例
export const sandboxManager = new SandboxManager()
