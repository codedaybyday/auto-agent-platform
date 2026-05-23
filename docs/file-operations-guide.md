# 文件操作工具使用指南

## 概览

Agent 现在支持在客户端直接读写本地文件。这使得 Agent 可以：
- 📖 读取配置文件、代码文件等
- ✍️ 生成和修改本地文件
- 🔄 在本地和服务器之间处理数据

## 支持的工具

### 1. file_read - 读取文件

**功能**: 读取本地文件的内容

**参数**:
```typescript
{
  path: string  // 文件路径（相对或绝对路径）
}
```

**返回值**:
```typescript
{
  success: boolean
  content?: string      // 文件内容（UTF-8）
  size?: number         // 文件大小（字符数）
  error?: string        // 错误信息（如果失败）
}
```

**使用例子**:
```python
# 读取配置文件
result = agent.file_read(path="/home/user/config.json")
print(result['content'])

# 读取代码文件
result = agent.file_read(path="./src/main.ts")
if result['success']:
    lines = result['content'].split('\n')
    print(f"Total lines: {len(lines)}")
```

### 2. file_write - 写入文件

**功能**: 创建或覆盖本地文件

**参数**:
```typescript
{
  path: string      // 文件路径
  content: string   // 文件内容
}
```

**返回值**:
```typescript
{
  success: boolean
  message?: string  // 成功消息
  size?: number     // 写入字符数
  error?: string    // 错误信息（如果失败）
}
```

**使用例子**:
```python
# 写入文件
content = """
# My Project
This is a test file.
"""

result = agent.file_write(
    path="/tmp/README.md",
    content=content
)
print(result['message'])  # "File written successfully: /tmp/README.md"
```

## 实现细节

### 客户端实现

**文件**: `apps/client/src/main/tools/executor.ts`

```typescript
case 'file_read':
  result = await executeFileRead(toolCall)
  break

case 'file_write':
  result = await executeFileWrite(toolCall)
  break
```

#### executeFileRead
```typescript
async function executeFileRead(toolCall: any): Promise<any> {
  try {
    const { path } = toolCall.arguments
    const { readFileSync } = await import('fs')
    const content = readFileSync(path, 'utf-8')
    
    return {
      success: true,
      content,
      size: content.length
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    }
  }
}
```

#### executeFileWrite
```typescript
async function executeFileWrite(toolCall: any): Promise<any> {
  try {
    const { path, content } = toolCall.arguments
    const { writeFileSync } = await import('fs')
    writeFileSync(path, content, 'utf-8')
    
    return {
      success: true,
      message: `File written successfully: ${path}`,
      size: content.length
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    }
  }
}
```

### 服务端定义

**文件**: `apps/server/src/services/llm/client.ts`

```typescript
{
  type: 'function',
  function: {
    name: 'file_read',
    description: 'Read a local file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' }
      },
      required: ['path']
    }
  }
},
{
  type: 'function',
  function: {
    name: 'file_write',
    description: 'Write to a local file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' }
      },
      required: ['path', 'content']
    }
  }
}
```

### 工具分类

**文件**: `apps/server/src/services/agent/bridge.ts`

```typescript
private classifyTool(toolName: string): ToolType {
  const localTools = ['browser', 'browser_ai', 'bash', 'file_read', 'file_write']
  // ...
  if (localTools.includes(toolName)) return ToolType.LOCAL
}
```

两个工具都被分类为 **LOCAL** 工具，这意味着：
- ✅ 在客户端执行
- ✅ 通过 WebSocket 传输结果
- ✅ 支持离线操作

## 常见用例

### 1. 读取配置文件

```python
# Agent 自动执行
file_read(path="/app/config.json")
→ 返回 JSON 内容
→ Agent 解析并使用配置
```

### 2. 生成日志文件

```python
# Agent 完成任务后保存日志
file_write(
    path="/tmp/agent_execution_log.txt",
    content="[2025-01-15] Task completed successfully\n..."
)
```

### 3. 修改代码文件

```python
# Agent 自动修复代码问题
original = file_read(path="./src/bug.ts")
# ... AI 修复逻辑 ...
file_write(path="./src/bug.ts", content=fixed_code)
```

### 4. 数据处理流程

```
1. 读取输入文件
   file_read(path="/data/input.csv")
   
2. 数据处理（在 LLM 中）
   
3. 写入输出文件
   file_write(path="/data/output.csv", content=processed_data)
   
4. 生成报告
   file_write(path="/data/report.md", content=summary)
```

## 路径处理

### 支持的路径格式

| 格式 | 示例 | 说明 |
|------|------|------|
| 绝对路径 | `/home/user/file.txt` | 从文件系统根目录 |
| 相对路径 | `./config.json` | 相对于客户端工作目录 |
| 用户目录 | `~/Documents/file.txt` | 不支持，需手动展开 |

### 获取工作目录

```python
# 使用 bash 工具获取当前工作目录
result = agent.bash(command="pwd")
# 或
result = agent.bash(command="echo $PWD")

# 然后用于构造相对路径
working_dir = result['output']
file_path = f"{working_dir}/config.json"
```

## 错误处理

### 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|--------|
| `ENOENT: no such file or directory` | 文件不存在 | 检查路径是否正确 |
| `EACCES: permission denied` | 权限不足 | 使用有权限的路径或提升权限 |
| `EISDIR: illegal operation on a directory` | 路径是目录 | 指定具体的文件路径 |
| `File path is required` | 缺少 path 参数 | 检查工具调用参数 |
| `File content is required` | file_write 缺少 content | 提供要写入的内容 |

### 错误处理示例

```python
result = agent.file_read(path="/potentially/nonexistent/file.txt")

if not result['success']:
    print(f"Error: {result['error']}")
    # 处理错误，例如使用默认值
    content = "# Default content"
else:
    content = result['content']
    print(f"Read {result['size']} characters")
```

## 安全性考虑

### 权限限制

| 限制 | 说明 |
|------|------|
| 文件系统权限 | 遵循操作系统的文件权限 |
| 用户权限 | 受客户端进程权限限制 |
| 路径验证 | 无额外限制，可访问任何有权限的路径 |

### 最佳实践

1. **不要读取敏感文件**
   ```python
   # ❌ 不推荐
   agent.file_read(path="/etc/passwd")
   agent.file_read(path="~/.ssh/id_rsa")
   ```

2. **限制写入范围**
   ```python
   # ✅ 推荐 - 使用临时目录
   agent.file_write(
       path="/tmp/agent_output.txt",
       content=result
   )
   ```

3. **验证文件内容**
   ```python
   # ✅ 推荐 - 检查读取的文件
   result = agent.file_read(path="config.json")
   if result['success']:
       # 验证 JSON 格式
       try:
           config = json.loads(result['content'])
       except json.JSONDecodeError:
           print("Invalid JSON file")
   ```

## 性能注意事项

### 文件大小限制

| 项目 | 值 | 说明 |
|------|-----|------|
| 最大读取大小 | 无硬限制 | 受系统内存限制 |
| 最大写入大小 | 无硬限制 | 受磁盘空间限制 |
| 建议大小 | < 100MB | 避免内存溢出 |

### 大文件处理

```python
# ❌ 不推荐 - 一次性读取大文件
result = agent.file_read(path="/huge/file.log")

# ✅ 推荐 - 使用 bash 处理
result = agent.bash(command="head -100 /huge/file.log")
```

## 完整工作流示例

```python
# 1. 读取项目配置
config_result = agent.file_read(path="./project.config")
if config_result['success']:
    config = config_result['content']
    
    # 2. 基于配置生成代码
    generated_code = agent.generate_code(config)
    
    # 3. 保存生成的代码
    write_result = agent.file_write(
        path="./generated/code.ts",
        content=generated_code
    )
    
    if write_result['success']:
        print(f"Code generated: {write_result['message']}")
        
        # 4. 编译代码（使用 bash）
        compile_result = agent.bash(
            command="cd ./generated && npm run build"
        )
        
        if compile_result['exit_code'] == 0:
            print("Build successful!")
else:
    print(f"Failed to read config: {config_result['error']}")
```

## API 速查表

| 操作 | 工具 | 参数 | 返回 |
|------|------|------|------|
| 读文件 | `file_read` | `path: string` | `{success, content, size, error}` |
| 写文件 | `file_write` | `path, content` | `{success, message, size, error}` |

## 故障排除

### 问题 1: "Unknown tool: file_read"

**症状**: Agent 收到错误 "Unknown tool: file_read"

**解决方案**:
- ✅ 确保客户端已更新到最新版本
- ✅ 检查 `executor.ts` 中是否有 `case 'file_read':`
- ✅ 重启客户端进程

### 问题 2: 文件读取返回空内容

**症状**: `file_read` 返回成功但 content 为空

**可能原因**:
- 文件为空
- 文件使用了其他编码（非 UTF-8）
- 权限问题

**排查方法**:
```python
result = agent.file_read(path="file.txt")
print(f"Size: {result['size']}")  # 检查大小
print(f"First 50 chars: {result['content'][:50]}")

# 或使用 bash 验证
agent.bash(command="file file.txt")  # 检查文件类型
agent.bash(command="wc -l file.txt")  # 检查行数
```

## 相关文档

- 📌 [Bash 工具使用指南](./bash-guide.md)
- 📌 [Browser 工具使用指南](./browser-guide.md)
- 📌 [工具执行系统](./tool-execution.md)
