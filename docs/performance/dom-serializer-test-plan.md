# DOM 序列化器测试计划

## 概述

本文档详细说明如何验证 DOM 序列化器的改进是否达到预期目标。

## 测试环境

- Node.js: v18+
- Playwright: 最新版本
- Browser: Chromium

## 测试场景

### 1. 基础功能测试

#### 1.1 简单页面序列化
```typescript
// test/dom-serializer.test.ts
import { DOMSerializer } from '@/tools/browser-use/dom/dom-serializer'

test('should serialize simple page', async () => {
  const serializer = new DOMSerializer()
  const result = await serializer.serialize(page)
  
  // 验证基本结构
  expect(result).toHaveProperty('title')
  expect(result).toHaveProperty('url')
  expect(result).toHaveProperty('elements')
  expect(result).toHaveProperty('stats')
  expect(result).toHaveProperty('timings')
  
  // 验证元素数量合理
  expect(result.elements.length).toBeLessThanOrEqual(200)
  expect(result.elements.length).toBeGreaterThan(0)
})
```

#### 1.2 交互元素检测
```typescript
test('should detect interactive elements', async () => {
  const serializer = new DOMSerializer()
  const result = await serializer.serialize(page)
  
  // 验证检测到按钮、链接等
  const hasButtons = result.elements.some(el => el.tag === 'button')
  const hasLinks = result.elements.some(el => el.tag === 'a')
  const hasInputs = result.elements.some(el => el.tag === 'input')
  
  expect(hasButtons || hasLinks || hasInputs).toBe(true)
})
```

#### 1.3 性能指标验证
```typescript
test('should include timing information', async () => {
  const serializer = new DOMSerializer()
  const result = await serializer.serialize(page)
  
  expect(result.timings).toBeDefined()
  expect(result.timings?.totalMs).toBeGreaterThan(0)
  expect(result.timings?.totalMs).toBeLessThan(5000) // 应该在 5 秒内完成
})
```

### 2. 性能基准测试

#### 2.1 对比百度首页

```typescript
test('benchmark on baidu.com', async () => {
  const serializer = new DOMSerializer()
  const result = await serializer.serialize(page)
  
  console.log('Baidu.com 序列化结果:')
  console.log(`- 总节点数: ${result.stats.totalNodes}`)
  console.log(`- 最终元素数: ${result.stats.finalElements}`)
  console.log(`- 过滤率: ${(1 - result.stats.finalElements / result.stats.totalNodes).toFixed(2) * 100}%`)
  console.log(`- JSON 体积: ${result.stats.sizeKB} KB`)
  console.log(`- 总耗时: ${result.timings?.totalMs} ms`)
  console.log(`  - 建树: ${result.timings?.buildTreeMs} ms`)
  console.log(`  - 优化: ${result.timings?.optimizeMs} ms`)
  console.log(`  - 提取: ${result.timings?.extractMs} ms`)
  console.log(`  - 去重: ${result.timings?.dedupeMs} ms`)
  
  // 验证性能目标
  expect(result.stats.finalElements).toBeLessThanOrEqual(250)
  expect(result.stats.sizeKB).toBeLessThan(100)
  expect(result.timings?.totalMs).toBeLessThan(3000)
})
```

#### 2.2 对比 YouTube 首页

```typescript
test('benchmark on youtube.com', async () => {
  // 更复杂的页面，测试大规模 DOM 处理能力
  const serializer = new DOMSerializer()
  const start = performance.now()
  const result = await serializer.serialize(page)
  const elapsed = performance.now() - start
  
  console.log('YouTube 序列化结果:')
  console.log(`- 总耗时: ${elapsed} ms`)
  console.log(`- 最终元素: ${result.stats.finalElements}`)
  
  // YouTube 可能有大量动态内容，但仍应在合理时间内完成
  expect(elapsed).toBeLessThan(5000)
})
```

### 3. 边界情况测试

#### 3.1 空页面
```typescript
test('should handle empty page', async () => {
  await page.goto('about:blank')
  const serializer = new DOMSerializer()
  const result = await serializer.serialize(page)
  
  expect(result.elements.length).toBe(0)
  expect(result.timings?.totalMs).toBeLessThan(500)
})
```

#### 3.2 深层嵌套结构
```typescript
test('should handle deeply nested DOM', async () => {
  // 创建深层嵌套的 DOM
  await page.evaluate(() => {
    let el = document.body
    for (let i = 0; i < 100; i++) {
      const div = document.createElement('div')
      el.appendChild(div)
      el = div
    }
  })
  
  const serializer = new DOMSerializer()
  const result = await serializer.serialize(page)
  
  // 应该能处理，不会崩溃
  expect(result.elements).toBeDefined()
})
```

#### 3.3 大量重复元素
```typescript
test('should deduplicate overlapping elements', async () => {
  // 创建许多重叠的元素
  await page.evaluate(() => {
    const container = document.body
    for (let i = 0; i < 100; i++) {
      const btn = document.createElement('button')
      btn.textContent = `Button ${i}`
      btn.style.position = 'absolute'
      btn.style.top = '0'
      btn.style.left = '0'
      container.appendChild(btn)
    }
  })
  
  const serializer = new DOMSerializer()
  const result = await serializer.serialize(page)
  
  // 应该大幅减少元素数量
  expect(result.stats.finalElements).toBeLessThan(50)
})
```

### 4. 功能验证测试

#### 4.1 验证不会漏掉重要元素
```typescript
test('should not miss important interactive elements', async () => {
  await page.setContent(`
    <html>
      <body>
        <a href="/">Home</a>
        <button id="submit">Submit</button>
        <input type="text" placeholder="Search" />
        <select>
          <option>Option 1</option>
          <option>Option 2</option>
        </select>
      </body>
    </html>
  `)
  
  const serializer = new DOMSerializer()
  const result = await serializer.serialize(page)
  
  expect(result.elements).toContainEqual(expect.objectContaining({ tag: 'a' }))
  expect(result.elements).toContainEqual(expect.objectContaining({ tag: 'button' }))
  expect(result.elements).toContainEqual(expect.objectContaining({ tag: 'input' }))
  expect(result.elements).toContainEqual(expect.objectContaining({ tag: 'select' }))
})
```

#### 4.2 验证元素信息完整性
```typescript
test('should include element information', async () => {
  const serializer = new DOMSerializer()
  const result = await serializer.serialize(page)
  
  const element = result.elements[0]
  expect(element).toHaveProperty('id')
  expect(element).toHaveProperty('tag')
  expect(element).toHaveProperty('bbox')
  expect(element).toHaveProperty('center')
})
```

## 性能指标目标

| 指标 | 目标值 | 说明 |
|------|------|------|
| 百度首页元素数 | < 250 | 相比改进前 400+ 减少 40%+ |
| 百度首页 JSON 体积 | < 100 KB | 相比改进前 150+ KB 减少 35%+ |
| 百度首页序列化耗时 | < 3000 ms | 总耗时 |
| YouTube 首页序列化耗时 | < 5000 ms | 复杂页面容忍度 |
| 最大元素数量 | 200 | 硬性限制 |

## 对比基准

为了验证改进效果，应与之前的实现对比：

```typescript
// 旧实现（保存为对比版本）
import { DOMSerializer as OldDOMSerializer } from '@/tools/browser-use/dom/dom-serializer-old'

// 新实现
import { DOMSerializer as NewDOMSerializer } from '@/tools/browser-use/dom/dom-serializer'

test('compare implementations on various pages', async () => {
  const pages = [
    'https://www.baidu.com',
    'https://www.youtube.com',
    'https://www.github.com'
  ]
  
  const results: Record<string, any> = {}
  
  for (const url of pages) {
    await page.goto(url)
    
    const oldSerializer = new OldDOMSerializer()
    const newSerializer = new NewDOMSerializer()
    
    const oldResult = await oldSerializer.serialize(page)
    const newResult = await newSerializer.serialize(page)
    
    results[url] = {
      old: {
        elements: oldResult.stats.finalElements,
        sizeKB: oldResult.stats.sizeKB,
        totalMs: oldResult.timings?.totalMs || 'N/A'
      },
      new: {
        elements: newResult.stats.finalElements,
        sizeKB: newResult.stats.sizeKB,
        totalMs: newResult.timings?.totalMs || 'N/A'
      },
      improvement: {
        elementsReduction: `${(1 - newResult.stats.finalElements / oldResult.stats.finalElements).toFixed(2) * 100}%`,
        sizeReduction: `${(1 - newResult.stats.sizeKB / oldResult.stats.sizeKB).toFixed(2) * 100}%`,
        timeImprovement: `${(1 - (newResult.timings?.totalMs || 0) / (oldResult.timings?.totalMs || 1)).toFixed(2) * 100}%`
      }
    }
  }
  
  console.table(results)
})
```

## 测试执行计划

### 第一阶段：单元测试
- [ ] 基础功能测试 (1.1 - 1.3)
- [ ] 边界情况测试 (3.1 - 3.3)
- [ ] 功能验证测试 (4.1 - 4.2)

### 第二阶段：性能基准测试
- [ ] 百度首页基准测试
- [ ] YouTube 首页基准测试
- [ ] 其他常见网站测试

### 第三阶段：集成测试
- [ ] 在 agent 循环中测试
- [ ] 验证与 LLM 交互正常
- [ ] 监控日志输出

## 预期结果

✅ **通过所有功能测试**
- 不会漏掉重要元素
- 不会崩溃或超时

✅ **性能改进 50-60%**
- 元素数量减少
- JSON 体积减少
- 序列化耗时减少

✅ **向后兼容**
- 现有代码无需修改
- 接口保持不变

## 监控指标

部署后应持续监控：

1. **DOM 序列化耗时** - 保持在 3000ms 以内
2. **提交给 LLM 的元素数** - 保持在 200 左右
3. **LLM 响应时间** - 应有明显改进
4. **整体任务耗时** - 应减少 30-50%

## 问题排查

如果出现问题，检查清单：

- [ ] 是否有元素被错误过滤？
- [ ] 是否有性能回退？
- [ ] 是否有类型错误？
- [ ] 日志输出是否正常？

## 参考资源

- 官方 browser-use: https://github.com/browser-use/browser-use
- 改进文档: `docs/dom-serializer-optimization.md`
- 变更记录: `docs/dom-serializer-changes.md`
