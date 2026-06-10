/**
 * 文件操作工具（基于沙盒）
 * 所有文件操作都限制在用户沙盒内
 */

import { z } from 'zod'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { toolRegistry, type BuiltinToolExecutor, type BuiltinToolResult } from '../mcp/registry.js'
import { sandboxManager } from './sandbox.js'
import { log } from '@auto-agent/shared-utils'

// 参数定义
const FileReadSchema = z.object({
  path: z.string().describe('文件路径（相对于沙盒根目录）')
})

const FileWriteSchema = z.object({
  path: z.string().describe('文件路径（相对于沙盒根目录）'),
  content: z.string().describe('文件内容'),
  append: z.boolean().optional().describe('是否追加模式（默认false）')
})

const FileListSchema = z.object({
  path: z.string().optional().describe('目录路径（相对于沙盒根目录，默认根目录）')
})

const FileDeleteSchema = z.object({
  path: z.string().describe('文件或目录路径（相对于沙盒根目录）')
})

const FileStatsSchema = z.object({
  path: z.string().describe('文件或目录路径（相对于沙盒根目录）')
})

// 获取用户沙盒
function getUserSandbox(userId: string) {
  return sandboxManager.getOrCreateSandbox(userId)
}

// 读取文件
const fileReadExecutor: BuiltinToolExecutor = async (args, context): Promise<BuiltinToolResult> => {
  const { path } = FileReadSchema.parse(args)
  const sandbox = getUserSandbox(context.userId)

  const result = sandbox.resolvePath(path)
  if (!result.success) {
    return { success: false, error: result.error }
  }

  try {
    if (!existsSync(result.realPath!)) {
      return { success: false, error: `File not found: ${path}` }
    }

    const stats = statSync(result.realPath!)
    if (stats.isDirectory()) {
      return { success: false, error: `Path is a directory: ${path}` }
    }

    const content = readFileSync(result.realPath!, 'utf-8')
    return { success: true, data: { content, path, size: stats.size } }
  } catch (error) {
    log.error('FileTools', `Failed to read file: ${path}`, error)
    return { success: false, error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}` }
  }
}

// 写入文件
const fileWriteExecutor: BuiltinToolExecutor = async (args, context): Promise<BuiltinToolResult> => {
  const { path, content, append = false } = FileWriteSchema.parse(args)
  const sandbox = getUserSandbox(context.userId)

  const result = sandbox.resolvePath(path)
  if (!result.success) {
    return { success: false, error: result.error }
  }

  try {
    // 检查配额
    const contentSize = Buffer.byteLength(content, 'utf-8')
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
      const existingContent = readFileSync(result.realPath!, 'utf-8')
      writeFileSync(result.realPath!, existingContent + content, 'utf-8')
    } else {
      writeFileSync(result.realPath!, content, 'utf-8')
    }

    const stats = statSync(result.realPath!)
    return {
      success: true,
      data: {
        path,
        size: stats.size,
        modified: stats.mtime.toISOString()
      }
    }
  } catch (error) {
    log.error('FileTools', `Failed to write file: ${path}`, error)
    return { success: false, error: `Failed to write file: ${error instanceof Error ? error.message : String(error)}` }
  }
}

// 列出目录
const fileListExecutor: BuiltinToolExecutor = async (args, context): Promise<BuiltinToolResult> => {
  const { path = '' } = FileListSchema.parse(args)
  const sandbox = getUserSandbox(context.userId)

  const result = sandbox.resolvePath(path || '.')
  if (!result.success) {
    return { success: false, error: result.error }
  }

  try {
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
      type: entry.isDirectory() ? 'directory' : 'file',
      path: join(path || '', entry.name)
    }))

    return { success: true, data: { path: path || '.', files } }
  } catch (error) {
    log.error('FileTools', `Failed to list directory: ${path || '.'}`, error)
    return { success: false, error: `Failed to list directory: ${error instanceof Error ? error.message : String(error)}` }
  }
}

// 删除文件/目录
const fileDeleteExecutor: BuiltinToolExecutor = async (args, context): Promise<BuiltinToolResult> => {
  const { path } = FileDeleteSchema.parse(args)
  const sandbox = getUserSandbox(context.userId)

  const result = sandbox.resolvePath(path)
  if (!result.success) {
    return { success: false, error: result.error }
  }

  try {
    if (!existsSync(result.realPath!)) {
      return { success: false, error: `File or directory not found: ${path}` }
    }

    const stats = statSync(result.realPath!)
    if (stats.isDirectory()) {
      rmSync(result.realPath!, { recursive: true, force: true })
    } else {
      rmSync(result.realPath!)
    }

    return { success: true, data: { path, deleted: true } }
  } catch (error) {
    log.error('FileTools', `Failed to delete: ${path}`, error)
    return { success: false, error: `Failed to delete: ${error instanceof Error ? error.message : String(error)}` }
  }
}

// 获取文件/目录信息
const fileStatsExecutor: BuiltinToolExecutor = async (args, context): Promise<BuiltinToolResult> => {
  const { path } = FileStatsSchema.parse(args)
  const sandbox = getUserSandbox(context.userId)

  const result = sandbox.resolvePath(path)
  if (!result.success) {
    return { success: false, error: result.error }
  }

  try {
    if (!existsSync(result.realPath!)) {
      return { success: false, error: `File or directory not found: ${path}` }
    }

    const stats = statSync(result.realPath!)
    return {
      success: true,
      data: {
        path,
        type: stats.isDirectory() ? 'directory' : 'file',
        size: stats.size,
        created: stats.birthtime.toISOString(),
        modified: stats.mtime.toISOString(),
        accessed: stats.atime.toISOString()
      }
    }
  } catch (error) {
    log.error('FileTools', `Failed to get stats: ${path}`, error)
    return { success: false, error: `Failed to get stats: ${error instanceof Error ? error.message : String(error)}` }
  }
}

// 获取沙盒统计信息
const workspaceStatsExecutor: BuiltinToolExecutor = async (_args, context): Promise<BuiltinToolResult> => {
  const sandbox = getUserSandbox(context.userId)
  const stats = sandbox.getStats()

  return {
    success: true,
    data: {
      userId: context.userId,
      sandboxPath: sandbox.getSandboxPath(),
      ...stats,
      usagePercent: Math.round((stats.size / stats.maxSize) * 100)
    }
  }
}

// 注册所有文件工具
export function registerFileTools(): void {
  toolRegistry.registerBuiltin(
    'file_read',
    '读取沙盒内的文件内容',
    FileReadSchema,
    fileReadExecutor
  )

  toolRegistry.registerBuiltin(
    'file_write',
    '写入内容到沙盒内的文件（自动创建目录）',
    FileWriteSchema,
    fileWriteExecutor
  )

  toolRegistry.registerBuiltin(
    'file_list',
    '列出沙盒内指定目录的文件和子目录',
    FileListSchema,
    fileListExecutor
  )

  toolRegistry.registerBuiltin(
    'file_delete',
    '删除沙盒内的文件或目录',
    FileDeleteSchema,
    fileDeleteExecutor
  )

  toolRegistry.registerBuiltin(
    'file_stats',
    '获取沙盒内文件或目录的详细信息',
    FileStatsSchema,
    fileStatsExecutor
  )

  toolRegistry.registerBuiltin(
    'workspace_stats',
    '获取用户工作空间的统计信息（容量使用情况）',
    z.object({}),
    workspaceStatsExecutor
  )

  log.success('FileTools', 'Registered 6 file operation tools with sandbox isolation')
}
