# 记忆管理系统设计方案

## 概述

三层记忆架构：短期记忆（会话内）+ 中期记忆（反思约束）+ 长期记忆（跨会话）

---

## 1. 短期记忆（滑动窗口）

### 目标
- 限制发送给 LLM 的上下文长度
- 保持最近 N 轮对话的完整内容
- 对历史消息进行智能压缩

### 设计

```typescript
interface ShortTermMemory {
  // 完整保留的最近消息数（双边对话算一轮）
  fullContextRounds: number  // 默认 5
  
  // 消息压缩策略
  compressionStrategy: 'summary' | 'keypoints' | 'hierarchical'
  
  // 压缩后的消息存储
  compressedMessages: CompressedMessage[]
}

interface CompressedMessage {
  id: string
  originalRound: number      // 原始轮次
  summary: string            // 摘要内容
  keyInfo: KeyInfo[]         // 关键信息提取
  toolCallResults?: string[] // 工具调用结果（保留成功结果）
  timestamp: number
}

interface KeyInfo {
  type: 'fact' | 'action' | 'result' | 'error'
  content: string
  importance: number  // 0-1
}
```

### 压缩策略

#### 策略 A: 总结模式（Summary）
- 对超过窗口的消息生成段落摘要
- 保留用户原始意图和最终结果

#### 策略 B: 关键点模式（KeyPoints）
- 提取关键事实、操作、结果
- 结构化存储，便于检索

#### 策略 C: 分层模式（Hierarchical）
- 第一层：最近 N 轮完整内容
- 第二层：摘要形式的中期历史
- 第三层：只保留关键事实的远期历史

### 触发时机
- 每轮对话结束后检查消息数量
- 超过阈值时触发压缩
- 压缩后更新上下文构建逻辑

---

## 2. 中期记忆（反思模式）

### 目标
- 每轮会话结束后自动反思
- 提取成功经验和失败教训
- 生成约束规则更新系统 Prompt
- 避免重复犯错

### 设计

```typescript
interface ReflectionMemory {
  sessionId: string
  createdAt: number
  
  // 反思结果
  reflection: {
    successes: SuccessPattern[]    // 成功经验
    failures: FailurePattern[]     // 失败教训
    improvements: string[]         // 改进建议
  }
  
  // 生成的约束规则
  constraints: Constraint[]
  
  // 应用于哪些后续会话
  scope: 'global' | 'similar' | 'none'
}

interface SuccessPattern {
  scenario: string       // 什么场景
  action: string         // 采取了什么行动
  result: string         // 取得了什么结果
  reusable: boolean      // 是否可复用
}

interface FailurePattern {
  scenario: string       // 什么场景
  error: string          // 犯了什么错误
  rootCause: string      // 根本原因
  prevention: string     // 如何预防
}

interface Constraint {
  id: string
  type: 'must' | 'must_not' | 'should' | 'avoid'
  content: string        // 约束内容
  reason: string         // 原因（引用反思结果）
  priority: number       // 优先级 1-10
  active: boolean        // 是否启用
  createdAt: number
  usageCount: number     // 应用次数（用于评估效果）
}
```

### 反思流程

1. **会话结束触发**
   - 用户主动关闭会话
   - 或会话超时/完成

2. **反思分析**
   ```
   输入：完整会话历史
   输出：
   - 成功模式识别
   - 失败模式识别  
   - 改进建议生成
   - 约束规则提取
   ```

3. **Prompt 更新**
   - 将约束规则注入系统 Prompt
   - 按优先级排序
   - 限制约束数量（避免过长）

### 约束规则示例

```
【系统自动添加的约束规则】

✓ 成功经验：
1. 使用 browser_ai 工具访问网站时，到达目标后无需进一步分析页面内容
   （基于历史成功模式 #3）

✗ 避免错误：
2. 禁止在搜索结果页面尝试点击不存在的 "Next" 按钮进行翻页
   （基于历史失败模式 #2，发生过 3 次）

⚠ 注意事项：
3. 执行 bash 命令前，先检查是否为危险命令
   （优先级：8/10）
```

---

## 3. 长期记忆（跨会话历史）

### 目标
- 持久化存储关键会话信息
- 支持语义检索相关历史
- 为新会话提供上下文

### 设计

```typescript
interface LongTermMemory {
  // 会话元数据（轻量）
  sessions: SessionMeta[]
  
  // 知识图谱
  knowledgeGraph: KnowledgeGraph
  
  // 嵌入向量存储（用于语义检索）
  vectorStore: VectorStore
}

interface SessionMeta {
  id: string
  title: string
  summary: string           // 会话总结
  keyTopics: string[]       // 关键主题
  successfulTools: string[] // 成功使用的工具
  createdAt: number
  updatedAt: number
  messageCount: number
}

interface KnowledgeGraph {
  entities: Entity[]        // 实体（人、地点、概念等）
  relations: Relation[]     // 关系
}

interface Entity {
  id: string
  name: string
  type: 'person' | 'place' | 'concept' | 'tool' | 'website'
  mentions: number          // 提及次数
  firstSeen: number
  lastSeen: number
}

interface Relation {
  from: string              // entity id
  to: string                // entity id
  type: string              // 关系类型
  count: number
}
```

### 存储方案

```
数据目录结构：
~/.auto-agent/memory/
├── sessions/              # 会话元数据
│   ├── session-xxx.json
│   └── ...
├── reflections/           # 反思结果
│   ├── reflection-xxx.json
│   └── ...
├── constraints.json       # 约束规则库
├── knowledge-graph.json   # 知识图谱
└── vectors/               # 向量数据库
    └── embeddings.index
```

### 检索机制

1. **启动时加载**
   - 加载所有约束规则
   - 加载最近 N 个会话的摘要

2. **运行时检索**
   - 用户输入时，语义检索相关历史会话
   - 如果有高度相关的结果，注入到上下文中

3. **相似度匹配**
   ```typescript
   interface SimilarSession {
     sessionId: string
     similarity: number      // 0-1
     relevantMessages: Message[]  // 相关消息片段
   }
   ```

---

## 4. 集成方案

### 与 AgentLoop 集成

```typescript
class AgentLoop {
  private shortTermMemory: ShortTermMemory
  private reflectionEngine: ReflectionEngine
  private longTermMemory: LongTermMemory
  
  constructor(sessionId: string, userId: string, config: AgentLoopConfig) {
    // ... 现有代码 ...
    
    // 初始化记忆系统
    this.shortTermMemory = new ShortTermMemory({
      fullContextRounds: 5,
      compressionStrategy: 'hierarchical'
    })
    
    this.reflectionEngine = new ReflectionEngine()
    this.longTermMemory = LongTermMemory.getInstance(userId)
    
    // 加载适用的约束规则
    this.loadConstraints()
  }
  
  private buildContext(): Message[] {
    // 构建动态系统 Prompt（包含约束规则）
    const dynamicSystemPrompt = this.buildDynamicSystemPrompt()
    
    // 获取压缩后的消息历史
    const compressedHistory = this.shortTermMemory.getCompressedMessages()
    
    // 检索相关长期记忆
    const relevantMemories = this.longTermMemory.retrieveRelevant(
      this.getLastUserInput()
    )
    
    return [
      { role: 'system', content: dynamicSystemPrompt },
      ...relevantMemories,
      ...compressedHistory
    ]
  }
  
  async onSessionEnd(): Promise<void> {
    // 触发反思
    const reflection = await this.reflectionEngine.reflect(
      this.state.messages
    )
    
    // 保存到长期记忆
    await this.longTermMemory.saveSession({
      id: this.state.sessionId,
      summary: reflection.summary,
      // ...
    })
    
    // 更新约束规则
    await this.reflectionEngine.updateConstraints(reflection)
  }
}
```

### 动态系统 Prompt 构建

```typescript
private buildDynamicSystemPrompt(): string {
  const basePrompt = this.getDefaultSystemPrompt()
  
  // 添加约束规则
  const constraints = this.constraintStore.getActiveConstraints()
  const constraintPrompt = this.formatConstraints(constraints)
  
  // 添加相关长期记忆（如果有）
  const relevantContext = this.longTermMemory.getRelevantContext()
  
  return `${basePrompt}

${constraintPrompt}

${relevantContext}`
}
```

---

## 5. 实现优先级

### Phase 1: 短期记忆（滑动窗口）
- [ ] 实现消息压缩策略
- [ ] 修改 buildContext() 使用压缩后的消息
- [ ] 添加配置项控制窗口大小

### Phase 2: 中期记忆（反思模式）
- [ ] 实现反思引擎
- [ ] 设计约束规则存储
- [ ] 修改系统 Prompt 动态注入约束

### Phase 3: 长期记忆（跨会话）
- [ ] 实现会话摘要生成
- [ ] 设计存储格式和目录结构
- [ ] 实现语义检索（可选，需要向量数据库）

---

## 6. 配置选项

```typescript
interface MemoryConfig {
  shortTerm: {
    enabled: boolean
    fullContextRounds: number      // 默认 5
    compressionStrategy: 'summary' | 'keypoints' | 'hierarchical'
    maxTokens: number              // 最大上下文 token 数
  }
  
  reflection: {
    enabled: boolean
    autoTrigger: boolean           // 会话结束时自动反思
    maxConstraints: number         // 最大约束规则数（默认 10）
    minConfidence: number          // 生成约束的最小置信度
  }
  
  longTerm: {
    enabled: boolean
    storagePath: string
    maxStoredSessions: number      // 保留的会话数
    enableVectorSearch: boolean    // 是否启用向量检索
  }
}
```
