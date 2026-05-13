---
name: techdoc-reviewer
description: AI 生成技术方案的质量评估与验证工具。以结构化 PRD 需求文档为基准,结合接口文档、项目知识库、实际代码和技术栈知识库(knowledge_hub),对 AI 生成的技术设计文档(techdoc.md)进行系统性评审,识别需求覆盖缺失、接口设计出入、方案与项目现实不符、技术方案不可落地、接口设计不规范、影响范围遗漏、风险评估不足、技术栈使用不规范等问题,输出带评分和改进建议的评审报告,报告与技术方案文档放在同一目录。当用户提到「评估技术方案」「验证技术设计」「检查技术方案质量」「review 技术方案」「技术方案有没有问题」「帮我看看这个 techdoc.md 写得怎么样」「技术方案评审」「AI 生成的技术方案对不对」「技术设计文档质量」「技术方案完整吗」「帮我检查一下技术方案」时立即使用此 skill。即使用户只是说「这个技术方案写得全吗」「帮我 review 一下技术设计」,也应触发此 skill。
---

# 技术方案评审 Skill

以 **PRD 需求文档 + 接口文档 + 项目知识库(knowledge_hub) + 实际代码 + UI 设计规格 + 用户自定义规范** 为六重基准,从七个核心维度评审技术方案:

- **需求覆盖度**: 是否完整覆盖 PRD 功能点
- **接口文档一致性**: 接口设计是否与实际接口文档一致
- **项目现实对齐**: 是否符合项目实际技术栈和架构
- **技术栈规范符合性**: 是否符合技术栈最佳实践
- **UI 设计一致性**: 是否符合 UI 设计规格
- **方案可落地性**: 是否具体可执行
- **工程质量**: 是否符合工程规范

> **核心设计**：评审标准与本文件分离，详见 `references/techdoc-quality-criteria.md`。
>
> **用户扩展**：评审前扫描 `.catpaw/skills/techdoc-reviewer/references/custom-*.md`，将其中的额外评审标准、检查项、最佳实践追加到评审流程中执行。

---

## 评审流程

```
Step 1: 读取评审标准
Step 2: 并行信息收集(5个subagent)
Step 3: 信息汇总
Step 4: 并行评审执行(5个subagent)
Step 5: 评审结果汇总
Step 6: 方案可落地性与工程质量评估
Step 7: 输出评审报告
Step 8: 自动修复问题
Step 9: 输出修复总结
```

---

## Step 1: 读取评审标准

读取 `references/techdoc-quality-criteria.md`,了解各维度的评审项和评分规则。

---

## Step 2: 并行信息收集(使用 subagent)

使用 Task 工具创建 5 个并行 subagent:

### 2.1 Subagent 1: prd-collector

**任务**: 获取 PRD 需求文档

**执行步骤**:
1. 按优先级查找: 用户提供的路径 > 同目录 prd.md > KM 链接
2. 提取功能点列表、验收标准、需求背景
3. 提取技术方案中已覆盖的功能点

**返回**:
```json
{
  "features": [{"name": "功能点", "acceptance": ["验收标准"], "covered": true}],
  "techdocFeatures": ["已覆盖功能点列表"],
  "questions": ["缺失信息询问"]
}
```

### 2.2 Subagent 2: api-collector

**任务**: 获取接口文档

**执行步骤**:
1. 从技术方案中提取接口文档链接
2. 如未标注,向用户询问接口文档
3. 根据链接类型获取: 学城(km CLI)、F1API/PAPI(MCP)、其他(web_fetch)
4. 解析接口路径、方法、参数、响应结构

**返回**:
```json
{
  "apis": [{
    "name": "接口名", "path": "/api/xxx", "method": "GET",
    "params": [...], "response": {...}, "docLink": "https://..."
  }],
  "skipped": false,
  "questions": []
}
```

### 2.3 Subagent 3: knowledge_hub-collector

**任务**: 从本地 knowledge_hub 目录获取项目知识库信息,包括项目架构、技术栈规范和最佳实践。

**执行步骤**:

1. **检查 knowledge_hub 目录**: 首先检查项目根目录下是否存在 `knowledge_hub` 或 `.catpaw/knowledge_hub` 目录

2. **读取索引文件**: 如果目录存在,优先读取 `INDEX.md` 了解知识库结构和检索决策树

3. **根据评审需求查询相关文档**: 从知识库中查找相关的知识文档,包括:
   - **L0-spec.md**: 项目规范与约定
   - **L1-architecture.md**: 工程架构
   - **L2-modules.md**: 功能模块知识,查找相关业务模块
   - **ORG-1.md / ORG-2.md**: 组织级基建库,了解团队和公司级规范(技术栈规范、开发指南)
   - **EXTERNAL.md**: 外部依赖(官方文档链接)

4. **获取技术栈知识**: 从知识库中提取技术栈相关信息:
   - 技术栈类型(H5/PC/Gundam 高达/Mach/MachPro)
   - 框架规范和最佳实践
   - 组件库使用指南
   - 编码规范、接口规范等

5. **备选方案**(知识库目录不存在时):
   - 检查 `.catpaw/memory-bank-local` 目录
   - 检查项目根目录的 Markdown 文件(README.md、ARCHITECTURE.md 等)
   - 从 package.json 推断技术栈,从目录结构推断架构模式

**返回**:
```json
{
  "hasKnowledge": true,
  "knowledgeSource": "knowledge_hub | memory_bank_local | project_files",
  "techStack": {"framework": "React", "version": "17+", "buildTool": "Nine CLI", "type": "H5 | PC | Gundam | Mach | MachPro"},
  "architecture": "架构描述",
  "codingStandards": ["编码规范"],
  "interfaceStandards": ["接口规范"],
  "frameworkNorms": "框架规范",
  "components": "组件使用指南",
  "bestPractices": "最佳实践",
  "questions": []
}
```

### 2.4 Subagent 4: ui-design-collector

**任务**: 获取 UI 设计规格信息

**执行步骤**:

1. **检查 UI 规格目录**: 检查 `.catpaw/docs/{需求名}/ui-specs/` 目录是否存在

2. **判断是否有 UI 规格**: 如果目录不存在或为空,设置 hasUIDesign: false 并跳过

3. **读取全局索引和概览文件**: 如果目录存在,优先读取以下文件:
   - `index.json`: 全局索引,包含所有组件的汇总信息(name/designId/layerId/dimensions)
   - `overview.md`: 整体布局概述,包含公共样式(颜色/字体/间距)、组件层级关系等

4. **分析具体 UI 规格**: ui-specs 下每个组件是一个独立子目录,结构如下:
   ```
   ui-specs/
   ├── index.json              # 全局索引
   ├── overview.md             # 整体布局概述
   ├── {ComponentName}/        # 每个组件一个独立目录
   │   ├── index.json          # 索引摘要(<2KB): meta + styleSummary + componentMapping
   │   ├── spec.json           # 样式规范: layoutStructure + modules/sections(设计稿原始数据)
   │   └── dev.json            # 开发解析(核心): componentTree + componentMapping + interactions + dataRequirements + tracking + constraints + designTokens
   ```

   根据全局索引中的组件列表,逐个读取各组件目录下的 JSON 文件:
   - 先读 `{ComponentName}/index.json` 获取轻量摘要(meta、styleSummary、componentMapping)
   - 再读 `{ComponentName}/spec.json` 获取布局结构和设计稿样式数据
   - 最后读 `{ComponentName}/dev.json` 获取开发所需的核心数据(componentTree、interactions、tracking 等)

5. **提取 UI 要素**:
   - **页面布局**: 从 spec.json 提取整体结构、区域划分、响应式需求(layoutStructure)
   - **组件清单与映射**: 从 dev.json 的 componentMapping 提取(existing 复用/new 新建/enhanced 增强)
   - **组件树**: 从 dev.json 的 componentTree 提取组件层级结构和相对布局关系
   - **样式变量**: 从 dev.json 的 designTokens 提取颜色、字体、间距、圆角等 CSS 变量定义
   - **交互状态**: 从 dev.json 的 interactions 提取事件类型、回调逻辑
   - **接口需求**: 从 dev.json 的 dataRequirements 提取请求参数、响应格式
   - **埋点规范**: 从 dev.json 的 tracking 提取埋点事件ID、参数、触发时机
   - **约束条件**: 从 dev.json 的 constraints 提取禁止事项、必须遵守项
   - **动效需求**: 从 spec.json 提取过渡动画、交互动画等

**返回**:
```json
{
  "hasUIDesign": true,
  "uiSource": "ui-specs",
  "overview": {
    "designStyle": "设计风格描述",
    "componentLibrary": "使用的组件库",
    "designTokens": { "全局设计变量" },
    "componentHierarchy": "组件层级关系"
  },
  "components": [{
    "name": "Header",
    "dir": "Header/",
    "specFile": "Header/spec.json",
    "devFile": "Header/dev.json",
    "componentMapping": { "existing": N, "new": M, "enhanced": K },
    "layout": "布局描述",
    "components": ["子组件列表"],
    "styles": { "样式变量" },
    "interactions": ["交互需求"],
    "dataRequirements": ["接口需求"],
    "tracking": ["埋点规范"],
    "constraints": ["约束条件"]
  }],
  "designTokens": {
    "colors": ["颜色变量"],
    "fonts": ["字体规范"],
    "spacing": ["间距规范"]
  },
  "questions": []
}
```

### 2.5 Subagent 5: custom-knowledge-collector

**任务**: 获取用户自定义评审规范

**执行步骤**:
1. 扫描项目 `.catpaw/skills/techdoc-reviewer/references/` 目录下的所有 `custom-*.md` 文件
2. 读取所有找到的自定义规范文件内容
3. 提取自定义评审标准、额外检查项、项目特定的评审要求、自定义评分规则等

**返回**:
```json
{
  "customCriteria": {
    "additionalStandards": "额外评审标准",
    "extraCheckItems": "额外检查项",
    "projectSpecificRules": "项目特定规则"
  },
  "hasCustomKnowledge": true
}
```

---

## Step 3: 信息汇总

汇总 5 个 subagent 的返回结果,检查是否有缺失信息:
- 如任何 subagent 的 questions 不为空,暂停并询问用户
- 信息收集完整后,直接进入 Step 4 并行评审

**应用用户自定义知识**:
- 如果 customKnowledge 中有额外的评审标准,添加到评审流程中
- 如果有项目特定的检查项,在相应评审环节中体现

**应用 UI 设计信息**:
- 如果有 UI 设计规格,在后续评审中检查技术方案是否遵循 UI 设计要求

---

## Step 4: 并行评审执行(使用 subagent)

使用 Task 工具创建 5 个并行 subagent:

### 4.1 Subagent 5: requirement-reviewer

**任务**: 需求覆盖度核查

**评审要点**:
- 功能点遗漏: PRD 有但技术方案无的功能
- 需求理解偏差: 实现逻辑与 PRD 不符
- 过度设计: PRD 未提及的功能扩展

**返回**:
```json
{
  "coverage": [{"feature": "功能点", "covered": true, "issues": []}],
  "missingFeatures": ["遗漏功能"],
  "deviations": [{"feature": "功能", "issue": "偏差说明"}],
  "overDesign": ["过度设计内容"],
  "score": 85
}
```

### 4.2 Subagent 6: interface-reviewer

**任务**: 接口文档一致性核查

**评审要点**:
- 接口路径、HTTP 方法是否一致
- 参数名称、类型、必填性是否一致
- 响应字段、枚举值是否一致
- 常见问题: 字段缺失、类型不匹配、命名不一致

**返回**:
```json
{
  "apis": [{
    "name": "接口名",
    "issues": [{
      "type": "field_missing", "severity": "high",
      "field": "字段名", "description": "问题描述"
    }]
  }],
  "score": 90
}
```

**注意**: 如接口文档被跳过,返回 `{"skipped": true}`

### 4.3 Subagent 7: project-reviewer

**任务**: 项目现实对齐核查

**评审要点**:
- 技术栈符合性: 框架版本、依赖冲突
- 目录结构规范: 文件路径、模块划分
- 接口规范: 路径风格、命名规范
- 与现有实现的一致性

**返回**:
```json
{
  "alignment": {
    "techStack": {"aligned": true, "issues": []},
    "architecture": {"aligned": true, "issues": []}
  },
  "issues": [{"type": "架构不符合", "severity": "medium", "description": "描述"}],
  "score": 88
}
```

### 4.4 Subagent 8: techstack-reviewer

**任务**: 技术栈规范符合性核查

**评审要点**:
- 框架/库使用规范: API 调用、生命周期
- 组件使用规范: props、events、废弃 API
- 最佳实践: 性能优化、错误处理、安全规范

**返回**:
```json
{
  "compliance": {
    "frameworkUsage": {"compliant": true, "issues": []},
    "componentUsage": {"compliant": true, "issues": []}
  },
  "issues": [{"type": "API错误", "severity": "high", "description": "描述"}],
  "score": 85
}
```

**注意**: 如知识库缺失,返回 `{"skipped": true}`

### 4.5 Subagent 9: ui-design-reviewer

**任务**: UI 设计一致性核查

**评审要点**:
- **组件映射一致性**: 技术方案中的组件选型是否与 UI 规格 dev.json 中 componentMapping 一致(existing 是否复用/new 是否创建/enhanced 是否增强)
- **组件树结构一致性**: 技术方案的组件层级是否与 UI 规格 dev.json 中 componentTree 一致
- **布局结构一致性**: 技术方案中的页面布局描述是否与 UI 规格 spec.json 中的 layoutStructure 一致
- **样式变量使用**: 是否正确使用了 UI 规格 dev.json 中定义的 designTokens（CSS 变量：颜色、字体、间距等）
- **交互实现完整性**: 是否覆盖了 UI 规格 dev.json 中 interactions 定义的所有事件和回调逻辑
- **接口对接一致性**: 技术方案的接口调用是否满足 UI 规格 dev.json 中 dataRequirements 定义的请求参数和响应格式
- **埋点覆盖完整性**: 是否包含 UI 规格 dev.json 中 tracking 定义的所有埋点事件和参数
- **约束条件遵守**: 是否违反了 UI 规格 dev.json 中 constraints 中定义的禁止事项
- **响应式设计**: 是否考虑了 UI 规格 spec.json 中的响应式需求
- **动效实现**: 是否考虑了 UI 规格 spec.json 中的动效需求

**返回**:
```json
{
  "uiAlignment": {
    "components": {"aligned": true, "issues": []},
    "layout": {"aligned": true, "issues": []},
    "styles": {"aligned": true, "issues": []},
    "interactions": {"aligned": true, "issues": []}
  },
  "issues": [{
    "type": "组件不一致",
    "severity": "medium",
    "description": "技术方案使用了 Button 组件,但 UI 规格中要求使用 IconButton",
    "location": "功能设计 > 按钮区域"
  }],
  "score": 90
}
```

**注意**: 如 UI 规格缺失,返回 `{"skipped": true}`

### 4.6 Subagent 10: custom-reviewer

**任务**: 用户自定义规范核查

**评审要点**:
- 基于用户自定义规范文件中的评审标准
- 检查项目特定的规则是否符合
- 验证额外的检查项是否满足

**返回**:
```json
{
  "customIssues": [{
    "type": "自定义规范类型",
    "severity": "high/medium/low",
    "description": "问题描述",
    "rule": "违反的规则"
  }],
  "customScore": 85,
  "hasCustomRules": true
}
```

**注意**: 如无自定义规范,返回 `{"skipped": true, "hasCustomRules": false}`

---

## Step 5: 评审结果汇总

汇总 5 个评审 subagent 的结果,计算加权平均分:
- 需求覆盖度: 30%
- 接口文档一致性: 20%
- 项目现实对齐: 20%
- 技术栈规范符合性: 15%
- UI 设计一致性: 10%
- 用户自定义规范: 5%(如有)

**动态权重调整**:
- 如果没有用户自定义规范,将 5% 分配给需求覆盖度
- 如果接口文档被跳过,将其权重分配给需求覆盖度
- 如果 UI 规格缺失,将其 10% 权重分配给需求覆盖度

**注意**: 方案可落地性和工程质量已整合到各评审维度中,不再单独评分。

---

## Step 6: 方案可落地性与工程质量评估

### 可落地性评估

- **具体性**: 接口路径、文件路径、函数参数是否明确
- **完整性**: 是否覆盖各层改动(组件/状态/路由)
- **可执行性**: 工作量估算、技术选型是否合理

### 工程质量评估

- **接口设计**: 请求响应结构、错误码规范
- **数据库设计**: 表结构兼容性、索引、迁移方案
- **影响范围分析**: 代码/接口/数据库影响是否完整
- **风险评估**: 风险识别、应对措施、回滚方案

---

## Step 7: 输出评审报告

评审报告保存在 `techdoc.md` 同目录下的 `techdoc-review.md`:

```
.catpaw/docs/{需求英文名}/
├── prd.md
├── techdoc.md
└── techdoc-review.md  ← 评审报告
```

> 报告格式详见 `assets/report-template.md`

---

## Step 8: 自动修复问题

评审报告生成后，**自动执行修复流程**，无需用户确认。

### 修复分类

**可自动修复**(直接修改):
- 🔴 字段缺失/类型不匹配/必填性错误
- 🔴 接口路径/HTTP 方法错误
- 🟡 命名不一致/枚举值遗漏/错误码未处理

**需标注待确认**(自动标注):
- 功能点遗漏/需求理解偏差/技术栈选型冲突/过度设计
- 自动标注「⚠️ 待确认」并说明原因

**无法自动修复**(仅标注):
- 方案不够具体/缺少接口文档/项目上下文缺失

### 修复流程

1. 读取 techdoc.md 原内容
2. 按问题严重程度排序（🔴 严重 > 🟡 一般 > 🔵 建议）
3. 定位问题章节,生成修复内容,替换原内容
4. 添加标注: `<!-- 自动修复:原因 - 时间 -->`
5. 更新评审报告,标记已修复问题

### 修复原则

- **保守原则**: 不确定时标注「⚠️ 待确认」,不擅自修改
- **最小修改**: 只修复问题,不主动优化其他内容
- **可追溯**: 所有修复都添加标注说明原因和时间

---

## Step 9: 输出修复总结

修复完成后，输出总结报告：

```text
## 📋 技术方案评审与修复完成

### 评审结果

**总分**: X/100 （判定结果）
**发现问题**: Y 个
- 🔴 严重问题: A 个
- 🟡 一般问题: B 个
- 🔵 建议改进: C 个

### 修复情况

✅ **已自动修复**: M 个问题

**修复内容摘要**:
1. [具体修复项1]
2. [具体修复项2]
...

⚠️ **待确认问题**: N 个

**待确认问题列表**:
1. [问题描述1] - 原因: [为什么需要确认]
2. [问题描述2] - 原因: [为什么需要确认]
...

### 文件更新

📄 技术方案: {techdoc.md 路径}
📄 评审报告: {techdoc-review.md 路径}

---
💡 **下一步建议**: 请查看评审报告详情，并处理待确认的问题。
```

---

## 评审原则

**六重基准优先级**: PRD > 接口文档 > UI 设计规格 > 项目知识库(knowledge_hub) > 用户自定义规范 > 工程规范

**问题分类**:
- 需求覆盖问题 → 补充/修正技术设计
- 接口一致性问题 → 按接口文档修正
- UI 设计一致性问题 → 按 UI 规格修正
- 项目对齐问题 → 按项目实际情况修正
- 技术栈规范问题 → 按知识库规范修正
- 方案质量问题 → 细化技术设计
- 工程规范问题 → 按规范修正
- 自定义规范问题 → 按项目特定规则修正

**三重校验**: 同时验证技术方案是否与 PRD 需求、UI 设计规格、项目知识库(knowledge_hub)相符。

**可操作建议**: 每个问题都要说明怎么改,并给出修复示例。

**关注落地性**: 站在「开发能否直接按文档动手」的角度评审。
