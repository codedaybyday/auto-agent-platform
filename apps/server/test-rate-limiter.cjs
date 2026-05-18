/**
 * Rate Limiter 测试脚本 (Node.js)
 * 使用方法: node test-rate-limiter.js [server_url]
 */

const http = require('http');

const SERVER_URL = process.argv[2] || 'http://localhost:3000';
const WS_URL = SERVER_URL.replace(/^http/, 'ws');

console.log('======================================');
console.log('Rate Limiter 测试脚本');
console.log('Server:', SERVER_URL);
console.log('======================================\n');

// 颜色
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const NC = '\x1b[0m';

// 辅助函数
function logInfo(msg) { console.log(`${GREEN}[INFO]${NC} ${msg}`); }
function logError(msg) { console.log(`${RED}[ERROR]${NC} ${msg}`); }
function logWarn(msg) { console.log(`${YELLOW}[WARN]${NC} ${msg}`); }

// HTTP 请求辅助函数
function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SERVER_URL);
    const req = http.request(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token',
        ...options.headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

// 测试 1: 健康检查
async function testHealth() {
  console.log('\n--------------------------------------');
  logInfo('测试 1: 健康检查接口');
  console.log('--------------------------------------');

  try {
    const res = await request('/health');
    if (res.data?.stats?.rateLimit) {
      logInfo('✓ 健康检查返回限流统计');
      console.log('限流统计:', JSON.stringify(res.data.stats.rateLimit, null, 2));
      return true;
    } else {
      logError('✗ 健康检查未返回限流统计');
      return false;
    }
  } catch (err) {
    logError('请求失败: ' + err.message);
    return false;
  }
}

// 测试 2: 快速请求触发限流
async function testRateLimitBlocking() {
  console.log('\n--------------------------------------');
  logInfo('测试 2: 快速请求触发限流');
  console.log('--------------------------------------');

  const userId = `test-user-${Date.now()}`;
  let blocked = false;

  logInfo('发送 30 个快速请求...');

  for (let i = 0; i < 30; i++) {
    try {
      const res = await request('/api/sessions', {
        method: 'POST',
        body: { userId, title: `Test ${i}` }
      });

      if (res.status === 429 || (res.data?.error?.includes('频繁'))) {
        logWarn(`请求 ${i} 被限流: ${res.data?.error || 'Too Many Requests'}`);
        blocked = true;
        break;
      }
    } catch (err) {
      logError(`请求 ${i} 错误: ${err.message}`);
    }
  }

  if (blocked) {
    logInfo('✓ 限流正确触发');
    return true;
  } else {
    logWarn('! 未触发限流（可能配置较宽松或服务器未运行）');
    return false;
  }
}

// 测试 3: 限流恢复
async function testRateLimitRecovery() {
  console.log('\n--------------------------------------');
  logInfo('测试 3: 限流恢复');
  console.log('--------------------------------------');

  const userId = `recovery-test-${Date.now()}`;

  // 先触发限流
  logInfo('触发限流...');
  for (let i = 0; i < 30; i++) {
    await request('/api/sessions', {
      method: 'POST',
      body: { userId, title: `Test ${i}` }
    });
  }

  logInfo('等待 4 秒后重试...');
  await new Promise(r => setTimeout(r, 4000));

  try {
    const res = await request('/api/sessions', {
      method: 'POST',
      body: { userId, title: 'Recovery test' }
    });

    if (res.data?.success) {
      logInfo('✓ 限流恢复后请求成功');
      return true;
    } else {
      logWarn('! 限流可能仍在生效');
      return false;
    }
  } catch (err) {
    logError('恢复测试失败: ' + err.message);
    return false;
  }
}

// 测试 4: 并发压力测试
async function testConcurrency() {
  console.log('\n--------------------------------------');
  logInfo('测试 4: 并发压力测试 (20 并发)');
  console.log('--------------------------------------');

  const userId = `concurrent-test-${Date.now()}`;
  const promises = [];
  let success = 0;
  let blocked = 0;
  let error = 0;

  const startTime = Date.now();

  for (let i = 0; i < 20; i++) {
    promises.push(
      request('/api/sessions', {
        method: 'POST',
        body: { userId, title: `Concurrent ${i}` }
      }).then(res => {
        if (res.data?.success) success++;
        else if (res.status === 429 || res.data?.error?.includes('频繁')) blocked++;
        else error++;
      }).catch(() => error++)
    );
  }

  await Promise.all(promises);

  const duration = Date.now() - startTime;

  logInfo(`压力测试结果:`);
  console.log(`  成功: ${success}`);
  console.log(`  限流: ${blocked}`);
  console.log(`  错误: ${error}`);
  console.log(`  耗时: ${duration}ms`);

  return blocked > 0; // 有触发限流即算测试通过
}

// 主函数
async function main() {
  console.log('按任意键开始测试...');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', async () => {
    process.stdin.setRawMode(false);
    process.stdin.pause();

    const results = [];

    results.push(['健康检查', await testHealth()]);
    results.push(['限流触发', await testRateLimitBlocking()]);
    results.push(['限流恢复', await testRateLimitRecovery()]);
    results.push(['并发压力', await testConcurrency()]);

    console.log('\n======================================');
    console.log('测试完成!');
    console.log('======================================');
    results.forEach(([name, passed]) => {
      const icon = passed ? '✓' : '✗';
      const color = passed ? GREEN : RED;
      console.log(`${color}${icon}${NC} ${name}`);
    });

    const passed = results.filter(r => r[1]).length;
    console.log(`\n总计: ${passed}/${results.length} 通过`);

    process.exit(0);
  });
}

// 检查服务器
async function checkServer() {
  try {
    const res = await request('/health');
    if (res.status === 200) {
      logInfo('服务器连接正常');
      return true;
    }
  } catch (err) {
    logError(`无法连接到服务器: ${err.message}`);
    logInfo('请先启动服务器: cd apps/server && npm run dev');
    return false;
  }
}

// 运行
checkServer().then(ok => {
  if (ok) main();
  else process.exit(1);
});
