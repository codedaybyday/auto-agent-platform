/**
 * 浏览器指令解析器
 * 简单指令解析（降级方案）
 * 当服务端未解析时，客户端基于关键词匹配
 */

export function parseBrowserInstruction(instruction: string): any {
  const lower = instruction.toLowerCase()

  // 导航
  const navMatch = instruction.match(/(?:go to|open|visit|navigate to)\s+(https?:\/\/[^\s]+)/i)
  if (navMatch) {
    return { type: 'navigate', url: navMatch[1] }
  }

  // 点击
  const clickMatch = instruction.match(/(?:click|press)\s+(?:on\s+)?(?:the\s+)?["']?([^"']+)["']?/i)
  if (clickMatch) {
    return { type: 'click', description: clickMatch[1] }
  }

  // 输入
  const typeMatch = instruction.match(/(?:type|enter)\s+["']([^"']+)["']\s+(?:in|into)\s+["']?([^"']+)["']?/i)
  if (typeMatch) {
    return { type: 'type', text: typeMatch[1], field: typeMatch[2] }
  }

  // 滚动
  const scrollMatch = instruction.match(/(?:scroll)\s+(up|down)/i)
  if (scrollMatch) {
    return { type: 'scroll', direction: scrollMatch[1].toLowerCase(), amount: 500 }
  }

  // 截图
  if (lower.includes('screenshot')) {
    return { type: 'screenshot' }
  }

  // 等待
  const waitMatch = instruction.match(/(?:wait)\s+(\d+)/i)
  if (waitMatch) {
    return { type: 'wait', timeout: parseInt(waitMatch[1]) * 1000 }
  }

  // 默认分析
  return { type: 'analyze' }
}
