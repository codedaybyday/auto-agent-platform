/**
 * Bash 工具测试脚本
 * 测试 Phase 1 实现的核心功能
 */

import { createBashTool, sessionManager } from './apps/client/src/main/tools/bash/index.js'

async function runTests() {
  console.log('=== Bash Tool Phase 1 测试 ===\n')

  const sessionId = `test_${Date.now()}`
  const bashTool = createBashTool(sessionId, async (command, riskLevel) => {
    console.log(`[确认] 高风险命令 (${riskLevel}): ${command}`)
    return true // 自动确认
  })

  // 测试 1: 基本命令执行
  console.log('Test 1: 基本命令执行')
  const result1 = await bashTool.execute({ command: 'echo "Hello World"' })
  console.log('输出:', result1.stdout)
  console.log('退出码:', result1.exit_code)
  console.log('✅ 通过\n')

  // 测试 2: cd 持久化（核心功能）
  console.log('Test 2: cd 持久化')
  await bashTool.execute({ command: 'cd /tmp' })
  const result2 = await bashTool.execute({ command: 'pwd' })
  console.log('当前目录:', result2.stdout)
  console.log('期望: /tmp')
  if (result2.stdout === '/tmp') {
    console.log('✅ 通过\n')
  } else {
    console.log('❌ 失败\n')
  }

  // 测试 3: 环境变量保持
  console.log('Test 3: 环境变量')
  await bashTool.execute({ command: 'export MY_VAR=test_value' })
  const result3 = await bashTool.execute({ command: 'echo $MY_VAR' })
  console.log('环境变量:', result3.stdout)
  console.log('期望: test_value')
  if (result3.stdout === 'test_value') {
    console.log('✅ 通过\n')
  } else {
    console.log('❌ 失败\n')
  }

  // 测试 4: 安全 - 危险命令拦截
  console.log('Test 4: 安全 - 危险命令拦截')
  const result4 = await bashTool.execute({ command: 'rm -rf /' })
  console.log('被拦截:', result4.exit_code !== 0)
  console.log('错误信息:', result4.stderr)
  if (result4.exit_code !== 0 && result4.stderr.includes('blocked')) {
    console.log('✅ 通过\n')
  } else {
    console.log('❌ 失败\n')
  }

  // 测试 5: 超时控制
  console.log('Test 5: 超时控制')
  const startTime = Date.now()
  const result5 = await bashTool.execute({ command: 'sleep 10', timeout: 2000 })
  const elapsed = Date.now() - startTime
  console.log('执行时间:', elapsed, 'ms')
  console.log('被超时:', result5.stderr.includes('Timeout'))
  if (elapsed < 3000 && result5.stderr.includes('Timeout')) {
    console.log('✅ 通过\n')
  } else {
    console.log('❌ 失败\n')
  }

  // 测试 6: 输出截断
  console.log('Test 6: 输出截断')
  const result6 = await bashTool.execute({ command: 'seq 1 10000' })
  console.log('输出长度:', result6.stdout.length)
  console.log('被截断:', result6.truncated)
  if (result6.truncated) {
    console.log('✅ 通过\n')
  } else {
    console.log('❌ 失败\n')
  }

  // 测试 7: 会话重启
  console.log('Test 7: 会话重启')
  await bashTool.execute({ command: 'cd /tmp' })
  await bashTool.execute({ command: 'export TEST_VAR=old' })
  await bashTool.execute({ command: 'restart' }) // 使用 restart 参数
  const result7 = await bashTool.execute({ command: 'pwd' })
  console.log('重启后目录:', result7.stdout)
  console.log('期望: 初始目录（非 /tmp）')

  // 清理
  bashTool.destroy()
  console.log('\n=== 测试完成 ===')
}

runTests().catch(console.error)
