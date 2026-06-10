# Browser-use 架构迁移方案

## 当前问题分析

### 1. 元素定位不稳定
- 仅依赖 `data-ref` 属性，DOM 变化后失效
- 没有 hash-based 稳定定位
- 缺乏多层回退机制

### 2. DOM 序列化不够精简
- 使用五级流水线，但仍然可能包含冗余元素
- 缺乏 CDP 的 accessibility tree 支持
- 没有 iframe/shadow DOM 处理

### 3. Agent 循环不完整
- 没有自动重试机制
- 缺乏失败恢复策略
- 没有规划能力

---

## 改进方案

### Phase 1: 稳定元素定位（核心）

#### 1.1 Element Hash 定位器

```typescript
interface ElementSignature {
  // 主哈希（用于精确匹配）
  hash: string
  // 稳定哈希（过滤动态类名）
  stableHash: string
  // 语义标识
  tag: string
  id?: string
  name?: string
  ariaLabel?: string
  placeholder?: string
  // 位置信息（作为后备）
  bbox: { x, y, width, height }
  // XPath（作为后备）
  xpath: string
}

// 哈希计算（参考 browser-use）
function computeElementHash(el: Element): string {
  const attrs = [
    el.tagName,
    el.id,
    el.getAttribute('name'),
    el.getAttribute('aria-label'),
    el.className?.split(' ')
      .filter(c => !isDynamicClass(c))  // 过滤动态类名
      .join(' '),
    Math.round(el.getBoundingClientRect().x),
    Math.round(el.getBoundingClientRect().y),
  ].join('|')
  return hashString(attrs)
}
```

#### 1.2 4 层回退定位策略

```typescript
class RobustElementLocator {
  async locate(signature: ElementSignature): Promise<Locator | null> {
    // Layer 1: Element Hash（最精确）
    const byHash = await this.findByHash(signature.hash)
    if (byHash) return byHash

    // Layer 2: Stable Hash（DOM 变化后仍有效）
    const byStableHash = await this.findByStableHash(signature.stableHash)
    if (byStableHash) return byStableHash

    // Layer 3: Semantic Match（属性 + 文本匹配）
    const bySemantic = await this.findBySemantic(signature)
    if (bySemantic) return bySemantic

    // Layer 4: Coordinate（最后手段）
    return this.findByCoordinate(signature.bbox)
  }
}
```

### Phase 2: 改进 DOM 序列化

#### 2.1 使用 Accessibility Tree

```typescript
// 通过 CDP 获取 accessibility tree（更稳定）
async function getAccessibilityTree(page: Page) {
  const cdpSession = await page.context().newCDPSession(page)
  const { nodes } = await cdpSession.send('Accessibility.getFullAXTree')
  return nodes.filter(node => isInteractive(node))
}
```

#### 2.2 精简 LLM 表示

```typescript
// browser-use 格式
interface DOMElementForLLM {
  index: number      // LLM 引用的索引
  tag: string        // 标签
  type?: string      // input type
  name?: string      // 可访问性名称
  placeholder?: string
  text?: string      // 可见文本
  // 不发送给 LLM，但用于定位
  hash: string
  stableHash: string
  bbox: { x, y, w, h }
}

// LLM 看到的格式：
// [0] <input> type="search" name="Search" placeholder="输入关键词"
// [1] <button> text="百度一下"
```

### Phase 3: 完整 Agent 循环

#### 3.1 自动重试机制

```typescript
class AgentLoop {
  async executeStep(instruction: string) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // 1. 获取状态
        const state = await this.getBrowserState()

        // 2. LLM 决策
        const action = await this.llm.decide(instruction, state)

        // 3. 执行
        const result = await this.execute(action)

        // 4. 验证
        if (await this.validate(result)) {
          return result  // 成功
        }

        // 失败，添加到历史，让 LLM 知道
        this.addToHistory({ action, result: 'failed', attempt })

      } catch (error) {
        // 异常，重试
        if (attempt === MAX_RETRIES - 1) throw error
      }
    }
  }
}
```

#### 3.2 自纠正机制

```typescript
// 执行后验证
async function validateAction(page: Page, expected: string): Promise<boolean> {
  // 截图验证（可选，需要视觉模型）
  const screenshot = await page.screenshot()
  const validation = await llm.validate(screenshot, expected)

  // 或者 DOM 验证
  const newState = await getBrowserState()
  return newState.url !== oldState.url ||
         newState.title !== oldState.title ||
         hasSignificantDomChange(oldState.dom, newState.dom)
}
```

### Phase 4: Vision 集成（可选高级功能）

```typescript
// 当 DOM 定位连续失败时，切换到 Vision 模式
class HybridAgent {
  async executeWithFallback(action: Action) {
    // 尝试 DOM 模式
    const domResult = await this.executeDOM(action)
    if (domResult.success) return domResult

    // DOM 失败，切换到 Vision
    console.log('🖼️ Switching to VISION mode')
    return this.executeVision(action)
  }

  async executeVision(action: Action) {
    const screenshot = await page.screenshot()
    const response = await visionLLM.chat({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: action.instruction },
          { type: 'image', image: screenshot }
        ]
      }]
    })

    // GPT-4V 返回坐标 [x, y]
    const { x, y } = parseCoordinate(response)
    await page.mouse.click(x, y)
  }
}
```

---

## 实现路线图

### Week 1: 核心定位器
- [ ] Element Hash 计算
- [ ] 4 层回退定位
- [ ] 集成到现有 BrowserAI

### Week 2: DOM 改进
- [ ] Accessibility Tree 支持
- [ ] 精简 LLM 表示
- [ ] Iframe 处理

### Week 3: Agent 完善
- [ ] 自动重试机制
- [ ] 自纠正验证
- [ ] 错误恢复

### Week 4: 高级功能
- [ ] Vision 模式（可选）
- [ ] 规划能力
- [ ] 性能优化

---

## 关键文件变更

```
apps/client/src/main/tools/browser-ai/
├── browser-ai.ts              # 主入口（集成新定位器）
├── element-locator.ts         # 4层回退定位器 ⭐ 核心
├── element-hash.ts            # 元素哈希计算
├── dom-serializer-v2.ts       # 改进版 DOM 序列化
├── accessibility-tree.ts      # CDP Accessibility Tree
├── agent-loop-v2.ts           # 完整 Agent 循环
└── vision-locator.ts          # Vision 定位（可选）
```

---

## 预期效果

| 指标 | 当前 | 改进后 |
|-----|------|--------|
| 元素定位成功率 | ~60% | >95% |
| DOM 变化后恢复 | 需重新序列化 | 自动 stable hash 匹配 |
| 自动重试 | 无 | 3次重试 + 自纠正 |
| Vision 后备 | 无 | 支持 |

---

## 是否开始实现？

建议先从 **Phase 1（稳定元素定位）** 开始，这是解决当前问题的核心。

需要我立即开始实现吗？
