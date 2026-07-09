# 日志分析报告：百度搜索场景

## 背景

分析「打开浏览器搜索 TypeScript」场景下，助手返回多余消息、体验待优化的问题。

**分析时间**：2026-07-09 21:52 - 21:55
**日志文件**：`server.log` (8228 行), `client.log` (2853 行)
**会话**：`1782271333680-g6b4ttnpe`，「百度搜索美团」
**模型**：deepseek-v4-pro

---

## 一、错误识别

### 1.1 页面导航超时（最严重，24 次）

```
Error: page.goto: Timeout 10000ms exceeded.
  - navigating to "https://www.google.com/search?q=typescript", waiting until "domcontentloaded"
```

| URL | 次数 | 根因 |
|-----|------|------|
| `https://www.google.com/search?q=typescript` | 20 | Google 国内不可达 |
| `https://www.ba.com/s?wd=cript` | 14 | LLM 生成 URL 时截断了 "baidu" → "ba", "typescript" → "cript" |
| `https://wwwidu.com/s?wdtypescript` | 14 | LLM 生成 URL 时丢失了 "bai" 前缀和参数分隔符 `=` `&` |

**根因**：deepseek-v4-pro 模型在生成搜索 URL 时存在 **URL 截断/损坏** 问题。正确的百度搜索 URL 应该是 `https://www.baidu.com/s?wd=typescript`，但模型生成了 `ba.com`（丢失 "idu"）和 `wwwidu.com`（丢失 "bai"）。

### 1.2 JSON 参数解析失败（14 次）

```
Tool call arguments parse error for browser_navigate: 
Failed to parse arguments: Expected ':' after property name in JSON at position 6
原始参数: {"url""https://wwwidu.com/s?wdtypescript"}
```

**根因**：模型生成了非法的 JSON — 缺少 `:` 分隔符（`"url""https://..."` 应该是 `"url":"https://..."`），缺少 `=` 参数分隔符（`s?wdtypescript` 应该是 `s?wd=typescript`）。

这表明 deepseek-v4-pro 模型的 **函数调用参数生成质量不稳定**。

### 1.3 Chrome 启动警告（客户端，影响低）

```
ERROR: readlink(/private/tmp/chrome-cdp-PiRf8B/SingletonLock) failed: Invalid argument
ERROR: chrome://newtab/ for incorrect profile type
ERROR: crashpad/settings.dat: No such file
```

这些都是 Chrome CDP 模式的标准启动警告，不影响功能。

---

## 二、用户体验问题分析（核心）

### 2.1 「多余的消息」— 根因分析

**问题**：用户看到了 7 条中间过程的助手消息，而非只看到最终结果。

**时间线还原**：

```
21:54:20.721  用户: "打开浏览器，搜索 typescript，根据搜索的内容，给我解释什么是typescript"

21:54:24.849  📨 助手消息1: "好的，我先打开浏览器搜索 TypeScript，然后结合搜索结果为你解释。"
               → 执行 browser_navigate → https://www.google.com/search?q=typescript → 超时 10.63s

21:54:37.676  📨 助手消息2: "Google 连接超时，换成百度来搜索。"
               → 执行 browser_navigate → https://www.ba.com/s?wd=cript → 超时 10.01s

21:54:49.797  📨 助手消息3: "URL 写错了，正确的百度地址再试一次。"
               → 参数解析失败，未执行 (0.0ms)

21:54:51.067  📨 助手消息4: (空内容)
               → 执行 browser_navigate → https://www.baidu.com/s?wd=typescript → ✅ 成功 8.65s

21:55:01.270  📨 助手消息5: "搜索成功，让我看看页面内容。"
               → 执行 browser_get_context → ✅ 成功 1.54s

21:55:04.631  📨 助手消息6: "内容比较长，让我截图查看搜索结果。"
               → 执行 browser_screenshot → ✅ 成功 158ms

21:55:15.407  ✅ 助手消息7: "搜索已完成！从百度搜索结果中可以看到 TypeScript 的相关信息。结合搜索结果和我的知识，为你..."
               → 最终答案
```

**根因**：在 `loop.ts:560-568`，每次 LLM 返回 `content + toolCalls` 时，都会将其保存为一条 `role=assistant` 的消息。这些中间消息的 `content` 字段是 **模型自我对话的计划文本**，却被当作给用户的回复展示：

```typescript
// loop.ts 第 560-568 行
if (response.content || response.toolCalls) {
  this.addMessage({
    id: this.generateId(),
    role: 'assistant',
    content: response.content || '',   // ← 中间计划文本也被保存
    reasoningContent: response.reasoningContent,  // ← 思考链也被保存
    toolCalls: response.toolCalls,
    timestamp: Date.now()
  })
}
```

### 2.2 「体验待优化：处理过程展示不够细化」

**当前状态**：
- 用户看到 7 条消息，其中 6 条是中间过程消息
- 中间过程消息和最终结果消息在 UI 上没有区分
- `reasoningContent`（模型思考链）也被保存到消息中，可能被展示

**改进方向**：
1. **中间过程折叠**：工具执行中的中间消息应折叠为「处理中…」状态
2. **过程步骤展示**：明确展示「正在搜索 TypeScript」「正在分析页面内容」「正在截图」等步骤
3. **结果可查看**：最终结果应突出显示，中间过程可展开查看

---

## 三、性能分析

### 3.1 整体耗时

| 阶段 | 耗时 | 占比 |
|------|------|------|
| LLM 调用 (7 次) | ~12.5s | 22.7% |
| 工具执行 (6 次) | ~31.0s | 56.4% |
| 其中：失败导航 (3次) | ~20.6s | 37.5% |
| 其中：成功导航 (1次) | 8.65s | 15.7% |
| 总耗时 | **~55s** | 100% |

### 3.2 无效耗时

**37.5% 的时间浪费在错误的 URL 上**：
- Google 超时：10.63s（Google 在国内不可用）
- ba.com 超时：10.01s（URL 截断错误）
- 参数解析失败：0ms

### 3.3 Token 消耗趋势

```
迭代1:  37 tokens (2 messages)
迭代2:  70 tokens (4 messages)
迭代3:  161 tokens (6 messages)
迭代4:  248 tokens (8 messages)
迭代5:  320 tokens (10 messages)
迭代6:  374 tokens (12 messages)
迭代7: 1088 tokens (14 messages) ← browser_get_context 返回了完整 DOM 树，激增 2.9x
最终: 1609 tokens (14 messages)
```

**问题点**：第 7 次迭代时 `browser_get_context` 返回了完整的百度页面 DOM 树（含所有 `<script>` 标签 URL），导致 token 从 374 激增到 1088（增加 2.9x）。

### 3.4 流式传输统计

- 总共 **471 个 stream.chunk** 事件
- 7 次 LLM 调用平均每次 67 个 chunk
- Client 端全部成功转发（472 个 stream 消息，含 1 个 `stream.complete`）

---

## 四、模式分析

### 4.1 deepseek-v4-pro URL 生成缺陷（高频）

**模式**：模型多次生成损坏的 URL

| 生成 URL | 正确 URL | 损坏类型 |
|----------|---------|---------|
| `www.ba.com/s?wd=cript` | `www.baidu.com/s?wd=typescript` | 域名截断 + 参数截断 |
| `wwwidu.com/s?wdtypescript` | `www.baidu.com/s?wd=typescript` | 域名前缀丢失 + 参数分隔符丢失 |
| `google.com/search?q=typescript` | (URL 正确，但国内不可达) | 连通性问题 |

**建议**：在 `browser_navigate` 工具描述中加入 **URL 格式验证**，自动修正常见错误。

### 4.2 搜索策略不智能

**模式**：系统始终优先使用 Google，每次都超时后才切换到百度。

```
迭代1: Google 搜索 → 超时 10.63s
迭代2: 百度搜索 (URL 错误) → 超时 10.01s
迭代3: 百度搜索 (URL 又错) → 解析失败
迭代4: 百度搜索 (正确) → 成功
```

**建议**：在系统提示中告知模型「优先使用百度搜索」，或根据网络环境自动选择搜索引擎。

### 4.3 reasoningContent 泄漏

**模式**：每条消息的 `reasoningContent` 被完整保存：

```
"用户想要我打开浏览器搜索TypeScript，然后根据搜索结果解释什么是TypeScript。
操作指令，需要先导航浏览器搜索，然后获取页面内容，最后给出解释。让我先导航到搜索引擎搜索TypeScript。"
```

这段思考内容在每次迭代中被重复保存 5 次（第 1, 2, 4, 5, 7 次迭代）。

---

## 五、解决方案

### 5.1 立即修复：中间消息折叠（用户体验）

**问题**：所有含 `toolCalls` 的 assistant 消息都被展示给用户。

**方案**：在 `loop.ts` 中区分「计划消息」和「最终消息」，前端只展示最终消息或折叠中间消息。

```typescript
// loop.ts — 修改 addMessage 调用，标记消息类型
if (response.content || response.toolCalls) {
  const hasToolCalls = response.toolCalls && response.toolCalls.length > 0
  this.addMessage({
    id: this.generateId(),
    role: 'assistant',
    content: response.content || '',
    reasoningContent: response.reasoningContent,
    toolCalls: response.toolCalls,
    timestamp: Date.now(),
    // 新增：标记消息是否为中间过程消息
    metadata: {
      isIntermediateStep: hasToolCalls,  // 含工具调用的为中间步骤
      stepDescription: hasToolCalls 
        ? extractStepDescription(response.content) 
        : undefined
    }
  })
}
```

前端侧：将 `isIntermediateStep: true` 的消息折叠展示为「处理步骤」，而非完整对话。

### 5.2 短期优化：搜索引擎智能选择

**修改** `apps/server/src/services/agent/loop.ts` 系统提示词：

```typescript
// 在系统提示词中添加
const SYSTEM_PROMPT_ADDITION = `
## 搜索引擎优先级
- 在中国大陆环境下，优先使用百度搜索 (https://www.baidu.com/s?wd=关键词)
- Google 搜索可能因网络问题无法访问，遇到超时直接切换百度
- URL 格式：百度搜索使用 ?wd= 参数，Google 使用 ?q= 参数
`
```

### 5.3 中期优化：URL 生成校验

在 `browser_navigate` 工具中添加预处理：

```typescript
// apps/client/src/main/tools/browser.ts — navigate 前校验 URL
function validateAndFixUrl(url: string): string {
  // 检测并修复常见 URL 错误
  const fixes: [RegExp, string][] = [
    [/^https?:\/\/www\.ba\.com\b/, 'https://www.baidu.com'],  // ba.com → baidu.com
    [/^https?:\/\/wwwidu\.com\b/, 'https://www.baidu.com'],     // wwwidu.com → baidu.com
    [/s\?wd([^=&]+)$/, 's?wd=$1'],                              // 确保 wd= 格式
  ]
  for (const [pattern, replacement] of fixes) {
    if (pattern.test(url)) {
      console.warn(`[URL Fix] Auto-corrected URL: ${url} → ${replacement}`)
      return url.replace(pattern, replacement)
    }
  }
  return url
}
```

### 5.4 长期方案：过程步骤展示重构

建议设计明确的过程步骤状态机：

```
用户消息 → [步骤1: 分析意图] → [步骤2: 搜索中...] → [步骤3: 分析页面...] → 最终结果
```

每个步骤显示在 UI 左侧面板，主对话区只显示最终结果，中间过程可点击展开。

---

## 六、总结

| 维度 | 现状 | 根因 | 严重程度 |
|------|------|------|---------|
| 多余消息 | 7 条中间消息全部展示 | `content + toolCalls` 消息未做区分 | 🔴 严重 |
| URL 生成错误 | Google 超时 + URL 截断 | deepseek 模型 URL 生成不稳定 | 🟡 中等 |
| 无效耗时 | 37.5% 时间浪费 | 网络环境 + URL 错误 | 🟡 中等 |
| Token 浪费 | DOM 树返回 2.9x 增长 | 全量 DOM 上下文传输 | 🟠 需关注 |
| reasoningContent | 重复保存 5 次 | 思考链未做去重 | 🟠 需关注 |
| 搜索引擎选择 | 固定优先 Google | 未适配国内网络环境 | 🟡 中等 |

## 变更记录

| 日期 | 作者 | 变更内容 |
|------|------|----------|
| 2026-07-09 | Claude Code | 创建分析报告 |
