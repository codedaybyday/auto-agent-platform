/**
 * File Tools - 文件操作工具
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

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
}

export interface FileWriteOutput {
  success: boolean
  message?: string
  error?: string
  size?: number
}

/**
 * 文件读取工具
 */
export async function fileReadTool(input: FileReadInput): Promise<FileReadOutput> {
  try {
    const { path, encoding = 'utf8' } = input

    if (!path) {
      return { success: false, error: 'File path is required' }
    }

    const content = readFileSync(path, encoding)

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
 * 文件写入工具
 */
export async function fileWriteTool(input: FileWriteInput): Promise<FileWriteOutput> {
  try {
    const { path, content, encoding = 'utf8' } = input

    if (!path || content === undefined) {
      return {
        success: false,
        error: 'File path and content are required'
      }
    }

    const dir = dirname(path)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    writeFileSync(path, content, encoding)

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
