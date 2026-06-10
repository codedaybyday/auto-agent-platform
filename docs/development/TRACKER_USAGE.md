# 埋点工具使用指南

## 快速开始

### 1. 基础日志（替代 console.log）

```typescript
import { log } from '@auto-agent/shared-utils'

// 普通日志
log.info('BrowserManager', 'Chrome 启动中...')
// 输出: [14:32:46.456] [BrowserManager] Chrome 启动中...

// 错误日志
log.error('Controller', 'Failed to get DOM', error)
// 输出: [14:32:47.123] [Controller] ❌ Failed to get DOM: TypeError...

// 警告日志
log.warn('Session', 'Session timeout', { timeout: 5000 })
// 输出: [14:32:48.789] [Session] ⚠️ Session timeout { timeout: 5000 }

// 成功日志
log.success('BrowserManager', 'Chrome connected successfully')
// 输出: [14:32:49.012] [BrowserManager] ✅ Chrome connected successfully

// 调试日志
log.debug('Controller', 'DOM 快照数据', { nodes: 1024, links: 234 })
// 输出: [14:32:49.234] [Controller] 🔍 DOM 快照数据 { "nodes": 1024, "links": 234 }
```

### 2. 性能计时

```typescript
import { log, timer } from '@auto-agent/shared-utils'

// 方式 1: 手动计时
const startTime = performance.now()
await cdp.send('DOMSnapshot.captureSnapshot', {...})
const duration = performance.now() - startTime
log.perf('BrowserUseDOM', 'captureSnapshot', duration)
// 输出: [14:32:50.456] [BrowserUseDOM] ⏱️ captureSnapshot: 234.5ms

// 方式 2: 使用 timer（更简洁）
timer.start('getDOMSnapshot')
await cdp.send('DOMSnapshot.captureSnapshot', {...})
timer.end('getDOMSnapshot', 'BrowserUseDOM', 'getDOMSnapshot')
// 输出: [14:32:50.456] [BrowserUseDOM] ⏱️ getDOMSnapshot: 234.5ms

// 方式 3: 只获取耗时，不输出日志
timer.start('operation')
// ... 执行操作 ...
const duration = timer.end('operation')
// duration = 234.5
```

## 实际应用示例

### browser-manager.ts
```typescript
import { log, timer } from '@auto-agent/shared-utils'

async launchChromeWithCDP(): Promise<void> {
  log.info('BrowserManager', 'Launching independent Chrome...')
  
  timer.start('chromeLaunch')
  const userDataDir = await this.createUserDataDirWithLogin()
  
  this.chromeProcess = spawn(chromePath, chromeArgs, {...})
  
  // 等待 Chrome 启动
  let attempts = 0
  while (attempts < maxAttempts) {
    await delay(1000)
    const isReady = await this.checkChromeDebugPort()
    if (isReady) {
      timer.end('chromeLaunch', 'BrowserManager', 'Chrome launch complete')
      // 输出: [14:32:52.345] [BrowserManager] ⏱️ Chrome launch complete: 5.123s
      return
    }
    attempts++
  }
  
  log.error('BrowserManager', 'Chrome failed to start', new Error(...))
}

async getPage(sessionId: string): Promise<Page> {
  log.info('BrowserManager', `Getting page for session: ${sessionId}`)
  
  const { context } = await this.initialize()
  
  if (!sessionPage || sessionPage.page.isClosed()) {
    log.info('BrowserManager', `Creating new tab for session: ${sessionId}`)
    const page = await context.newPage()
    log.success('BrowserManager', `Tab created for ${sessionId}`)
  } else {
    log.info('BrowserManager', `Reusing tab for session: ${sessionId}`)
  }
  
  return sessionPage.page
}
```

### controller.ts
```typescript
import { log, timer } from '@auto-agent/shared-utils'

async performAction(action: any): Promise<any> {
  log.info('Controller', `Performing action: ${action.type}`)
  
  timer.start('action')
  
  try {
    // ... 执行操作 ...
    log.success('Controller', `Action completed: ${action.type}`)
  } catch (error) {
    log.error('Controller', `Action failed: ${action.type}`, error)
    throw error
  } finally {
    timer.end('action', 'Controller', action.type)
  }
}
```

### agent-loop.ts (服务端)
```typescript
import { tracker, timer } from '@auto-agent/shared-utils'

async run(userInput: string): Promise<void> {
  tracker.log('AgentLoop', `Starting new task with input: ${userInput.substring(0, 50)}...`)
  
  timer.start('taskExecution')
  
  try {
    // Step 1: 构建上下文
    tracker.log('AgentLoop', 'Building context...')
    const context = this.buildContext()
    
    // Step 2: 调用 LLM
    tracker.log('AgentLoop', 'Calling LLM...')
    timer.start('llmCall')
    const response = await this.llmClient.chat(context)
    timer.end('llmCall', 'AgentLoop', 'LLM call')
    
    // Step 3: 处理工具调用
    if (response.toolCalls?.length > 0) {
      tracker.log('AgentLoop', `Executing ${response.toolCalls.length} tools`)
      for (const toolCall of response.toolCalls) {
        timer.start(`tool_${toolCall.name}`)
        const result = await this.executeTool(toolCall)
        timer.end(`tool_${toolCall.name}`, 'AgentLoop', `Tool: ${toolCall.name}`)
      }
    }
    
    tracker.success('AgentLoop', 'Task completed successfully')
  } catch (error) {
    tracker.error('AgentLoop', 'Task execution failed', error)
  } finally {
    timer.end('taskExecution', 'AgentLoop', 'Total task time')
  }
}
```

## 输出示例

运行上述代码时的完整日志输出：

```
[14:32:45.123] [Main] Starting application
[14:32:46.456] [BrowserManager] Launching independent Chrome...
[14:32:46.789] [BrowserManager] Creating temp profile at /tmp/chrome-xxx
[14:32:48.234] [BrowserManager] Chrome process started
[14:32:50.567] [BrowserManager] ✅ Chrome connected successfully
[14:32:50.890] [BrowserManager] ⏱️ Chrome launch complete: 4.434s
[14:32:51.123] [BrowserManager] Getting page for session: session-001
[14:32:51.456] [BrowserManager] Creating new tab for session: session-001
[14:32:51.789] [BrowserManager] ✅ Tab created for session-001
[14:32:52.012] [Controller] Performing action: click
[14:32:52.234] [BrowserUseDOM] Capturing DOM snapshot...
[14:32:52.456] [BrowserUseDOM] ⏱️ getDOMSnapshot: 222ms
[14:32:52.789] [Controller] ✅ Action completed: click
[14:32:52.901] [Controller] ⏱️ click: 889ms
[14:32:53.012] [AgentLoop] Starting new task with input: 打开百度，搜索大模型
[14:32:53.234] [AgentLoop] Building context...
[14:32:53.456] [AgentLoop] Calling LLM...
[14:32:55.123] [AgentLoop] ⏱️ LLM call: 1.667s
[14:32:55.345] [AgentLoop] Executing 2 tools
[14:32:55.567] [AgentLoop] ⏱️ Tool: browser_navigate: 222ms
[14:32:55.901] [AgentLoop] ⏱️ Tool: browser_click: 334ms
[14:32:56.123] [AgentLoop] ✅ Task completed successfully
[14:32:56.234] [AgentLoop] ⏱️ Total task time: 3.222s
```

## 时间格式说明

- `[HH:MM:SS.ms]` - 当前时间戳
  - HH: 小时 (00-23)
  - MM: 分钟 (00-59)
  - SS: 秒 (00-59)
  - ms: 毫秒 (000-999)

- 每一行都显示该日志的精确时间
- 查看日志时可以轻松计算相邻两行之间的时间差
- 便于排查性能瓶颈（哪个操作花时间最长）

## 最佳实践

1. **模块名统一** - 使用清晰的模块名（对应文件或功能）
2. **关键路径埋点** - 在以下位置添加日志：
   - 功能开始/结束
   - 错误发生
   - 性能关键操作
3. **适度详细** - 不要过度埋点，focus 在关键路径
4. **错误处理** - 始终在 error 处理中记录日志
5. **性能优化** - 使用 `tracker.perf` 或 `timer` 标记慢操作

---

**现在您可以直接使用埋点工具了！** ✅
