# Browser-Use 截图文件存储方案

## 问题分析

之前的实现中，browser-use 截图返回的 base64 会被截断到 100 个字符：

```typescript
// ❌ 旧实现 - 会截断
return {
  result: `Screenshot captured: ${screenshot.toString('base64').substring(0, 100)}...`
}
```

这导致 Agent 无法获取完整的截图数据。

## 解决方案

采用 **文件存储 + 文件链接** 的模式：
1. 客户端生成完整的 base64 截图
2. 工具执行器检测大文件自动上传到服务器
3. 服务器保存文件并返回可访问的链接
4. Agent 接收文件链接而不是 base64 数据

### 架构图

```
┌─────────────────┐
│  Client/Main    │
├─────────────────┤
│ Browser         │ ✅ 生成完整的 base64 截图
│ screenshot()    │    (1-3MB)
└────────┬────────┘
         │
         ▼
┌──────────────────────────┐
│ Tool Executor            │
├──────────────────────────┤
│ sendToolResult()         │ ✅ 检测 base64 > 100KB
│                          │    自动上传
│ uploadScreenshotFile()   │    (使用 HTTP POST)
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ Server/Express           │
├──────────────────────────┤
│ POST /api/files/upload   │ ✅ 接收 PNG 数据
│                          │    保存到内存存储
│ FileStorageService       │    生成文件 ID 和 URL
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ File Storage             │
├──────────────────────────┤
│ Memory Storage           │ ✅ 内存存储（可扩展）
│ TTL: 24小时              │    自动过期清理
│ Max 1000 files           │    按 sessionId 隔离
└──────────────────────────┘
         │
         ▼
  返回文件链接：
  http://localhost:3000/api/files/[fileId]
```

## 实现详情

### 1. 客户端：完整的 base64 截图返回

**文件**: `apps/client/src/main/tools/browser-use/core/controller.ts`

```typescript
case 'screenshot':
  const screenshot = await page.screenshot({
    type: 'png',
    fullPage: action.fullPage
  })
  const base64Screenshot = screenshot.toString('base64')
  return {
    success: true,
    screenshot: base64Screenshot,  // ✅ 完整的 base64
    size: screenshot.length,
    result: `Screenshot captured: ${screenshot.length} bytes`
  }
```

### 2. 工具执行器：自动上传大文件

**文件**: `apps/client/src/main/tools/executor.ts`

```typescript
async function sendToolResult(messageId: string, sessionId: string, success: boolean, data: any): Promise<void> {
  // ✅ 检测大的 base64 截图 (> 100KB)
  if (data?.screenshot && typeof data.screenshot === 'string' && data.screenshot.length > 100000) {
    try {
      const screenshotFileUrl = await uploadScreenshotFile(sessionId, data.screenshot)
      // 替换 base64 为文件链接
      data.screenshotUrl = screenshotFileUrl
      delete data.screenshot  // 删除原始的 base64，节省带宽
      console.log(`[Executor] Screenshot uploaded to ${screenshotFileUrl}`)
    } catch (error) {
      console.error('[Executor] Failed to upload screenshot:', error)
      // 继续发送，即使上传失败
    }
  }

  // 发送工具结果
  ws?.send(JSON.stringify({
    type: 'tool.result',
    messageId,
    timestamp: Date.now(),
    sessionId,
    payload: {
      toolCallId: messageId,
      success,
      data,  // ✅ 现在包含 screenshotUrl 而不是大的 base64
      executionTime: 0
    }
  }))
}

/**
 * 将 base64 截图上传到服务器文件存储
 */
async function uploadScreenshotFile(sessionId: string, base64Data: string): Promise<string> {
  const buffer = Buffer.from(base64Data, 'base64')

  const response = await fetch(`http://localhost:3000/api/files/upload`, {
    method: 'POST',
    body: buffer,
    headers: {
      'Content-Type': 'image/png',
      'x-session-id': sessionId,
      'x-filename': `screenshot-${Date.now()}.png`
    }
  })

  if (!response.ok) {
    throw new Error(`Failed to upload screenshot: ${response.statusText}`)
  }

  const result = await response.json() as { id: string; url: string }
  return result.url
}
```

### 3. 服务端：文件存储服务

**文件**: `apps/server/src/services/file-storage.ts`

特性：
- ✅ 内存存储（可扩展为 S3）
- ✅ TTL 自动过期（默认 24 小时）
- ✅ 按 sessionId 隔离
- ✅ 文件大小限制（默认 10MB）
- ✅ 定时清理过期文件

```typescript
export class FileStorageService {
  private files = new Map<string, StoredFile>()
  
  /**
   * 保存文件
   */
  save(
    sessionId: string,
    data: Buffer,
    name: string,
    mimeType: string
  ): { id: string; url: string }

  /**
   * 获取文件
   */
  get(fileId: string): StoredFile | null

  /**
   * 删除文件
   */
  delete(fileId: string): boolean

  /**
   * 删除会话的所有文件
   */
  deleteSession(sessionId: string): number

  /**
   * 获取统计信息
   */
  getStats(): { totalFiles: number; totalSize: number; sessionCount: number }
}
```

### 4. 文件服务路由

**文件**: `apps/server/src/routes/files.ts`

```
POST /api/files/upload      - 上传文件（返回文件 URL）
GET  /api/files/:fileId      - 下载文件
GET  /api/files/:fileId/info - 获取文件信息
GET  /api/files/debug/stats  - 存储统计信息
```

**上传流程**:
```typescript
POST /api/files/upload
Headers:
  Content-Type: image/png
  x-session-id: <sessionId>
  x-filename: screenshot-<timestamp>.png

Request Body: PNG 二进制数据

Response:
{
  "success": true,
  "id": "a1b2c3d4e5f6...",
  "url": "http://localhost:3000/api/files/a1b2c3d4e5f6...",
  "size": 262144
}
```

## 数据流转

### 完整的截图请求-响应流程

```
1. Agent 发送命令
   ┌─────────────────────────┐
   │ Take screenshot action  │
   └────────────┬────────────┘

2. Client 执行截图
   ┌─────────────────────────┐
   │ page.screenshot()       │  返回 Buffer
   │ toString('base64')      │  ~267KB base64
   └────────────┬────────────┘

3. BrowserUse 返回结果
   ┌─────────────────────────┐
   │ {                       │
   │   success: true,        │
   │   screenshot: "iVBOR..│  ← 完整的 base64
   │   size: 262144,         │
   │   result: "Captured"    │
   │ }                       │
   └────────────┬────────────┘

4. Tool Executor 处理
   ┌─────────────────────────┐
   │ sendToolResult()        │
   │ 检测 screenshot > 100KB  │
   │ 调用 uploadScreenshotFile
   └────────────┬────────────┘

5. HTTP 上传到服务器
   ┌─────────────────────────┐
   │ POST /api/files/upload  │
   │ Content: PNG Buffer     │
   │ Headers: sessionId      │
   └────────────┬────────────┘

6. Server 保存并返回
   ┌─────────────────────────┐
   │ FileStorageService.save │
   │ 返回文件 URL            │
   └────────────┬────────────┘

7. Tool Result 发送到后端
   ┌─────────────────────────┐
   │ {                       │
   │   success: true,        │
   │   screenshotUrl:        │
   │   "http://localhost..." │  ← 文件链接
   │   result: "Captured"    │
   │ }                       │
   └────────────┬────────────┘

8. Agent 接收结果
   ┌─────────────────────────┐
   │ Agent Loop Process      │
   │ 获得文件链接            │
   │ 可访问实际截图         │
   └─────────────────────────┘
```

## 文件访问

### 获取截图文件

```bash
# 下载文件
curl http://localhost:3000/api/files/a1b2c3d4e5f6... -o screenshot.png

# 获取文件信息
curl http://localhost:3000/api/files/a1b2c3d4e5f6.../info

# 在 HTML 中显示
<img src="http://localhost:3000/api/files/a1b2c3d4e5f6..." />
```

## 性能对比

| 指标 | 旧方案 | 新方案 | 改进 |
|------|--------|--------|------|
| 截图大小 | 1920×1080 | 1920×1080 | 无变化 |
| Base64 大小 | 533KB | 533KB | 无变化 |
| WebSocket 消息 | "iVBOR...（100字符）" | `{screenshotUrl: "..."}` | ✅ 减小 99% |
| 传输延迟 | 即时（但不完整） | 正常 | ✅ 完整性优先 |
| 存储空间 | 客户端（临时） | 服务器（24小时）| 可管理 |
| Agent 能获取完整图片 | ❌ 否 | ✅ 是 | 关键改进 |

## 配置选项

### 文件存储配置

```typescript
// apps/server/src/services/file-storage.ts
{
  fileTTL: 24 * 60 * 60 * 1000,     // 24小时过期
  maxFileSize: 10 * 1024 * 1024,   // 10MB 单文件限制
  maxFileCount: 1000,               // 最多 1000 文件
  cleanupInterval: 5 * 60 * 1000,  // 每 5 分钟清理一次
  baseUrl: 'http://localhost:3000'  // 可通过环境变量配置
}
```

### 环境变量

```bash
# .env
SERVER_BASE_URL=http://localhost:3000
```

## 扩展方向

### 1. 持久化存储（S3）

```typescript
// 替换内存存储为 S3
import AWS from 'aws-sdk'

const s3 = new AWS.S3()

// 保存到 S3
await s3.putObject({
  Bucket: process.env.S3_BUCKET,
  Key: `screenshots/${fileId}.png`,
  Body: data
}).promise()

// 生成预签名 URL
const url = s3.getSignedUrl('getObject', {
  Bucket: process.env.S3_BUCKET,
  Key: `screenshots/${fileId}.png`,
  Expires: 86400  // 24小时
})
```

### 2. 数据库记录

```typescript
// 记录文件元数据到数据库
interface FileMetadata {
  id: string
  sessionId: string
  filename: string
  mimeType: string
  size: number
  createdAt: Date
  expiresAt: Date
  s3Key?: string  // S3 存储键
}
```

### 3. CDN 支持

```typescript
// 使用 CDN 加速文件分发
const cdnUrl = `https://cdn.example.com/files/${fileId}.png`
```

## 故障处理

### 上传失败

```typescript
// executor.ts 中的错误处理
} catch (error) {
  console.error('[Executor] Failed to upload screenshot:', error)
  // 继续发送，即使上传失败
  // Agent 仍会收到结果，但没有 screenshotUrl
}
```

### 文件过期

```typescript
// FileStorageService 自动清理
// 定时清理过期文件（每 5 分钟）
// 或手动清理会话文件
fileStorage.deleteSession(sessionId)
```

### 存储满

```typescript
// 达到限制时拒绝上传
if (this.files.size >= this.config.maxFileCount) {
  throw new Error(`File storage full (${this.config.maxFileCount} files)`)
}
```

## API 总结

### FileStorageService

```typescript
// 保存文件
save(sessionId, buffer, name, mimeType): { id, url }

// 获取文件
get(fileId): StoredFile | null

// 删除文件
delete(fileId): boolean

// 删除会话所有文件
deleteSession(sessionId): number

// 获取统计
getStats(): { totalFiles, totalSize, sessionCount }

// 清理过期文件
cleanup(): number

// 停止服务
stop(): void
```

### HTTP 路由

```
POST /api/files/upload               上传文件
GET  /api/files/:fileId              下载文件
GET  /api/files/:fileId/info         文件信息
GET  /api/files/debug/stats          统计信息
```

## 相关文件清单

- ✅ `apps/server/src/services/file-storage.ts` - 文件存储服务
- ✅ `apps/server/src/routes/files.ts` - 文件路由
- ✅ `apps/server/src/routes/index.ts` - 路由注册
- ✅ `apps/client/src/main/tools/executor.ts` - 工具执行器
- ✅ `apps/client/src/main/tools/browser-use/core/controller.ts` - 浏览器控制器

## 测试

```bash
# 启动服务器
cd apps/server
npm run dev

# 手动测试上传
curl -X POST http://localhost:3000/api/files/upload \
  -H "Content-Type: image/png" \
  -H "x-session-id: test-session" \
  -H "x-filename: test.png" \
  --data-binary @screenshot.png

# 查看统计
curl http://localhost:3000/api/files/debug/stats
```

## 总结

这个解决方案优雅地解决了 base64 截图截断问题：

✅ **完整的数据传输** - 不再丢失图片信息
✅ **高效的消息格式** - WebSocket 消息大幅减小  
✅ **灵活的存储** - 支持从内存到 S3 的扩展
✅ **自动清理** - TTL 机制防止存储泄漏
✅ **会话隔离** - 每个会话独立管理文件
✅ **错误恢复** - 上传失败不影响主流程

Agent 现在可以通过简单的 URL 访问完整的截图文件。
