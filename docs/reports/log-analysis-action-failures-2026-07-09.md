# 动作反复执行失败分析报告

**分析时间**: 2026-07-09 23:40-23:41
**会话**: `1783611642516-x8tq7jdjv` (新会话)
**输入**:「打开百度，搜索 js」
**模型**: deepseek-v4-pro

---

## 一、完整时间线（10 次迭代，共 ~57s）

| # | 时间 | 工具 | 参数 | 结果 | 耗时 |
|---|------|------|------|------|------|
| 1 | 23:40:55 | browser_navigate | `{"url""https://www.baidu.com"}` ❌ | JSON格式错误：缺少`:` | 0ms |
| 2 | 23:40:57 | browser_navigate | `url: "https://www.baidu"` ❌ | DNS解析失败：缺少`.com` | 1.19s |
| 3 | 23:41:00 | browser_navigate | `url: "https://www.baidu"` ❌ | **重复错误**：相同错误URL | 0.14s |
| 4 | 23:41:03 | browser_navigate | `url: "https://www.baidu.com"` ✅ | 导航成功 | 1.73s |
| 5 | 23:41:06 | browser_get_context | `{}` ✅ | 获取页面DOM | 0.85s |
| 6 | 23:41:07 | *LLM思考* | 9.3s 分析DOM | — | 9.3s |
| 7 | 23:41:11 | browser_screenshot | `{}` ✅ | 截图106KB | 0.10s |
| 8 | 23:41:21 | browser_click | `{ref:0, x:640, y:300}` ⚠️ | **点击了`<html>`元素！** | 2.19s |
| 9 | 23:41:36 | browser_screenshot | `{}` ✅ | 截图104KB | 0.13s |
| 10 | 23:41:45 | browser_click | `{"ref":0,"x":640,"y"270}` ❌ | JSON格式错误：缺少`:` | 0ms |
| 11 | 23:41:49 | browser_click | `{"ref"0,"x"640,"y":270}` ❌ | JSON格式错误：缺少`:` | **→终止** |

**最终错误**: `思考次数过多，请简化问题`（达到 maxIterations=10 上限）

---

## 二、错误分类

### 2.1 DeepSeek 模型 JSON 格式错误（4次，核心问题）

| # | 原始参数 | 错误类型 |
|---|---------|---------|
| 1 | `{"url""https://www.baidu.com"}` | 缺少 `:` 分隔 key/value |
| 10 | `{"ref": 0, "x": 640, "y"270}` | 缺少 `:` 分隔 key/value |
| 11 | `{"ref"0, "x"640, "y": 270}` | 缺少 `:` 分隔 key/value（**连续两次相同错误**） |

**模式**: 模型在生成 JSON 时漏掉冒号，且第10和第11次迭代犯了**完全相同**的错误。这说明 LLM 在看到"JSON格式错误"的反馈后，**没有学会修复**。

### 2.2 URL 残缺（2次）

| # | 生成 URL | 正确 URL | 错误 |
|---|---------|---------|------|
| 2 | `https://www.baidu` | `https://www.baidu.com` | 缺少 `.com` |
| 3 | `https://www.baidu` | `https://www.baidu.com` | **完全相同**的错误URL |

**关键问题**: LLM 收到 `ERR_NAME_NOT_RESOLVED` 错误后，第三次迭代仍然生成了**完全相同的URL**。没有从错误反馈中纠正。

### 2.3 点击目标错误（1次）

- 迭代8: `browser_click {ref: 0, x: 640, y: 300}` → 点击了 `html` 根元素
- `ref: 0` 是 DOM 树的 `<html>` 标签，不是搜索框
- 这个点击**没有副作用**，页面没有任何变化

---

## 三、无效耗时分析

```
总耗时 ~57s，其中:
├── JSON 格式错误浪费: 0ms (立即失败)
├── URL 错误浪费:   1.33s (迭代2+3)
├── LLM 思考时间:   ~22s (4次 LLM 调用)
├── 有效工具执行:    ~5s (迭代4+5+7+8+9)
├── 重复点击+截图:   ~15s (迭代7-11，无实质进展)
└── 其他:           ~14s
```

**~60% 的时间被浪费在无效循环上**：

- 迭代7的截图后，LLM 分析9.3s决定"点击"
- 迭代8点击了错误元素
- 迭代9再截图确认（无变化）
- 迭代10-11尝试再点击 → JSON错误 → 终止

**LoopGuard 缺陷**:
- 整个过程中 LoopGuard 只在开始时记录了一次 `🎯 新任务`
- 后续9次迭代（含4次失败）**没有触发任何警告**
- 迭代2和3调用相同的失败URL，LoopGuard应该检测到但没有

---

## 四、根因总结

| 问题 | 根因 | 严重度 |
|------|------|--------|
| JSON格式反复错误 | deepseek-v4-pro 在收到格式错误反馈后无法自我纠正 | 🔴 严重 |
| URL重复错误 | LLM 没有从 `ERR_NAME_NOT_RESOLVED` 错误中推断正确URL | 🔴 严重 |
| 点击错误元素 | LLM 对 DOM 索引理解有误（`ref:0` = `<html>`） | 🟡 中等 |
| LoopGuard 未触发 | 循环检测逻辑未覆盖"相同失败参数"的模式 | 🟡 中等 |
| maxIterations 耗尽 | 10次迭代不够完成简单任务，因为5次无效 | 🟠 需关注 |

---

## 五、修复建议

### 5.1 LLM JSON 参数自动修复（立即）

文件: `apps/client/src/main/handlers/message-handler.ts` 或更早的环节

在工具执行前，对常见 JSON 格式错误进行自动修复：

```typescript
// 在 MCPToolBridge.execute() 前添加参数校验
function fixCommonJSONErrors(rawArgs: string): string {
  // 修复1: 缺少冒号的 key-value 对 ("key""value" → "key":"value")
  // 正则: "key""value" 模式
  let fixed = rawArgs.replace(/"([^"]+)""([^"]+)"/g, '"$1":"$2"')
  
  // 修复2: 缺少冒号的 key-value 对 ("key"value → "key":"value")
  // 正则: "key"(非引号字符) 模式
  fixed = fixed.replace(/"(\w+)"(\w)/g, '"$1":"$2')
  
  return fixed
}
```

但更根本的方案是提升 LLM 的 JSON 生成质量。可以在系统提示中强调 JSON 格式规范。

### 5.2 URL 自动补全

文件: `apps/server/src/services/agent/loop.ts` `executeTool()` 方法

```typescript
// 在 browser_navigate 前校验和修复 URL
function autoFixUrl(url: string): string {
  // baidu → baidu.com
  if (/^https?:\/\/www\.[a-z]+$/.test(url) && !url.includes('.')) {
    return url + '.com'
  }
  // 其他常见域名修复
  return url
}
```

### 5.3 LoopGuard 增强

文件: `apps/server/src/services/agent/loop-guard.ts`

当前 LoopGuard 检测"重复工具调用模式"，但未检测"连续相同参数的失败"。应增加：

```typescript
// 新增检测：连续2次相同参数 + 相同工具 + 失败结果 → 警告
if (prevCall.toolName === currentCall.toolName &&
    JSON.stringify(prevCall.args) === JSON.stringify(currentCall.args) &&
    !prevCall.success && !currentCall.success) {
  // 发出警告，让 LLM 更换策略
  loopWarning = '⚠️ 重复执行失败的操作，请检查参数或更换策略'
}
```

### 5.4 系统提示优化

文件: `apps/server/src/services/agent/loop.ts` `buildSystemPrompt()`

添加 JSON 格式强调:

```
## JSON 格式规范
生成工具参数时，必须严格遵守 JSON 格式：
- 每个 key 后面必须有英文冒号 `:` 
- 正确: {"url": "https://www.baidu.com", "ref": 0}
- 错误: {"url""https://www.baidu.com"} ❌ 缺少冒号
- 错误: {"url"https://www.baidu.com"} ❌ 缺少冒号
```

---

## 变更记录

| 日期 | 作者 | 变更内容 |
|------|------|----------|
| 2026-07-09 | Claude Code | 创建分析报告 |
