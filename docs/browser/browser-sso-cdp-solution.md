# Browser SSO 登录态共享方案（CDP）

## 问题背景

在实现 browser-ai 工具时，需要让 Playwright 控制的浏览器能够继承用户已登录的 SSO 状态，避免每次都需要重新登录。

## 方案对比

| 方案 | 是否影响已有 Chrome | 是否有登录态 | 实现复杂度 | 备注 |
|------|-------------------|-------------|-----------|------|
| 直接复制 Profile | ❌ 文件锁冲突 | ✅ 有 | 低 | Chrome 146+ 加密机制导致失败 |
| Cookie 解密导入 | ❌ 不影响 | ⚠️ Chrome 146 加密破解失败 | 高 | AES-GCM 解密失败 |
| CDP 连接现有 Chrome | ❌ 需关闭重启 | ✅ 有 | 中 | 影响用户当前浏览 |
| **CDP + 独立实例** | ✅ 不影响 | ✅ 有 | 中 | **最终采用方案** |

## 最终方案：CDP + 独立 Chrome 实例

### 核心思路

1. **复制登录文件** - 从系统 Chrome 复制关键登录态文件到临时目录
2. **启动独立实例** - 使用临时目录启动新的 Chrome 实例
3. **开启远程调试** - 新实例使用 `--remote-debugging-port=9222`
4. **CDP 连接控制** - Playwright 通过 CDP 协议连接并控制新实例

### 实现细节

#### 1. 登录文件复制

复制以下关键文件到临时目录：

```
/tmp/chrome-cdp-xxx/
├── Default/
│   ├── Cookies          # Cookie 数据库
│   ├── Login Data       # 保存的登录凭据
│   ├── Preferences      # 用户偏好设置
│   └── Network/Cookies  # 网络层 Cookie
└── Local State          # Chrome 状态（包含加密密钥引用）
```

**注意**：Chrome 146+ 使用系统密钥链（macOS Keychain）加密敏感数据，因此复制的文件在新实例中仍可通过系统 API 解密。

#### 2. Chrome 启动参数

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-cdp-xxx \
  --no-first-run \
  --no-default-browser-check \
  --window-position=100,100 \
  --disable-sync \
  --disable-extensions \
  --disable-translate
```

#### 3. Playwright CDP 连接

```typescript
const browser = await chromium.connectOverCDP('http://localhost:9222')
const context = browser.contexts()[0]
const page = await context.newPage()
```

### 代码实现

**文件**: `apps/client/src/main/tools/browser-manager.ts`

```typescript
export class BrowserManager {
  private async launchChromeWithCDP(): Promise<void> {
    // 1. 创建临时用户数据目录
    const tempDir = await this.createUserDataDirWithLogin()

    // 2. 启动 Chrome 并开启远程调试端口
    const chromeProcess = spawn(chromePath, [
      '--remote-debugging-port=9222',
      `--user-data-dir=${tempDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      // ... 其他优化参数
    ])

    // 3. 等待 CDP 端口就绪
    await this.waitForCDPPort()
  }

  private async createUserDataDirWithLogin(): Promise<string> {
    const sourceDir = this.getChromeUserDataDir()  // ~/Library/Application Support/Google/Chrome
    const tempDir = fs.mkdtempSync('/tmp/chrome-cdp-')

    // 异步并行复制登录文件
    await Promise.all([
      copyFile('Default/Cookies'),
      copyFile('Default/Login Data'),
      copyFile('Local State'),
      // ...
    ])

    return tempDir
  }
}
```

### 会话管理

```
┌─────────────────────────────────────────┐
│         BrowserManager (单例)            │
├─────────────────────────────────────────┤
│  Chrome Instance (独立，带 CDP)         │
│  ├── Context                             │
│  │   ├── Page (Session A)  ← Tab 1      │
│  │   ├── Page (Session B)  ← Tab 2      │
│  │   └── Page (Session C)  ← Tab 3      │
│  └── 共享登录态                          │
└─────────────────────────────────────────┘
```

- **每个会话** = 一个 Tab
- **多会话** = 同一窗口多个 Tab
- **关闭会话** = 关闭对应 Tab
- **全部关闭** = 关闭 Chrome 实例 + 清理临时目录

### 资源优化

为减少对系统的影响，添加以下启动参数：

```typescript
[
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-sync',
  '--disable-extensions',
  '--disable-translate',
  '--js-flags=--max-old-space-size=1024'
]
```

## 使用方式

无需手动操作，browser-ai 工具会自动：

1. 检测是否有可用的 CDP 端口（9222）
2. 如果没有，自动启动带 CDP 的独立 Chrome 实例
3. 通过 CDP 连接并创建 Tab
4. 导航目标页面（自动继承登录态）

## 注意事项

1. **首次启动** - 复制文件和启动 Chrome 可能需要 5-10 秒
2. **内存占用** - 额外 Chrome 实例约占用 200-400MB 内存
3. **临时文件** - 正常关闭时会自动清理，异常退出可能需要手动删除 `/tmp/chrome-cdp-*`
4. **登录态过期** - 如果系统 Chrome 登出，新实例也需要重新登录

## 测试结果

- ✅ 不影响用户已有 Chrome 窗口
- ✅ 成功继承 SSO 登录态
- ✅ 多会话 Tab 管理正常
- ✅ 资源清理正常

## 后续优化

1. **连接池** - 复用已启动的 Chrome 实例，避免重复启动
2. **健康检查** - 定期检测 CDP 连接状态，自动重连
3. **配置化** - 允许用户配置 Chrome 路径和调试端口
