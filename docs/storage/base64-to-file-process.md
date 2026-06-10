# Base64 到图片文件的转换过程

## 简答

**是的，最终是真正的图片文件（PNG）** ✅

Base64 是文本编码格式，保存过程是将其解码回二进制数据，然后存储为真实的图片文件。

## 详细过程

### 第 1 步：截图生成（客户端）

```typescript
// Playwright 生成截图
const screenshot = await page.screenshot({
  type: 'png',
  fullPage: action.fullPage
})
```

**此时 `screenshot` 是什么？**
- 类型: `Buffer`（Node.js 二进制数据）
- 内容: 真实的 PNG 文件的二进制数据
- 大小: ~200-800KB（取决于分辨率）

```
┌──────────────────────┐
│ PNG 二进制数据       │
│ (真实图片数据)       │
│ 大小: 262KB         │
│                      │
│ [137, 80, 78, 71...]│ ← 十进制字节数组
│ PNG magic number    │
└──────────────────────┘
```

### 第 2 步：Base64 编码（客户端）

```typescript
const base64Screenshot = screenshot.toString('base64')
```

**什么是 Base64？**
- 是文本编码格式
- 将每 3 个字节编码为 4 个可打印字符
- 目的: 安全地传输二进制数据

**转换过程:**
```
原始二进制:   10101100 11110011 01001101
                ↓
Base64编码:  rPM1
(4个可打印ASCII字符)

完整例子:
原始 PNG:    [137, 80, 78, 71, 13, 10, 26, 10...]
                    ↓
Base64:     "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
```

**结果:**
- 类型: `string`（纯文本）
- 大小: ~267KB（增大约 33%）
- 特点: 只包含 A-Z, a-z, 0-9, +, /, = 这些字符

```typescript
const base64Screenshot = 
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  // ↑ 纯文本，可以在 JSON 中传输
```

### 第 3 步：检测大小（客户端 executor）

```typescript
if (data?.screenshot && typeof data.screenshot === 'string' && data.screenshot.length > 100000) {
  // 检测 base64 字符串长度 > 100KB
  // 大约对应原始图片 75KB
  await uploadScreenshotFile(sessionId, data.screenshot)
}
```

**为什么这样做？**
- Base64 字符串很大，不适合通过 WebSocket 传输
- 转换为文件 URL 可以节省 99% 的消息体积

### 第 4 步：上传到服务器（客户端）

```typescript
async function uploadScreenshotFile(sessionId: string, base64Data: string): Promise<string> {
  // 将 Base64 字符串转回二进制
  const buffer = Buffer.from(base64Data, 'base64')
  //                                    ↑ 指定输入编码是 base64
  
  // 现在 buffer 是原始的 PNG 二进制数据
  console.log(buffer.length)  // 262144 字节（原始大小）
  
  // HTTP POST 发送二进制数据
  const response = await fetch(`http://localhost:3000/api/files/upload`, {
    method: 'POST',
    body: buffer,  // ← 发送二进制数据
    headers: {
      'Content-Type': 'image/png',
      'x-session-id': sessionId,
      'x-filename': `screenshot-${Date.now()}.png`
    }
  })
  
  const result = await response.json()
  return result.url  // http://localhost:3000/api/files/a1b2c3d4e5f6...
}
```

**此时发送了什么？**
- HTTP Body: 原始 PNG 二进制数据（262KB）
- Headers: 告诉服务器这是 image/png

```
HTTP POST 请求体:
┌────────────────────────────┐
│ 二进制 PNG 数据             │
│ (262KB 原始大小)           │
│                             │
│ [137, 80, 78, 71, ...]    │
│ ↑ PNG 魔术字节             │
└────────────────────────────┘
```

### 第 5 步：服务端保存（服务器）

```typescript
// apps/server/src/routes/files.ts
router.post('/upload', async (req: Request, res: Response) => {
  // 收集 HTTP 请求体的所有数据块
  const chunks: Buffer[] = []
  req.on('data', chunk => chunks.push(chunk))
  
  req.on('end', () => {
    // 合并所有数据块
    const buffer = Buffer.concat(chunks)
    // buffer 现在是完整的 PNG 二进制数据
    
    // 保存到文件存储
    const { id, url } = fileStorage.save(sessionId, buffer, filename, mimeType)
  })
})
```

**此时存储了什么？**
- 在内存中（可以扩展到磁盘或 S3）
- 存储格式: `StoredFile` 对象
- 包含原始的 PNG 二进制数据

```typescript
// FileStorageService 中的存储对象
const file: StoredFile = {
  id: 'a1b2c3d4e5f6...',
  sessionId: 'session-123',
  name: 'screenshot-1234567890.png',
  mimeType: 'image/png',
  data: Buffer<262KB>,  // ← 原始 PNG 二进制
  size: 262144,
  createdAt: 1234567890000,
  expiresAt: 1234654290000,  // 24小时后
  url: 'http://localhost:3000/api/files/a1b2c3d4e5f6...'
}

// 存储在 Map 中
this.files.set('a1b2c3d4e5f6...', file)
```

### 第 6 步：下载/访问文件（前端或其他系统）

```typescript
// GET /api/files/a1b2c3d4e5f6...
router.get('/:fileId', (req: Request, res: Response) => {
  const file = fileStorage.get(fileId)
  
  // 设置响应头告诉浏览器这是图片
  res.setHeader('Content-Type', file.mimeType)  // 'image/png'
  res.setHeader('Content-Length', file.size)
  res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`)
  
  // 发送原始二进制数据
  res.send(file.data)  // ← 发送 PNG 二进制
})
```

**响应内容：**
```
HTTP Response:
┌─────────────────────────────┐
│ Headers:                    │
│ Content-Type: image/png     │
│ Content-Length: 262144      │
│                             │
│ Body:                       │
│ 二进制 PNG 数据 (262KB)     │
│ [137, 80, 78, 71, ...]     │
└─────────────────────────────┘
```

## 完整的数据转换链

```
1️⃣ 截图生成
   ┌─────────────────────────────┐
   │ PNG 二进制 Buffer           │
   │ 262KB 原始大小              │
   │ [137, 80, 78, 71, ...]    │
   └────────────┬────────────────┘

2️⃣ Base64 编码
   ┌─────────────────────────────┐
   │ Base64 字符串               │
   │ 267KB (增大 ~33%)           │
   │ "iVBORw0KGgoA..."          │
   └────────────┬────────────────┘

3️⃣ 上传时解码
   ┌─────────────────────────────┐
   │ 再次转为二进制 Buffer       │
   │ 262KB 原始大小              │
   │ [137, 80, 78, 71, ...]    │
   └────────────┬────────────────┘

4️⃣ 服务端存储
   ┌─────────────────────────────┐
   │ 内存或磁盘存储              │
   │ PNG 二进制 (262KB)          │
   │ 生成文件 URL               │
   └────────────┬────────────────┘

5️⃣ 下载时发送
   ┌─────────────────────────────┐
   │ HTTP 响应二进制数据         │
   │ Content-Type: image/png     │
   │ [137, 80, 78, 71, ...]    │
   └────────────┬────────────────┘

6️⃣ 浏览器显示
   ┌─────────────────────────────┐
   │ 真实的 PNG 图片             │
   │ 可直接显示、保存、处理      │
   └─────────────────────────────┘
```

## 代码细节

### Base64 → Buffer（解码）

```typescript
// 在 executor.ts 中
const base64Data = "iVBORw0KGgoAAAANSUhEUgAAAAEA..."
const buffer = Buffer.from(base64Data, 'base64')
//             ↑ 生成二进制 Buffer

console.log(buffer)
// Buffer [137, 80, 78, 71, 13, 10, 26, 10, ...]

console.log(buffer.length)
// 262144 (原始 PNG 大小)
```

### Buffer 验证

```typescript
// 检查是否真的是 PNG
const isPNG = (buffer: Buffer): boolean => {
  // PNG 文件的魔术字节：137, 80, 78, 71 (十进制)
  // 十六进制：0x89 0x50 0x4E 0x47
  const pngSignature = [0x89, 0x50, 0x4e, 0x47]
  
  return buffer.length >= 4 &&
    buffer[0] === pngSignature[0] &&
    buffer[1] === pngSignature[1] &&
    buffer[2] === pngSignature[2] &&
    buffer[3] === pngSignature[3]
}

const buffer = Buffer.from(base64Data, 'base64')
console.log(isPNG(buffer))  // true ✅
```

### 保存为磁盘文件

```typescript
// 如果要保存到磁盘
import fs from 'fs'

const buffer = Buffer.from(base64Data, 'base64')

// 方式 1: 同步保存
fs.writeFileSync('/tmp/screenshot.png', buffer)

// 方式 2: 异步保存
await fs.promises.writeFile('/tmp/screenshot.png', buffer)

// 结果: 产生真实的 PNG 文件
// 可以用任何图片查看器打开
```

## 性能对比

| 操作 | 数据 | 大小 | 说明 |
|------|------|------|------|
| PNG 二进制 | `Buffer` | 262KB | 真实图片数据 |
| Base64 编码 | `string` | 350KB | 增大 33% |
| 压缩后 | `Buffer` | 62KB | gzip 压缩 |
| 网络传输 | HTTP body | 262KB | 发送原始二进制 |

## 验证文件完整性

```typescript
// 接收文件后验证
const file = fileStorage.get(fileId)

// 方式 1: 检查大小
console.log(`File size: ${file.size} bytes`)

// 方式 2: 检查 PNG 签名
const isPNG = file.data[0] === 0x89 &&
              file.data[1] === 0x50 &&
              file.data[2] === 0x4e &&
              file.data[3] === 0x47

console.log(`Is valid PNG: ${isPNG}`)

// 方式 3: 计算哈希
import crypto from 'crypto'
const hash = crypto.createHash('sha256').update(file.data).digest('hex')
console.log(`SHA256: ${hash}`)
```

## 在浏览器中显示

```html
<!-- 方式 1: 直接 URL -->
<img src="http://localhost:3000/api/files/a1b2c3d4e5f6..." />

<!-- 方式 2: Data URL (小文件) -->
<img src="data:image/png;base64,iVBORw0KGgoA..." />

<!-- 方式 3: Blob -->
<script>
const response = await fetch('http://localhost:3000/api/files/a1b2c3d4e5f6...')
const blob = await response.blob()
const url = URL.createObjectURL(blob)
document.querySelector('img').src = url
</script>
```

## 总结

```
Base64 字符串
"iVBORw0KGgoA..."
      ↓
  Buffer.from(str, 'base64')
      ↓
真实的 PNG 二进制数据
[137, 80, 78, 71, ...]
      ↓
保存/传输/显示
      ↓
✅ 真正的图片文件
   可用任何工具打开
```

**关键点：**
- ✅ Base64 只是编码格式，不是图片本身
- ✅ 解码后得到真实的二进制图片数据
- ✅ 保存的是真实 PNG 文件，可以直接打开
- ✅ 大小恢复到原始大小（解码回来）
- ✅ 可以验证 PNG 魔术字节确认文件完整性
