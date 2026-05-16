/**
 * 快速测试 Bash 工具
 * 在 Electron 主进程中运行
 */

import { createBashTool, sessionManager } from './tools/bash/index.js'

export async function testBashTool(): Promise<void> {
  console.log('\n=== Bash Tool 快速测试 ===\n')

  const sessionId = `test_${Date.now()}`
  const tool = createBashTool(sessionId, async (cmd, risk) => {
    console.log(`[确认] ${risk}: ${cmd}`)
    return true
  })

  try {
    // 测试 1: 基本命令
    console.log('Test 1: echo 命令')
    const r1 = await tool.execute({ command: 'echo "Hello"' })
    console.log('输出:', r1.stdout, '| 退出码:', r1.exit_code)
    console.log(r1.exit_code === 0 && r1.stdout === 'Hello' ? '✅ 通过' : '❌ 失败')

    // 测试 2: cd 持久化
    console.log('\nTest 2: cd 持久化')
    await tool.execute({ command: 'cd /tmp' })
    const r2 = await tool.execute({ command: 'pwd' })
    console.log('当前目录:', r2.stdout)
    console.log(r2.stdout === '/tmp' ? '✅ 通过' : '❌ 失败')

    // 测试 3: 安全拦截
    console.log('\nTest 3: 安全拦截')
    const r3 = await tool.execute({ command: 'rm -rf /' })
    console.log('被拦截:', r3.stderr)
    console.log(r3.exit_code !== 0 ? '✅ 通过' : '❌ 失败')

    // 测试 4: 超时
    console.log('\nTest 4: 超时')
    const start = Date.now()
    const r4 = await tool.execute({ command: 'sleep 5', timeout: 1000 })
    const elapsed = Date.now() - start
    console.log('耗时:', elapsed, 'ms')
    console.log(elapsed < 2000 && r4.stderr.includes('Timeout') ? '✅ 通过' : '❌ 失败')

    console.log('\n=== 测试完成 ===\n')
  } finally {
    tool.destroy()
  }
}
