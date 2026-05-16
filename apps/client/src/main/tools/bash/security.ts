/**
 * Bash 工具安全层
 * 提供命令检查、路径限制、用户确认等安全功能
 */

import { SecurityPolicy, UserConfirmationCallback } from './types.js'

export class BashSecurity {
  private policy: SecurityPolicy
  private confirmCallback?: UserConfirmationCallback

  constructor(policy?: Partial<SecurityPolicy>, confirmCallback?: UserConfirmationCallback) {
    this.policy = {
      blockedPatterns: policy?.blockedPatterns ?? defaultBlockedPatterns,
      allowedPaths: policy?.allowedPaths ?? [],
      maxExecutionTime: policy?.maxExecutionTime ?? 60000,
      maxOutputSize: policy?.maxOutputSize ?? 200000,
      requireConfirmation: policy?.requireConfirmation ?? true,
      confirmationPatterns: policy?.confirmationPatterns ?? defaultConfirmationPatterns
    }
    this.confirmCallback = confirmCallback
  }

  /**
   * 检查命令是否安全
   */
  async validate(command: string): Promise<{ safe: boolean; reason?: string; riskLevel: 'low' | 'medium' | 'high' }> {
    // 1. 检查黑名单
    const blocked = this.checkBlocked(command)
    if (blocked) {
      return { safe: false, reason: `Dangerous command blocked: ${blocked}`, riskLevel: 'high' }
    }

    // 2. 检查路径限制
    const pathCheck = this.checkPaths(command)
    if (!pathCheck.allowed) {
      return { safe: false, reason: pathCheck.reason, riskLevel: 'high' }
    }

    // 3. 评估风险等级
    const riskLevel = this.assessRisk(command)

    // 4. 高风险命令需要确认
    if (riskLevel === 'high' && this.policy.requireConfirmation) {
      if (this.confirmCallback) {
        const confirmed = await this.confirmCallback(command, riskLevel)
        if (!confirmed) {
          return { safe: false, reason: 'User cancelled the operation', riskLevel }
        }
      }
    }

    return { safe: true, riskLevel }
  }

  /**
   * 检查是否匹配黑名单
   */
  private checkBlocked(command: string): string | null {
    for (const pattern of this.policy.blockedPatterns) {
      if (pattern.test(command)) {
        return pattern.toString()
      }
    }
    return null
  }

  /**
   * 检查路径是否允许
   */
  private checkPaths(command: string): { allowed: boolean; reason?: string } {
    // 如果没有设置允许路径，则允许所有
    if (this.policy.allowedPaths.length === 0) {
      return { allowed: true }
    }

    // 提取命令中的路径
    const pathMatches = command.match(/[\"']?([\/\\][^\"'\s]+)[\"']?/g) || []

    for (const match of pathMatches) {
      const path = match.replace(/^[\"']|[\"']$/g, '')
      const allowed = this.policy.allowedPaths.some(allowedPath =>
        path.startsWith(allowedPath) || path === allowedPath
      )
      if (!allowed) {
        return { allowed: false, reason: `Path not allowed: ${path}` }
      }
    }

    return { allowed: true }
  }

  /**
   * 评估命令风险等级
   */
  private assessRisk(command: string): 'low' | 'medium' | 'high' {
    // 高风险模式
    for (const pattern of this.policy.confirmationPatterns) {
      if (pattern.test(command)) {
        return 'high'
      }
    }

    // 中风险：修改系统配置
    const mediumRiskPatterns = [
      /\bsudo\b/,
      /\bsu\s/,
      /chmod\s+[0-9]{3,4}/,
      /chown\s+/,
      /systemctl\s+/,
      /service\s+/,
      /brew\s+(install|uninstall|remove)/,
      /npm\s+install\s+-g/,
      /pip\s+install/,
      /docker\s+/,
      /kubectl\s+/
    ]

    for (const pattern of mediumRiskPatterns) {
      if (pattern.test(command)) {
        return 'medium'
      }
    }

    return 'low'
  }

  /**
   * 获取最大执行时间
   */
  getMaxExecutionTime(): number {
    return this.policy.maxExecutionTime
  }

  /**
   * 获取最大输出大小
   */
  getMaxOutputSize(): number {
    return this.policy.maxOutputSize
  }

  /**
   * 截断输出
   */
  truncateOutput(output: string): { output: string; truncated: boolean } {
    if (output.length <= this.policy.maxOutputSize) {
      return { output, truncated: false }
    }
    return {
      output: output.substring(0, this.policy.maxOutputSize) + '\n... (truncated)',
      truncated: true
    }
  }

  /**
   * 更新安全策略
   */
  updatePolicy(policy: Partial<SecurityPolicy>): void {
    this.policy = { ...this.policy, ...policy }
  }

  /**
   * 设置确认回调
   */
  setConfirmCallback(callback: UserConfirmationCallback): void {
    this.confirmCallback = callback
  }
}

// 默认危险命令黑名单
const defaultBlockedPatterns: RegExp[] = [
  // 删除根目录
  /rm\s+(-rf?|--recursive)\s+\//,
  /rm\s+\//,
  // 格式化磁盘
  />\s*\/dev\/(sd[a-z]|disk[0-9]|nvme[0-9])/,
  /dd\s+if=.*of=\/dev\/(sd[a-z]|disk[0-9]|nvme[0-9])/,
  // Fork bomb
  /:\(\)\{\s*:\|:\s*\}&/,
  // 删除 home 目录
  /rm\s+(-rf?|--recursive)\s+~\/\s*$/,
  // 删除所有文件
  /rm\s+(-rf?|--recursive)\s+\*$/,
  // 覆盖重要系统文件
  />\s*\/etc\/passwd/,
  />\s*\/etc\/shadow/,
  // 危险的 curl/wget
  /curl\s+.*\|\s*bash/,
  /wget\s+.*\|\s*bash/,
  /curl\s+.*\|\s*sh/,
  /wget\s+.*\|\s*sh/,
  // 修改启动项
  /rm\s+(-rf?)?\s*\/boot/,
  // 危险的 chmod
  /chmod\s+(-R\s+)?777\s+\//,
  /chmod\s+(-R\s+)?000\s+\//
]

// 默认需要确认的高风险模式
const defaultConfirmationPatterns: RegExp[] = [
  // 删除操作
  /rm\s+(-rf?|--recursive)/,
  // 修改权限
  /chmod\s+(-R\s+)?777/,
  /chown\s+(-R\s+)?/,
  // 系统修改
  /sudo\s+/,
  /su\s+-/,
  // 网络下载执行
  /curl\s+.*\|/,
  /wget\s+.*\|/
]

// 导出默认配置
export { defaultBlockedPatterns, defaultConfirmationPatterns }
