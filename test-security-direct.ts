/**
 * 直接测试安全层（绕过模型）
 * 验证安全逻辑本身是否正确
 */

import { BashSecurity } from './apps/client/src/main/tools/bash/security.js'

async function runSecurityTests() {
  const security = new BashSecurity()
  
  console.log('=== 安全层直接测试 ===\n')
  
  // 测试 1: 黑名单拦截
  console.log('测试 1: 黑名单命令')
  const test1 = await security.validate('rm -rf /')
  console.log(`  rm -rf /: ${test1.safe ? '❌ 应该拦截但未拦截' : '✅ 已拦截'} (${test1.reason})`)
  
  // 测试 2: 正常命令
  console.log('\n测试 2: 正常命令')
  const test2 = await security.validate('ls -la')
  console.log(`  ls -la: ${test2.safe ? '✅ 通过' : '❌ 误判'} (risk: ${test2.riskLevel})`)
  
  // 测试 3: 风险等级评估
  console.log('\n测试 3: 风险等级')
  const test3a = await security.validate('echo "hello"')
  const test3b = await security.validate('sudo ls')
  const test3c = await security.validate('rm -rf node_modules')
  console.log(`  echo: ${test3a.riskLevel} (预期: low)`)
  console.log(`  sudo: ${test3b.riskLevel} (预期: medium)`)
  console.log(`  rm -rf: ${test3c.riskLevel} (预期: high)`)
  
  // 测试 4: 路径限制
  console.log('\n测试 4: 路径限制')
  const restrictedSecurity = new BashSecurity({
    allowedPaths: ['/home/user/project']
  })
  const test4a = await restrictedSecurity.validate('cd /home/user/project')
  const test4b = await restrictedSecurity.validate('cat /etc/passwd')
  console.log(`  允许路径: ${test4a.safe ? '✅' : '❌'}`)
  console.log(`  禁止路径: ${test4b.safe ? '❌ 应该拦截' : '✅ 已拦截'}`)
  
  console.log('\n=== 测试完成 ===')
}

runSecurityTests()
