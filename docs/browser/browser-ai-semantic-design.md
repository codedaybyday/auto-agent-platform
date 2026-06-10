# BrowserAI 语义化指令解析重构方案

## 1. 设计目标

将硬编码的指令解析改造为基于 LLM 的语义理解系统，支持：
- 自然语言指令解析（"帮我搜索 Claude 的最新消息"）
- 复杂多步任务规划（"登录网站并下载报告"）
- 上下文感知元素匹配（"点击蓝色的提交按钮"）
- 失败自动恢复（操作失败时重新规划）

## 2. 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                        BrowserAI                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │   Semantic   │  │   Planner    │  │      Executor        │   │
│  │   Parser     │──▶│   (LLM)      │──▶│   (Playwright)       │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
│         │                 │                   │                 │
│         ▼                 ▼                   ▼                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  PageContext │  │ ActionQueue  │  │   RecoveryEngine     │   │
│  │  (Snapshot)  │  │  (优先级队列) │  │   (错误恢复)          │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 3. 核心组件设计

### 3.1 SemanticParser (语义解析器)

职责：将自然语言指令转换为结构化操作

```typescript
interface SemanticParserConfig {
  // 使用 LLM 解析（true）还是硬编码（false）
  useLLM: boolean
  // LLM 模型配置
  model?: ModelConfig
  // 最大重试次数
  maxRetries: number
  // 是否启用多步规划
  enablePlanning: boolean
  // 是否包含页面上下文
  includePageContext: boolean
}

interface ParseResult {
  // 操作意图
  intent: string
  // 结构化操作序列
  actions: BrowserAction[]
  // 预期结果描述
  expectedOutcome: string
  // 是否需要人工确认
  requireConfirmation: boolean
}

class SemanticParser {
  private llmClient: LLMClient
  private config: SemanticParserConfig

  async parse(
    instruction: string,
    pageContext: PageContext
  ): Promise<ParseResult>
}
```

### 3.2 PageContext (页面上下文)

职责：收集并格式化页面状态供 LLM 使用

```typescript
interface PageContext {
  // 基础信息
  url: string
  title: string
  // 可交互元素列表（精简版）
  interactiveElements: PageElement[]
  // 表单信息
  forms: FormInfo[]
  // 页面摘要（文本内容前500字符）
  contentPreview: string
  // 当前截图（Base64，可选）
  screenshot?: string
  // 操作历史
  actionHistory: ActionHistoryItem[]
}

interface PageElement {
  // 元素唯一标识（用于 LLM 引用）
  ref: string
  // 元素标签
  tag: string
  // 可访问性角色
  role?: string
  // 可见文本
  text?: string
  // 占位符
  placeholder?: string
  // 元素类型（input、button 等）
  type?: string
  // 状态（disabled、checked 等）
  states?: string[]
}

class PageContextBuilder {
  async build(
    page: Page,
    options: ContextBuildOptions
  ): Promise<PageContext>

  // 元素优先级过滤（减少 LLM token）
  private filterImportantElements(
    elements: PageElement[],
    maxCount: number
  ): PageElement[]
}
```

### 3.3 ActionPlanner (动作规划器)

职责：将解析结果转换为可执行的动作序列

```typescript
interface ActionPlan {
  // 计划 ID
  id: string
  // 原始指令
  originalInstruction: string
  // 操作步骤
  steps: ActionStep[]
  // 预计完成时间
  estimatedTime: number
}

interface ActionStep {
  // 步骤序号
  index: number
  // 操作类型
  action: BrowserActionType
  // 目标元素引用
  targetRef?: string
  // 操作参数
  params: Record<string, any>
  // 成功条件
  successCondition: SuccessCondition
  // 失败处理
  onFailure: FailureStrategy
}

type SuccessCondition =
  | { type: 'url_change' }
  | { type: 'element_appear'; selector: string }
  | { type: 'text_appear'; text: string }
  | { type: 'network_idle' }
  | { type: 'custom'; check: () => Promise<boolean> }

type FailureStrategy =
  | { type: 'retry'; maxAttempts: number }
  | { type: 'fallback'; alternativeStep: ActionStep }
  | { type: 'ask_user' }
  | { type: 'abort' }

class ActionPlanner {
  // 基于 LLM 的规划
  async createPlan(
    parseResult: ParseResult,
    pageContext: PageContext
  ): Promise<ActionPlan>

  // 步骤优化（合并、排序）
  optimizeSteps(steps: ActionStep[]): ActionStep[]
}
```

## 4. Tool Definitions (LLM 工具定义)

定义浏览器操作工具供 LLM 调用：

```typescript
const BROWSER_TOOLS: ToolDefinition[] = [
  {
    name: 'navigate',
    description: '导航到指定 URL',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '目标 URL' },
        waitUntil: {
          type: 'string',
          enum: ['load', 'domcontentloaded', 'networkidle'],
          description: '等待条件'
        }
      },
      required: ['url']
    }
  },
  {
    name: 'click',
    description: '点击页面元素',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: '元素引用 ID' },
        description: { type: 'string', description: '元素描述（用于定位）' },
        waitForNavigation: { type: 'boolean', description: '是否等待导航完成' }
      },
      required: ['ref']
    }
  },
  {
    name: 'type',
    description: '在输入框中输入文本',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: '输入框元素引用 ID' },
        text: { type: 'string', description: '要输入的文本' },
        clearFirst: { type: 'boolean', description: '是否先清空输入框' }
      },
      required: ['ref', 'text']
    }
  },
  {
    name: 'select',
    description: '选择下拉框选项',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: '下拉框元素引用 ID' },
        option: { type: 'string', description: '选项文本或值' }
      },
      required: ['ref', 'option']
    }
  },
  {
    name: 'scroll',
    description: '滚动页面',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'to_element'] },
        amount: { type: 'number', description: '滚动距离（像素）' },
        ref: { type: 'string', description: '目标元素引用（direction=to_element 时使用）' }
      },
      required: ['direction']
    }
  },
  {
    name: 'wait',
    description: '等待条件',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['time', 'selector', 'network_idle'] },
        value: { type: 'number', description: '等待时间（毫秒）或选择器' }
      },
      required: ['type']
    }
  },
  {
    name: 'screenshot',
    description: '截取页面截图',
    parameters: {
      type: 'object',
      properties: {
        fullPage: { type: 'boolean', description: '是否截取整个页面' }
      }
    }
  },
  {
    name: 'extract',
    description: '提取页面数据',
    parameters: {
      type: 'object',
      properties: {
        schema: {
          type: 'object',
          description: '数据提取模式（字段名: CSS 选择器）'
        }
      },
      required: ['schema']
    }
  },
  {
    name: 'complete',
    description: '任务完成，返回结果',
    parameters: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'string', description: '任务结果描述' },
        data: { type: 'object', description: '提取的数据' }
      },
      required: ['success', 'result']
    }
  }
]
```

## 5. 提示词设计

### 5.1 系统提示词

```
你是一个专业的浏览器自动化助手。你的任务是将用户指令转换为浏览器操作。

当前页面状态：
- URL: {url}
- 标题: {title}
- 可交互元素：
{elements}

可用操作工具：
1. navigate: 导航到指定 URL
2. click: 点击元素（使用 ref）
3. type: 输入文本
4. select: 选择下拉选项
5. scroll: 滚动页面
6. wait: 等待条件
7. screenshot: 截图
8. extract: 提取数据
9. complete: 任务完成

规则：
1. 每次只返回一个工具调用
2. 点击前确保元素存在（使用 ref）
3. 操作后等待页面加载完成
4. 任务完成后调用 complete
5. 如果无法完成，说明原因并调用 complete(success=false)

操作历史：
{history}
```

### 5.2 元素格式化示例

```
[ref=a1] <button>登录</button>
[ref=a2] <input type="text" placeholder="用户名" />
[ref=a3] <input type="password" placeholder="密码" />
[ref=a4] <a href="/forgot">忘记密码？</a>
[ref=a5] <button>注册</button>
```

## 6. 执行流程

```
┌──────────┐     ┌──────────────┐     ┌──────────────┐
│  用户指令 │────▶│ SemanticParser│────▶│  LLM 解析    │
└──────────┘     └──────────────┘     └──────┬───────┘
                                              │
                                              ▼
┌──────────┐     ┌──────────────┐     ┌──────────────┐
│ 任务完成  │◀────│  ActionPlanner│◀────│ ParseResult  │
└──────────┘     └──────┬───────┘     └──────────────┘
                        │
                        ▼
┌──────────┐     ┌──────────────┐     ┌──────────────┐
│  执行操作 │◀────│   Executor    │◀────│  ActionStep  │
└────┬─────┘     └──────────────┘     └──────────────┘
     │
     ▼
┌──────────┐     ┌──────────────┐
│ 检查成功  │────▶│ 成功? ──┬──▶ 下一步 │
└──────────┘     └─────────┘   │      │
                               └──▶ 重试/失败处理 │
```

## 7. 元素匹配策略

### 7.1 双阶段匹配

```typescript
interface ElementMatcher {
  // 阶段 1: LLM 选择 ref
  selectElement(
    description: string,
    candidates: PageElement[]
  ): Promise<string | null> // 返回 ref

  // 阶段 2: 运行时验证
  resolveRef(
    ref: string,
    page: Page,
    snapshot: PageSnapshot
  ): Promise<Locator | null>
}
```

### 7.2 模糊匹配增强

当 ref 失效时，使用描述重新查找：

```typescript
async function fuzzyFindElement(
  description: string,
  page: Page
): Promise<Locator | null> {
  // 1. 文本匹配
  const byText = page.getByText(description, { exact: false })
  if (await byText.count() > 0) return byText.first()

  // 2. 标签 + 文本
  const byLabel = page.getByLabel(description, { exact: false })
  if (await byLabel.count() > 0) return byLabel.first()

  // 3. 角色 + 名称
  const byRole = page.getByRole('button', { name: description, exact: false })
  if (await byRole.count() > 0) return byRole.first()

  // 4. placeholder 匹配
  const byPlaceholder = page.locator(`[placeholder*="${description}" i]`)
  if (await byPlaceholder.count() > 0) return byPlaceholder.first()

  return null
}
```

## 8. 错误处理与恢复

### 8.1 错误分类

```typescript
type BrowserError =
  | { type: 'element_not_found'; ref: string; description: string }
  | { type: 'action_failed'; action: string; error: string }
  | { type: 'navigation_failed'; url: string; error: string }
  | { type: 'timeout'; operation: string }
  | { type: 'unexpected_state'; expected: string; actual: string }
```

### 8.2 恢复策略

```typescript
interface RecoveryEngine {
  // 元素未找到：重新获取 snapshot 并请求 LLM 重新定位
  handleElementNotFound(error: ElementNotFoundError): Promise<ActionStep | null>

  // 操作失败：重试或寻找替代方案
  handleActionFailed(error: ActionFailedError): Promise<ActionStep | null>

  // 超时：简化操作或增加等待
  handleTimeout(error: TimeoutError): Promise<ActionStep | null>
}
```

## 9. 配置选项

```typescript
interface BrowserAISemanticConfig {
  // LLM 配置
  llm: {
    provider: 'anthropic' | 'openai' | 'ollama'
    model: string
    apiKey: string
    baseURL?: string
    temperature?: number
  }

  // 语义解析配置
  parsing: {
    // 启用 LLM 解析（否则使用硬编码）
    useLLM: boolean
    // 启用多步规划
    enablePlanning: boolean
    // 最大规划步数
    maxPlanSteps: number
    // 要求确认的操作
    requireConfirmationFor: ('navigate' | 'click' | 'type')[]
  }

  // 上下文配置
  context: {
    // 包含的元素数量上限
    maxElements: number
    // 包含截图
    includeScreenshot: boolean
    // 历史记录长度
    historyLength: number
  }

  // 执行配置
  execution: {
    // 默认超时
    defaultTimeout: number
    // 最大重试次数
    maxRetries: number
    // 重试间隔
    retryDelay: number
    // 网络空闲等待
    waitForNetworkIdle: boolean
  }
}
```

## 10. 性能优化

### 10.1 Token 优化

- **元素截断**：只保留前 50 个重要元素
- **字段选择**：只传递 ref、tag、text、placeholder
- **增量更新**：只传递变更的元素

### 10.2 缓存策略

```typescript
interface BrowserAICache {
  // 缓存页面分析结果
  pageAnalysis: Map<string, PageAnalysis>
  // 缓存元素定位结果
  elementRefs: Map<string, ElementCacheEntry>
}

interface ElementCacheEntry {
  ref: string
  selector: string
  timestamp: number
  ttl: number
}
```

### 10.3 并发控制

```typescript
interface ConcurrencyControl {
  // 最大并发 LLM 请求
  maxConcurrentLLMRequests: number
  // 请求间隔
  requestInterval: number
}
```

## 11. API 设计

### 11.1 语义执行接口

```typescript
class BrowserAI {
  // 执行自然语言指令
  async execute(
    instruction: string,
    options?: ExecuteOptions
  ): Promise<ExecuteResult>

  // 多步任务执行
  async executeTask(
    taskDescription: string,
    options?: TaskOptions
  ): Promise<TaskResult>

  // 带确认的执行
  async executeWithConfirmation(
    instruction: string,
    confirmCallback: (step: ActionStep) => Promise<boolean>
  ): Promise<ExecuteResult>
}

interface ExecuteResult {
  success: boolean
  message: string
  actions: BrowserAction[]
  extractedData?: any
}

interface TaskResult extends ExecuteResult {
  plan: ActionPlan
  executedSteps: ActionStep[]
  failedStep?: ActionStep
}
```

### 11.2 使用示例

```typescript
const browserAI = new BrowserAI({
  llm: {
    provider: 'ollama',
    model: 'qwen2.5:14b',
    apiKey: '',
    baseURL: 'http://localhost:11434/v1'
  },
  parsing: {
    useLLM: true,
    enablePlanning: true
  }
})

// 简单指令
const result = await browserAI.execute('搜索 "Claude 3.5"')

// 复杂任务
const task = await browserAI.executeTask(`
  1. 登录 GitHub
  2. 找到我的 starred repositories
  3. 提取前 5 个的名称和描述
`)
```

## 12. 实现路线图

### Phase 1: 基础 LLM 解析 (MVP)
- [ ] 集成 LLMClient
- [ ] 实现 SemanticParser
- [ ] 定义基础 Tools
- [ ] 单步指令执行

### Phase 2: 规划能力
- [ ] 实现 ActionPlanner
- [ ] 多步任务支持
- [ ] 成功条件验证

### Phase 3: 智能恢复
- [ ] RecoveryEngine
- [ ] 元素模糊匹配
- [ ] 自动重试机制

### Phase 4: 高级特性
- [ ] 视觉增强（截图支持）
- [ ] 任务模板
- [ ] 学习用户偏好

## 13. 与现有代码兼容

### 13.1 向后兼容

```typescript
class BrowserAI {
  // 保持原有方法
  async semanticAct(instruction: string): Promise<...>

  // 新增 LLM 方法
  async execute(instruction: string): Promise<...>

  private async parseInstructionLLM(
    instruction: string,
    context: PageContext
  ): Promise<...>

  private parseInstructionRegex(
    instruction: string
  ): Promise<...> // 原方法保留
}
```

### 13.2 配置切换

```typescript
// 配置使用 LLM 还是正则
const browserAI = new BrowserAI({
  semanticParsing: {
    mode: 'llm', // 'llm' | 'regex' | 'hybrid'
    llmConfig: { ... }
  }
})
```

## 14. 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| LLM 延迟高 | 用户体验 | 流式响应、超时降级 |
| Token 成本高 | 运营成本 | 元素截断、缓存 |
| LLM 幻觉 | 操作错误 | 元素验证、人工确认 |
| 网络不稳定 | 任务失败 | 断点续传、状态保存 |

## 15. 结论

本方案采用 **LLM + Function Calling + Snapshot** 架构，符合 Playwright MCP 和 browser-use 等主流方案的设计思想，具备：

1. **语义理解能力**：支持复杂自然语言指令
2. **可扩展性**：模块化设计，易于添加新功能
3. **容错性**：完善的错误处理和恢复机制
4. **成本可控**：Token 优化和缓存策略

建议按 Phase 1 → Phase 2 的顺序逐步实现。
