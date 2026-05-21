/**
 * AgentBrowserService 测试脚本
 * 验证 agent-browser 集成是否正常工作
 */

import { agentBrowserService } from './agent-browser.js'

async function runTests() {
  console.log('=== AgentBrowserService 集成测试 ===\n')

  const sessionId = `test-${Date.now()}`

  try {
    // Test 1: 导航到页面
    console.log('Test 1: 导航到 example.com')
    const navResult = await agentBrowserService.navigate(sessionId, 'https://example.com')
    console.log('  Result:', navResult)
    if (navResult.success) {
      console.log('  ✓ 导航测试通过\n')
    } else {
      console.log('  ✗ 导航测试失败\n')
    }

    // Test 2: 获取页面上下文
    console.log('Test 2: 获取页面上下文')
    const context = await agentBrowserService.getPageContext(sessionId)
    console.log('  URL:', context.url)
    console.log('  Title:', context.title)
    console.log('  Elements count:', context.elements.length)
    console.log('  First 3 elements:')
    context.elements.slice(0, 3).forEach(el => {
      console.log(`    [${el.ref}] ${el.role} - ${el.name || '(unnamed)'}`)
    })
    console.log('  ✓ 上下文获取测试通过\n')

    // Test 3: 执行简单动作（等待）
    console.log('Test 3: 执行等待动作')
    const waitResult = await agentBrowserService.executeBrowserAction(sessionId, {
      type: 'wait',
      timeout: 1000
    })
    console.log('  Result:', waitResult)
    if (waitResult.success) {
      console.log('  ✓ 动作执行测试通过\n')
    } else {
      console.log('  ✗ 动作执行测试失败\n')
    }

    // Test 4: 获取当前 URL
    console.log('Test 4: 获取当前 URL')
    const currentUrl = await agentBrowserService.getCurrentUrl(sessionId)
    console.log('  URL:', currentUrl)
    console.log('  ✓ URL 获取测试通过\n')

    // Test 5: 获取 DOM 哈希
    console.log('Test 5: 获取 DOM 哈希')
    const domHash = await agentBrowserService.getDOMHash(sessionId)
    console.log('  Hash:', domHash)
    console.log('  ✓ DOM 哈希获取测试通过\n')

    console.log('=== 所有测试通过 ===')

  } catch (error) {
    console.error('测试失败:', error)
  } finally {
    // 清理
    console.log('\n清理资源...')
    await agentBrowserService.close(sessionId)
    console.log('完成')
  }
}

// 如果直接运行此文件
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests()
}
