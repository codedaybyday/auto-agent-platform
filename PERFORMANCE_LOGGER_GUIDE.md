# 性能监控日志系统指南

## 概述

统一的 **性能监控日志系统**，包含时间戳、相对时间和性能计时功能。支持在主进程、服务端、渲染进程中使用，提供全局的性能分析能力。

### 关键特性

- ✅ **精确时间戳**：`HH:MM:SS.ms` 格式，精确到毫秒
- ✅ **相对时间**：显示从应用启动以来的累计毫秒数 `[+Xms]`
- ✅ **自动计时**：支持 `startTimer()` 和 `endTimer()` 自动计算操作耗时
- ✅ **模块隔离**：每条日志都标记模块名，便于按模块分析
- ✅ **跨进程共享**：通过 `shared-utils` 包，所有进程都使用同一套系统
- ✅ **性能报告**：支持生成汇总报告、CSV 数据导出

## 文件位置

```
packages/shared-utils/src/
├── performance-logger.ts  ← 核心实现
└── index.ts              ← 导出接口

apps/client/src/main/utils/
└── logger.ts             ← 客户端适配（re-export from shared-utils）
```

## 使用方式

### 1. 基本日志

```typescript
import { perfLogger as logger } from '@auto-agent/shared-utils'

// 普通日志
logger.log('MyModule', '开始处理任务')

// 错误日志
logger.error('MyModule', '处理失败', new Error('details'))
```

**输出示例**：
```
[14:25:30.123] [+1450ms] [MyModule] 开始处理任务
[14:25:31.456] [+2683ms] [MyModule] ❌ 处理失败: details
```

### 2. 性能计时

```typescript
// 开始计时
logger.startTimer('downloadFile', 'FileService', '下载配置文件')

// ... 执行操作 ...
const duration = await downloadFile()

// 结束计时
const ms = logger.endTimer('downloadFile', 'FileService')
console.log(`耗时: ${ms}ms`)
```

**输出示例**：
```
[14:25:30.500] [+500ms] [FileService] ⏱️  START: downloadFile (下载配置文件)
[14:25:31.234] [+1234ms] [FileService] ⏱️  END: downloadFile - 734.1ms
```

### 3. 性能指标

```typescript
logger.metric('BrowserUseDOM', 'Elements extracted', 92, 'items')
logger.metric('LLMService', 'Tokens used', 1450, 'tokens')
logger.metric('BrowserManager', 'Page load time', 230.5, 'ms')
```

**输出示例**：
```
[14:25:30.750] [+750ms] [BrowserUseDOM] 📊 Elements extracted: 92.00items
[14:25:30.850] [+850ms] [LLMService] 📊 Tokens used: 1450.00tokens
[14:25:30.950] [+950ms] [BrowserManager] 📊 Page load time: 230.50ms
```

### 4. 分组信息

```typescript
logger.group('BrowserController', 'DOM 分析')
logger.log('BrowserController', '开始分析 DOM 树')
logger.metric('BrowserController', 'DOM 节点数', 523, 'nodes')
```

**输出示例**：
```
[14:25:30.100] [+100ms] [BrowserController] 📍 ========== DOM 分析 ==========
[14:25:30.150] [+150ms] [BrowserController] 开始分析 DOM 树
[14:25:30.200] [+200ms] [BrowserController] 📊 DOM 节点数: 523.00nodes
```

### 5. 摘要统计

```typescript
logger.summary('BrowserUseDOM', 'Snapshot stats', {
  documents: 1,
  axNodes: 280,
  elements: 92,
  processingTime: '234.5ms'
})
```

**输出示例**：
```
[14:25:31.000] [+2000ms] [BrowserUseDOM] 📋 Snapshot stats: {"documents":1,"axNodes":280,"elements":92,"processingTime":"234.5ms"}
```

## 集成示例

### BrowserUseDOM 模块

```typescript
import { perfLogger as logger } from '@auto-agent/shared-utils'

export class BrowserUseDOMService {
  async getInteractiveElements(page: Page): Promise<BrowserUseElement[]> {
    const cdpSession = await page.context().newCDPSession(page)
    
    try {
      // 整体计时
      logger.startTimer('getInteractiveElements', 'BrowserUseDOM', 'DOM快照+AX树')
      
      // 步骤 1：获取 DOM Snapshot
      logger.startTimer('captureSnapshot', 'BrowserUseDOM')
      const snapshot = await cdpSession.send('DOMSnapshot.captureSnapshot', {...})
      logger.endTimer('captureSnapshot', 'BrowserUseDOM')
      logger.log('BrowserUseDOM', `Got ${snapshot.documents?.length} documents`)
      
      // 步骤 2：获取 Accessibility Tree
      logger.startTimer('getFullAXTree', 'BrowserUseDOM')
      const axTree = await cdpSession.send('Accessibility.getFullAXTree')
      logger.endTimer('getFullAXTree', 'BrowserUseDOM')
      logger.log('BrowserUseDOM', `Got ${axTree.nodes?.length} AX nodes`)
      
      // 步骤 3：提取元素
      logger.startTimer('extractInteractiveElements', 'BrowserUseDOM')
      const elements = this.extractInteractiveElements(snapshot, axTree)
      logger.endTimer('extractInteractiveElements', 'BrowserUseDOM')
      logger.metric('BrowserUseDOM', 'Elements extracted', elements.length, 'items')
      
      logger.endTimer('getInteractiveElements', 'BrowserUseDOM')
      return elements
    } catch (error) {
      logger.error('BrowserUseDOM', 'Failed to get interactive elements', error as Error)
      throw error
    } finally {
      await cdpSession.detach()
    }
  }
}
```

## 性能报告

### 生成报告

```typescript
import { perfLogger as logger } from '@auto-agent/shared-utils'

// 执行一系列操作...
logger.log('Module1', '操作1')
logger.log('Module2', '操作2')

// 生成报告
const report = logger.generateReport()
console.log(report)
```

### 报告格式

```
═══════════════════════════════════════════════════════════
           🎯 性能分析报告 (Performance Report)
═══════════════════════════════════════════════════════════

⏱️  总执行时间: 2.34s
📊 总日志条数: 45

📍 按模块统计:
  [BrowserUseDOM] 日志: 12 | ❌ 错误: 0 | ⏱️  总耗时: 1.23s
  [Executor] 日志: 15 | ❌ 错误: 0 | ⏱️  总耗时: 0.78s
  [BrowserManager] 日志: 10 | ❌ 错误: 1 | ⏱️  总耗时: 0.42s

🐢 耗时操作 (>50ms):
  [BrowserUseDOM] END: captureSnapshot - 234.5ms
  [BrowserUseDOM] END: getFullAXTree - 189.3ms
  [Executor] END: executeAction - 145.2ms

📈 时间线:
  [14:25:30.100] [+100ms] ⏱️  [BrowserUseDOM] START: getInteractiveElements (DOM快照+AX树)
  [14:25:30.200] [+200ms] ⏱️  [BrowserUseDOM] START: captureSnapshot
  [14:25:30.434] [+434ms] ⏱️  [BrowserUseDOM] END: captureSnapshot - 234.5ms
  [14:25:30.500] [+500ms] ⏱️  [BrowserUseDOM] START: getFullAXTree
  [14:25:30.689] [+689ms] ⏱️  [BrowserUseDOM] END: getFullAXTree - 189.3ms
  ...

═══════════════════════════════════════════════════════════
```

### 导出 CSV

```typescript
const csv = logger.generateCSV()
// 用于在 Excel、Tableau 等工具中分析

// 格式：
// timestamp,module,type,message,duration_ms,relative_time_ms
// 14:25:30.100,BrowserUseDOM,timer,START: captureSnapshot,,100
// 14:25:30.434,BrowserUseDOM,timer,END: captureSnapshot,234.5,434
```

## 按模块统计

```typescript
const stats = logger.getStatsByModule()

// 输出：
// {
//   'BrowserUseDOM': { count: 12, errors: 0, totalDuration: 1230 },
//   'Executor': { count: 15, errors: 0, totalDuration: 780 },
//   'BrowserManager': { count: 10, errors: 1, totalDuration: 420 }
// }
```

## 耗时操作分析

```typescript
const slowOps = logger.getSlowOperations(50) // 获取耗时 >50ms 的操作

// 输出：
// [
//   { name: 'END: captureSnapshot', module: 'BrowserUseDOM', duration: '234.5ms' },
//   { name: 'END: getFullAXTree', module: 'BrowserUseDOM', duration: '189.3ms' },
//   { name: 'END: executeAction', module: 'Executor', duration: '145.2ms' }
// ]
```

## 控制日志输出

```typescript
// 禁用控制台输出（仅记录日志）
logger.setConsoleEnabled(false)

// 执行操作...
logger.log('Module', 'This will not print to console')

// 获取所有记录的日志
const logs = logger.getLogs()

// 启用控制台输出
logger.setConsoleEnabled(true)
```

## 清空日志

```typescript
// 清空所有日志和计时器，重置相对时间
logger.clear()
```

## 最佳实践

1. **使用有意义的模块名**
   ```typescript
   logger.log('BrowserUseDOM', 'message')    // ✅ 好
   logger.log('b', 'message')                 // ❌ 不好
   ```

2. **嵌套计时**
   ```typescript
   logger.startTimer('parent', 'Module')
   // ... 做一些事情 ...
   
   logger.startTimer('child', 'Module')
   // ... 做嵌套的事情 ...
   logger.endTimer('child', 'Module')
   
   // ... 继续做事情 ...
   logger.endTimer('parent', 'Module')  // 可见总耗时
   ```

3. **在关键位置添加计时**
   ```typescript
   // CDP 调用
   logger.startTimer('cdpCall', 'Browser', 'DOMSnapshot.captureSnapshot')
   const result = await cdpSession.send('DOMSnapshot.captureSnapshot', {...})
   logger.endTimer('cdpCall', 'Browser')
   
   // 网络请求
   logger.startTimer('httpRequest', 'API', 'GET /api/data')
   const data = await fetch(url)
   logger.endTimer('httpRequest', 'API')
   ```

4. **删除调试日志**
   ```typescript
   // ❌ 不要
   logger.log('Debug', `All elements: ${JSON.stringify(elements)}`)
   
   // ✅ 好的
   logger.metric('BrowserUseDOM', 'Elements', elements.length, 'items')
   ```

## 性能分析工作流

### 第 1 步：运行任务并收集日志

```typescript
import { perfLogger as logger } from '@auto-agent/shared-utils'

// 执行任务
await runTask()

// 生成报告
const report = logger.generateReport()
console.log(report)
```

### 第 2 步：识别瓶颈

查看"🐢 耗时操作"部分，找出 >50ms 的操作。

### 第 3 步：深度分析

```typescript
// 获取特定模块的统计
const stats = logger.getStatsByModule()
console.log(`BrowserUseDOM 耗时: ${stats['BrowserUseDOM'].totalDuration}ms`)

// 导出 CSV 用于进一步分析
const csv = logger.generateCSV()
// 保存到文件或导入到 Excel
```

### 第 4 步：优化

根据时间线和统计数据，优化耗时的操作。

## 与之前的"打开百度，搜索大模型"分析对比

使用新日志系统后，输出将清晰显示：

```
[14:25:30.100] [+100ms] [Main] ⏱️  START: navigate
[14:25:30.200] [+200ms] [BrowserUseDOM] ⏱️  START: captureSnapshot
[14:25:30.434] [+434ms] [BrowserUseDOM] ⏱️  END: captureSnapshot - 234.5ms
[14:25:30.500] [+500ms] [BrowserUseDOM] ⏱️  START: getFullAXTree
[14:25:30.689] [+689ms] [BrowserUseDOM] ⏱️  END: getFullAXTree - 189.3ms
[14:25:30.900] [+900ms] [Main] ⏱️  END: navigate - 800.0ms

[14:25:31.000] [+1000ms] [Main] ⏱️  START: type
[14:25:31.150] [+1150ms] [Main] 页面已刷新，重新获取上下文
[14:25:31.200] [+1200ms] [BrowserUseDOM] ⏱️  START: captureSnapshot
[14:25:31.420] [+1420ms] [BrowserUseDOM] ⏱️  END: captureSnapshot - 220.0ms
[14:25:31.500] [+1500ms] [Main] ⏱️  END: type - 500.0ms

... 完整的时间线 ...

═══════════════════════════════════════════════════════════
⏱️  总执行时间: 2.34s
📍 按模块统计:
  [BrowserUseDOM] 日志: 8 | ⏱️  总耗时: 1.23s
  [Main] 日志: 6 | ⏱️  总耗时: 1.30s
🐢 耗时操作 (>50ms):
  [BrowserUseDOM] END: captureSnapshot - 234.5ms
  [BrowserUseDOM] END: getFullAXTree - 189.3ms
  [BrowserUseDOM] END: captureSnapshot - 220.0ms
```

现在可以清楚地看到**瓶颈在 DOM 快照处理**（每次都要 200+ ms）！
