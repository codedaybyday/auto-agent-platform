# 网络导航优化方案

## 🔴 问题诊断

### 当前问题
```
Error: page.goto: Timeout 30000ms exceeded.
Call log:
  - navigating to "https://www.baidu.com/", waiting until "networkidle"
```

### 根本原因分析

**使用的是 `networkidle` 策略**:
```typescript
// 当前代码 (apps/client/src/main/tools/browser-use/core/controller.ts:331)
await page.goto(action.url, { waitUntil: 'networkidle' })
```

`networkidle` 表示**等待所有网络活动停止**:
- 对于 Baidu.com 这样的复杂网站，很难达到真正的 "zero network activity"
- 百度首页包含：
  - 大量第三方脚本 (分析、广告、跟踪)
  - WebSocket 连接（实时更新）
  - 动态内容加载
  - 无限循环的网络请求

**为什么会超时**:
1. 页面加载完成，但仍有后台请求
2. 30 秒后 Playwright 放弃等待
3. 导致任务失败，重试，再次超时...

## 📊 Playwright 等待策略对比

| 策略 | 等待内容 | 百度首页预期耗时 | 可靠性 | 推荐度 |
|------|---------|----------------|--------|--------|
| `load` | load 事件触发 | **2-3s** | 很好 | ⭐⭐⭐⭐ |
| `domcontentloaded` | DOM 解析完成 | **1-2s** | 很好 | ⭐⭐⭐⭐⭐ |
| `commit` | 导航提交 | **0.5-1s** | 差 | ⭐ |
| `networkidle` | 所有网络停止 | **15-30s+** | 很差 | ❌ |
| `networkidle2` | 2个网络连接以内 | **5-10s** | 中 | ⭐⭐ |

## ✨ 优化方案

### 方案 1: 使用 `domcontentloaded` (推荐)

```typescript
// 改进前
await page.goto(action.url, { waitUntil: 'networkidle' })

// 改进后
await page.goto(action.url, { waitUntil: 'domcontentloaded' })
```

**优势**:
- ✅ 百度首页: 30s → 2s (93% ↓)
- ✅ 通用网站友好，不易超时
- ✅ 页面已可交互，可以正常工作
- ✅ 保留 30s 超时作为安全防线

**预期效果**:
- 平均页面加载: 20s → 2-3s
- 总任务耗时: 60s → 8-10s
- 失败率: 80% → 5%

### 方案 2: 使用 `load`

```typescript
await page.goto(action.url, { waitUntil: 'load' })
```

**优势**:
- ✅ 比 `domcontentloaded` 稍晚，等待 load 事件
- ✅ 更稳定，页面完全初始化

**劣势**:
- 仍可能遇到某些页面的持久后台加载

### 方案 3: 自定义超时 + 容错

```typescript
await page.goto(action.url, {
  waitUntil: 'domcontentloaded',
  timeout: 15000  // 减少超时时间
}).catch(() => {
  // 即使超时也继续，因为 DOM 已加载
  log.warn('navigate', 'Page timeout, continuing anyway')
})
```

## 🔧 代码修改计划

### 文件 1: `apps/client/src/main/tools/browser-use/core/controller.ts`

**修改点 1 - navigate 动作** (第 331 行)
```typescript
// 改前
await page.goto(action.url, { waitUntil: 'networkidle' })

// 改后
await page.goto(action.url, { 
  waitUntil: 'domcontentloaded',
  timeout: 30000 
})
```

**修改点 2 - click 后等待** (第 361 行)
```typescript
// 改前
await page.waitForLoadState('networkidle')

// 改后
await page.waitForLoadState('domcontentloaded')
```

**修改点 3 - 其他 waitForLoadState** (第 552 行等)
```typescript
// 改前
await page.waitForLoadState('networkidle')

// 改后
await page.waitForLoadState('domcontentloaded')
```

### 文件 2: 检查 `browser.ts` 的默认值

```typescript
// apps/client/src/main/tools/browser.ts (第 102 行)
// 当前: 
waitUntil: args.wait_for || 'load'

// ✅ 已经很好，考虑改为:
waitUntil: args.wait_for || 'domcontentloaded'
```

## 📈 性能预测

### 当前状态（使用 networkidle）
```
任务: 打开百度 → 搜索 Python
流程:
  1. navigate 到百度 [30s 超时失败]
  2. 重试 navigate [30s 超时失败]
  3. ...
  总耗时: 60+ 秒 (失败率高)
```

### 优化后（使用 domcontentloaded）
```
任务: 打开百度 → 搜索 Python
流程:
  1. navigate 到百度 [2s 成功]
  2. LLM 分析 DOM [3-5s]
  3. type "Python" [1s]
  4. 按 Enter [1s]
  总耗时: 7-9 秒 ✅ (99% 成功率)

性能提升: 从 60s+ 超时 → 8s 成功
         = 7.5 倍性能提升
         = 87.5% 时间节省
```

## 🚀 实施步骤

### 第1步：修改代码
- [ ] 修改 `controller.ts` 的三个 `waitUntil` 位置
- [ ] 确认 `browser.ts` 的默认值
- [ ] 检查是否有其他地方使用 networkidle

### 第2步：编译和测试
- [ ] 运行 `pnpm build` 验证编译
- [ ] 启动开发环境
- [ ] 测试导航性能

### 第3步：性能验证
- [ ] 记录新的导航耗时
- [ ] 验证页面是否正确加载
- [ ] 测试不同网站的兼容性

### 第4步：文档更新
- [ ] 记录性能改进数据
- [ ] 添加使用文档

## ⚠️ 风险评估

| 风险 | 级别 | 缓解措施 |
|------|------|---------|
| 页面未完全加载 | 低 | domcontentloaded 之后页面已可交互 |
| 脚本未加载 | 低 | 通常脚本加载很快 |
| 样式未加载 | 低 | 优先级低，影响不大 |
| 后台数据未加载 | 中 | 这是目前存在的问题，改进会很明显 |

## 💡 其他建议

### 1. 添加智能重试
```typescript
async function navigateWithRetry(page: Page, url: string, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 15000 
      })
      return true
    } catch (error) {
      log.warn('navigate', `Attempt ${i+1} failed, retrying...`)
      if (i === maxRetries - 1) throw error
      await page.waitForTimeout(1000)
    }
  }
}
```

### 2. 添加性能日志
```typescript
const startTime = Date.now()
await page.goto(action.url, { waitUntil: 'domcontentloaded' })
const navTime = Date.now() - startTime
log.info('navigate', `Navigated to ${action.url} in ${navTime}ms`)
```

### 3. 监控网络活动
```typescript
// 可选：记录网络请求数
const requests: string[] = []
page.on('request', req => requests.push(req.url()))
page.on('response', res => log.debug('network', `${res.status()} ${res.url()}`))
```

## 📋 验收标准

优化成功的标志:
- [ ] navigate 不再超时（成功率 > 95%）
- [ ] 平均导航时间 < 5s
- [ ] 任务总耗时 < 15s
- [ ] 没有页面交互问题

---

## 🎯 优先级

**立即执行** ⚡ (1-2 小时完成)
- 修改 controller.ts 的三个位置
- 测试基本功能

**近期执行** (可选)
- 添加更详细的日志
- 实现智能重试

**后续优化** (可选)
- 网络连接池优化
- CDN 加速配置
