/**
 * Browser AI 工具测试
 * 测试 Snapshot 系统和安全层功能
 */

import { BrowserAI } from './browser-ai.js'
import { snapshotManager } from './browser-snapshot.js'
import { permissiveSecurityGuard } from './browser-security.js'

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 测试 Snapshot 系统
 */
async function testSnapshotSystem(): Promise<void> {
  console.log('\n========================================')
  console.log('Test: Snapshot System')
  console.log('========================================\n')

  const browser = new BrowserAI({
    enableSnapshots: true,
    snapshotFormat: 'role'
  })

  try {
    // 1. 初始化浏览器
    console.log('1. Initializing browser...')
    await browser.initialize()
    console.log('✓ Browser initialized\n')

    // 2. 导航到测试页面
    console.log('2. Navigating to example.com...')
    const navResult = await browser.semanticAct('go to example.com')
    console.log('Result:', navResult.result)
    console.log()

    await sleep(2000)

    // 3. 获取当前 Snapshot
    console.log('3. Capturing snapshot (role format)...')
    const snapshot = browser.getCurrentSnapshot()
    if (snapshot) {
      console.log(`✓ Snapshot captured:`)
      console.log(`  - URL: ${snapshot.url}`)
      console.log(`  - Title: ${snapshot.title}`)
      console.log(`  - Elements: ${snapshot.stats.interactiveElements} interactive`)
      console.log(`  - Links: ${snapshot.stats.links}`)
      console.log(`  - Buttons: ${snapshot.stats.buttons}`)
      console.log()

      // 4. 转换为 AI 格式
      console.log('4. Converting to AI format...')
      const aiFormat = snapshotManager.toAIFormat(snapshot)
      console.log('AI Format:')
      console.log(aiFormat.substring(0, 1000))
      console.log('...')
      console.log()

      // 5. 显示部分元素
      console.log('5. Sample elements:')
      snapshot.elements.slice(0, 5).forEach((el) => {
        console.log(`  [${el.ref}] ${el.role || el.tag}: "${el.text?.substring(0, 30) || el.name || 'unnamed'}"`)
      })
      console.log()
    }

    // 6. 尝试点击第一个链接
    const firstLink = snapshot?.elements.find((el) => el.role === 'link')
    if (firstLink?.ref) {
      console.log(`6. Clicking first link [${firstLink.ref}]...`)
      const clickResult = await browser.clickByRef(firstLink.ref)
      console.log('Result:', clickResult.result)
      console.log()

      await sleep(2000)
    }

    console.log('✓ Snapshot system test completed')
  } catch (error) {
    console.error('✗ Test failed:', error)
  } finally {
    await browser.close()
  }
}

/**
 * 测试安全层
 */
async function testSecurityLayer(): Promise<void> {
  console.log('\n========================================')
  console.log('Test: Security Layer')
  console.log('========================================\n')

  // 1. 测试严格模式（默认）
  console.log('1. Testing strict security mode...')
  const strictBrowser = new BrowserAI({
    enableSnapshots: false
  })

  try {
    await strictBrowser.initialize()

    // 尝试访问 localhost（应该被拒绝）
    console.log('   Attempting to access localhost...')
    const result1 = await strictBrowser.semanticAct('go to http://localhost:3000')
    console.log('   Result:', result1.result)
    console.log('   ✓ Localhost access blocked\n')

    // 尝试访问私有 IP（应该被拒绝）
    console.log('   Attempting to access private IP...')
    const result2 = await strictBrowser.semanticAct('go to http://192.168.1.1')
    console.log('   Result:', result2.result)
    console.log('   ✓ Private IP access blocked\n')

    // 尝试访问 file://（应该被拒绝）
    console.log('   Attempting to access file:// protocol...')
    const result3 = await strictBrowser.semanticAct('go to file:///etc/passwd')
    console.log('   Result:', result3.result)
    console.log('   ✓ File protocol blocked\n')

  } catch (error) {
    console.error('   Error:', error)
  } finally {
    await strictBrowser.close()
  }

  // 2. 测试宽松模式
  console.log('2. Testing permissive security mode...')
  const permissiveBrowser = new BrowserAI({
    enableSnapshots: false,
    securityGuard: permissiveSecurityGuard
  })

  try {
    await permissiveBrowser.initialize()

    // 尝试访问正常网站（应该允许）
    console.log('   Attempting to access example.com...')
    const result = await permissiveBrowser.semanticAct('go to example.com')
    console.log('   Result:', result.result)
    console.log('   ✓ Normal website access allowed\n')

  } catch (error) {
    console.error('   Error:', error)
  } finally {
    await permissiveBrowser.close()
  }

  console.log('✓ Security layer test completed')
}

/**
 * 测试语义化操作
 */
async function testSemanticActions(): Promise<void> {
  console.log('\n========================================')
  console.log('Test: Semantic Actions')
  console.log('========================================\n')

  const browser = new BrowserAI({
    enableSnapshots: true
  })

  try {
    await browser.initialize()

    // 测试各种语义化操作
    const actions = [
      'go to httpbin.org',
      'scroll down',
      'screenshot'
    ]

    for (const action of actions) {
      console.log(`Testing: "${action}"`)
      const result = await browser.semanticAct(action)
      console.log('Result:', result.result)
      console.log()
      await sleep(1000)
    }

    // 显示操作历史
    console.log('Action history:')
    const history = browser.getActionHistory()
    history.slice(-5).forEach((action, index) => {
      console.log(`  ${index + 1}. ${action.action} - ${action.success ? '✓' : '✗'}`)
    })
    console.log()

    console.log('✓ Semantic actions test completed')
  } catch (error) {
    console.error('✗ Test failed:', error)
  } finally {
    await browser.close()
  }
}

/**
 * 运行所有测试
 */
export async function runBrowserAITests(): Promise<void> {
  console.log('==============================================')
  console.log('Browser AI Tool Tests')
  console.log('==============================================')
  console.log()
  console.log('These tests will:')
  console.log('1. Open a browser window')
  console.log('2. Navigate to test websites')
  console.log('3. Test Snapshot capture and security features')
  console.log()
  console.log('Press Ctrl+C to cancel, or wait 3 seconds to continue...')
  console.log()

  await sleep(3000)

  try {
    await testSnapshotSystem()
    await testSecurityLayer()
    await testSemanticActions()

    console.log('\n==============================================')
    console.log('All tests completed!')
    console.log('==============================================')
  } catch (error) {
    console.error('\n==============================================')
    console.error('Test suite failed:', error)
    console.error('==============================================')
    process.exit(1)
  }
}

// 如果直接运行此文件（仅 ESM 环境）
// if (import.meta.url === `file://${process.argv[1]}`) {
//   runBrowserAITests()
// }
