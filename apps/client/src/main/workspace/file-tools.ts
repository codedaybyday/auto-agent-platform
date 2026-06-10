/**
 * 沙盒文件操作工具（Client 端）
 * 所有文件操作都限制在用户沙盒内
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { WorkspaceSandbox, sandboxManager } from './sandbox.js'

// 当前用户ID（从环境变量或配置获取，默认 'default'）
let currentUserId: string = process.env.AUTOAGENT_USER_ID || 'default'

/**
 * 设置当前用户ID
 */
export function setCurrentUser(userId: string): void {
  currentUserId = userId
}

/**
 * 获取当前用户ID
 */
export function getCurrentUser(): string {
  return currentUserId
}

/**
 * 获取当前用户的沙盒
 */
function getSandbox(): WorkspaceSandbox {
  return sandboxManager.getOrCreateSandbox(currentUserId)
}

export interface FileReadInput {
  path: string
  encoding?: 'utf8' | 'base64'
}

export interface FileReadOutput {
  success: boolean
  content?: string
  error?: string
  size?: number
}

export interface FileWriteInput {
  path: string
  content: string
  encoding?: 'utf8' | 'base64'
  append?: boolean
}

export interface FileWriteOutput {
  success: boolean
  message?: string
  error?: string
  size?: number
}

export interface FileListInput {
  path?: string
}

export interface FileListOutput {
  success: boolean
  files?: { name: string; type: 'file' | 'directory'; path: string }[]
  error?: string
}

export interface FileDeleteInput {
  path: string
}

export interface FileDeleteOutput {
  success: boolean
  message?: string
  error?: string
}

export interface FileStatsInput {
  path: string
}

export interface FileStatsOutput {
  success: boolean
  stats?: {
    path: string
    type: 'file' | 'directory'
    size: number
    created: string
    modified: string
    accessed: string
  }
  error?: string
}

export interface WorkspaceStatsOutput {
  success: boolean
  data?: {
    userId: string
    sandboxPath: string
    size: number
    fileCount: number
    maxSize: number
    maxFiles: number
    usagePercent: number
  }
  error?: string
}

/**
 * 文件读取工具（沙盒隔离）
 */
export async function fileReadTool(input: FileReadInput): Promise<FileReadOutput> {
  try {
    const { path, encoding = 'utf8' } = input
    const sandbox = getSandbox()

    if (!path) {
      return { success: false, error: 'File path is required' }
    }

    const result = sandbox.resolvePath(path)
    if (!result.success) {
      return { success: false, error: result.error }
    }

    if (!existsSync(result.realPath!)) {
      return { success: false, error: `File not found: ${path}` }
    }

    const stats = statSync(result.realPath!)
    if (stats.isDirectory()) {
      return { success: false, error: `Path is a directory: ${path}` }
    }

    const content = readFileSync(result.realPath!, encoding)

    return {
      success: true,
      content,
      size: content.length
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * 文件写入工具（沙盒隔离）
 */
export async function fileWriteTool(input: FileWriteInput): Promise<FileWriteOutput> {
  try {
    const { path, content, encoding = 'utf8', append = false } = input
    const sandbox = getSandbox()

    if (!path || content === undefined) {
      return { success: false, error: 'File path and content are required' }
    }

    const result = sandbox.resolvePath(path)
    if (!result.success) {
      return { success: false, error: result.error }
    }

    // 检查配额
    const contentSize = Buffer.byteLength(content, encoding)
    const quotaCheck = sandbox.checkQuota(append ? 0 : contentSize)
    if (!quotaCheck.allowed) {
      return { success: false, error: `Quota exceeded: ${quotaCheck.reason}` }
    }

    // 确保父目录存在
    const parentDir = dirname(result.realPath!)
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true })
    }

    // 写入文件
    if (append && existsSync(result.realPath!)) {
      const existingContent = readFileSync(result.realPath!, encoding)
      writeFileSync(result.realPath!, existingContent + content, encoding)
    } else {
      writeFileSync(result.realPath!, content, encoding)
    }

    return {
      success: true,
      message: `File written successfully: ${path}`,
      size: content.length
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * 文件列表工具（沙盒隔离）
 */
export async function fileListTool(input: FileListInput): Promise<FileListOutput> {
  try {
    const { path = '' } = input
    const sandbox = getSandbox()

    const result = sandbox.resolvePath(path || '.')
    if (!result.success) {
      return { success: false, error: result.error }
    }

    if (!existsSync(result.realPath!)) {
      return { success: false, error: `Directory not found: ${path || '.'}` }
    }

    const stats = statSync(result.realPath!)
    if (!stats.isDirectory()) {
      return { success: false, error: `Path is not a directory: ${path || '.'}` }
    }

    const entries = readdirSync(result.realPath!, { withFileTypes: true })
    const files = entries.map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' as const : 'file' as const,
      path: join(path || '', entry.name)
    }))

    return { success: true, files }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * 文件删除工具（沙盒隔离）
 */
export async function fileDeleteTool(input: FileDeleteInput): Promise<FileDeleteOutput> {
  try {
    const { path } = input
    const sandbox = getSandbox()

    if (!path) {
      return { success: false, error: 'Path is required' }
    }

    const result = sandbox.resolvePath(path)
    if (!result.success) {
      return { success: false, error: result.error }
    }

    if (!existsSync(result.realPath!)) {
      return { success: false, error: `File or directory not found: ${path}` }
    }

    const stats = statSync(result.realPath!)
    if (stats.isDirectory()) {
      rmSync(result.realPath!, { recursive: true, force: true })
    } else {
      rmSync(result.realPath!)
    }

    return { success: true, message: `Deleted: ${path}` }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * 文件状态工具（沙盒隔离）
 */
export async function fileStatsTool(input: FileStatsInput): Promise<FileStatsOutput> {
  try {
    const { path } = input
    const sandbox = getSandbox()

    if (!path) {
      return { success: false, error: 'Path is required' }
    }

    const result = sandbox.resolvePath(path)
    if (!result.success) {
      return { success: false, error: result.error }
    }

    if (!existsSync(result.realPath!)) {
      return { success: false, error: `File or directory not found: ${path}` }
    }

    const stats = statSync(result.realPath!)
    return {
      success: true,
      stats: {
        path,
        type: stats.isDirectory() ? 'directory' : 'file',
        size: stats.size,
        created: stats.birthtime.toISOString(),
        modified: stats.mtime.toISOString(),
        accessed: stats.atime.toISOString()
      }
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * 工作空间统计工具
 */
export async function workspaceStatsTool(): Promise<WorkspaceStatsOutput> {
  try {
    const sandbox = getSandbox()
    const stats = sandbox.getStats()

    return {
      success: true,
      data: {
        userId: currentUserId,
        sandboxPath: sandbox.getSandboxPath(),
        ...stats,
        usagePercent: Math.round((stats.size / stats.maxSize) * 100)
      }
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
