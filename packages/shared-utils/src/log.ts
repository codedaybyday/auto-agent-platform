/**
 * 简易埋点工具 - 为 console 输出添加时间戳
 *
 * 使用示例：
 * import { log } from '@auto-agent/shared-utils'
 *
 * log.info('BrowserManager', 'Chrome 启动中...')
 * // 输出: [14:32:46.456] [BrowserManager] Chrome 启动中...
 *
 * log.error('Controller', 'Failed to get DOM', error)
 * // 输出: [14:32:47.123] [Controller] ❌ Failed to get DOM
 */

/**
 * 获取当前时间戳字符串 (HH:MM:SS.ms)
 */
function getTimeStamp(): string {
  const now = new Date()
  const hours = now.getHours().toString().padStart(2, '0')
  const minutes = now.getMinutes().toString().padStart(2, '0')
  const seconds = now.getSeconds().toString().padStart(2, '0')
  const ms = now.getMilliseconds().toString().padStart(3, '0')
  return `${hours}:${minutes}:${seconds}.${ms}`
}

/**
 * 简易埋点对象 - 为 console 添加时间戳
 */
export const log = {
  /**
   * 普通日志
   * @param module - 模块名称
   * @param message - 日志消息
   * @param data - 额外数据（可选）
   */
  info(module: string, message: string, data?: any): void {
    const time = getTimeStamp()
    if (data !== undefined) {
      console.log(`[${time}] [${module}] ${message}`, data)
    } else {
      console.log(`[${time}] [${module}] ${message}`)
    }
  },

  /**
   * 错误日志
   * @param module - 模块名称
   * @param message - 错误消息
   * @param error - 错误对象（可选）
   */
  error(module: string, message: string, error?: Error | any): void {
    const time = getTimeStamp()
    if (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error(`[${time}] [${module}] ❌ ${message}:`, errorMsg)
    } else {
      console.error(`[${time}] [${module}] ❌ ${message}`)
    }
  },

  /**
   * 警告日志
   * @param module - 模块名称
   * @param message - 警告消息
   * @param data - 额外数据（可选）
   */
  warn(module: string, message: string, data?: any): void {
    const time = getTimeStamp()
    if (data !== undefined) {
      console.warn(`[${time}] [${module}] ⚠️ ${message}`, data)
    } else {
      console.warn(`[${time}] [${module}] ⚠️ ${message}`)
    }
  },

  /**
   * 成功日志
   * @param module - 模块名称
   * @param message - 成功消息
   */
  success(module: string, message: string): void {
    const time = getTimeStamp()
    console.log(`[${time}] [${module}] ✅ ${message}`)
  },

  /**
   * 性能计时日志
   * @param module - 模块名称
   * @param operationName - 操作名称
   * @param durationMs - 耗时（毫秒）
   */
  perf(module: string, operationName: string, durationMs: number): void {
    const time = getTimeStamp()
    const durationStr = durationMs < 1000
      ? `${durationMs.toFixed(1)}ms`
      : `${(durationMs / 1000).toFixed(2)}s`
    console.log(`[${time}] [${module}] ⏱️ ${operationName}: ${durationStr}`)
  },

  /**
   * 调试日志（JSON 格式）
   * @param module - 模块名称
   * @param message - 消息
   * @param data - 调试数据
   */
  debug(module: string, message: string, data: any): void {
    const time = getTimeStamp()
    console.debug(`[${time}] [${module}] 🔍 ${message}`, JSON.stringify(data, null, 2))
  },
}

/**
 * 性能计时工具 - 用于测量操作耗时
 */
const timers = new Map<string, number>()

export const timer = {
  /**
   * 开始计时
   * @param key - 计时器键名
   */
  start(key: string): void {
    timers.set(key, performance.now())
  },

  /**
   * 结束计时并返回耗时（毫秒）
   * @param key - 计时器键名
   * @param module - 模块名称
   * @param operationName - 操作名称（用于输出日志）
   * @returns 耗时（毫秒）
   */
  end(key: string, module?: string, operationName?: string): number {
    const startTime = timers.get(key)
    if (!startTime) {
      console.warn(`[${getTimeStamp()}] ⚠️ 计时器 "${key}" 不存在`)
      return 0
    }

    const duration = performance.now() - startTime
    timers.delete(key)

    // 如果提供了模块名，自动输出日志
    if (module && operationName) {
      log.perf(module, operationName, duration)
    }

    return duration
  },

  /**
   * 清空所有计时器
   */
  clear(): void {
    timers.clear()
  },
}
