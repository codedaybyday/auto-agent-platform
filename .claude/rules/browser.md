# 浏览器自动化规则

本规则在处理浏览器相关代码时自动生效。

## 架构设计

### 组件关系

```
┌─────────────────────────────────────────────────────────┐
│                    Browser Manager                       │
│         (apps/client/src/main/tools/browser-manager.ts)  │
│  - Chrome 进程管理                                       │
│  - CDP 连接管理                                          │
│  - 临时用户数据目录                                       │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                   Browser Controller                     │
│    (apps/client/src/main/tools/browser.ts)               │
│  - 动作执行 (navigate/click/type/scroll)                 │
│  - 状态获取 (DOM/截图)                                   │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                   DOM Service                            │
│  (apps/client/src/main/tools/browser-use/dom/)           │
│  - DOM 提取 (CDP DOMSnapshot)                            │
│  - 可访问性树 (AX Tree)                                  │
│  - 元素索引生成                                          │
└─────────────────────────────────────────────────────────┘
```

## 关键实现细节

### 1. Chrome 启动

**端口**: 9222 (CDP)

**启动参数**:
```typescript
[
  '--remote-debugging-port=9222',
  '--user-data-dir=/tmp/chrome-cdp-xxx',  // 临时目录
  '--no-first-run',
  '--disable-blink-features=AutomationControlled',  // 反检测
  '--disable-sync',  // 禁用同步
  '--disable-extensions',  // 禁用扩展
]
```

**登录态继承**:
- 复制系统 Chrome 的 `Cookies`, `Login Data`, `Local State`
- SSO 网站自动登录

### 2. DOM 提取

**技术方案**:
```typescript
// 1. DOM Snapshot (完整 DOM 树)
const snapshot = await page.evaluate(() => {
  return (window as any).__PLAYWRIGHT_INSPECTOR__?.snapshot || null
})

// 2. Accessibility Tree (可交互元素)
const axTree = await client.send('Accessibility.getFullAXTree')
```

**元素索引**:
- 给每个可交互元素分配唯一数字 ID
- ID 在页面刷新后重新生成
- 用于 LLM 引用元素 (如 "点击元素 #5")

### 3. 动作执行

**坐标点击** (优先):
```typescript
// 获取元素中心坐标
const box = await element.boundingBox()
await page.mouse.click(box.x + box.width/2, box.y + box.height/2)
```

**选择器点击** (备选):
```typescript
await element.click({ force: true })
```

### 4. 截图策略

**视口截图**:
```typescript
await page.screenshot({ type: 'jpeg', quality: 80 })
```

**全页面截图**:
```typescript
await page.screenshot({ fullPage: true, type: 'jpeg', quality: 80 })
```

**优化**:
- JPEG 格式，质量 80，平衡清晰度和大小
- 限制最大尺寸 (1920x1080)

## 常见问题

### Chrome 启动失败

**症状**: `browserType.connectOverCDP: Protocol error`

**原因**:
1. Chrome 版本与 Playwright 不兼容
2. 端口 9222 被占用
3. 临时用户数据目录权限问题

**解决**:
```bash
# 1. 检查 Chrome 版本
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --version

# 2. 升级 Playwright
pnpm add playwright@latest

# 3. 清理临时目录
rm -rf /tmp/chrome-cdp-*
```

### 空白页面 DOM

**症状**: DOM 提取为空

**原因**: 新标签页默认是 `about:blank`

**解决**:
```typescript
// 必须先导航到具体 URL
await page.goto('https://example.com')
// 然后才能提取 DOM
const dom = await extractDOM()
```

### SSO 登录失效

**症状**: 需要重新登录

**原因**: 临时用户数据目录的 Cookies 过期

**解决**: 重新复制系统 Chrome 的登录文件

## 代码规范

### 新增浏览器工具

1. **在 `browser.ts` 中添加动作类型**:
```typescript
type BrowserAction =
  | { type: 'navigate'; url: string }
  | { type: 'click'; index: number }
  | { type: 'new_action'; params: any }  // 新增
```

2. **在 `executeAction` 中实现处理**:
```typescript
case 'new_action':
  return await handleNewAction(action.params)
```

3. **在 MCP Server 注册工具** (`services/mcp/server.ts`):
```typescript
registerTool('browser_new_action', '描述', Schema, handler)
```

### DOM 元素定位

**优先使用索引** (LLM 友好):
```typescript
// ✅ 正确: 使用数字索引
await executeAction({ type: 'click', index: 5 })

// ❌ 错误: 使用复杂选择器
await page.click('#app > div:nth-child(2) > button')
```

### 错误处理

**必须包含截图** (便于调试):
```typescript
try {
  await executeAction(action)
} catch (error) {
  // 失败时自动截图
  const screenshot = await page.screenshot()
  return {
    success: false,
    error: error.message,
    screenshot  // 用于 LLM 分析
  }
}
```

## 测试要点

1. **导航测试**: 确保 `about:blank` 问题已解决
2. **SSO 测试**: 验证登录态继承
3. **多标签测试**: 每个会话独立标签页
4. **错误恢复**: 截图 + 错误信息完整返回
