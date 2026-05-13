---
name: techdoc-generator
description: 前端技术方案自动生成工具。根据需求文档(PRD)、项目知识库和接口文档,自动生成结构完整的前端技术方案,包含功能设计、影响范围分析、稳定性保障、工时评估等章节,输出到项目 .catpaw/docs/{需求名}/ 目录。当用户提到「生成技术方案」「写技术方案」「帮我出技术方案」「技术方案生成」「根据需求写方案」「帮我写前端技术方案」「出一份技术设计文档」「techdoc」「技术设计」时立即使用此 skill。即使用户只是说「帮我把这个需求转成技术方案」「这个 PRD 怎么实现」,也应触发此 skill。
---

# 技术方案生成器

先并行收集需求文档(PRD)、接口文档、项目知识库(knowledge_hub)、UI设计信息和用户自定义知识,汇总确认后生成结构完整的前端技术方案文档,输出到 `.catpaw/docs/{需求名}/techdoc.md`。

> **核心设计**：方案模板与本文件分离，详见 `assets/techdoc-template.md`。
>
> **用户扩展**：生成方案前扫描 `.catpaw/skills/techdoc-generator/references/custom-*.md`，将其中的额外技术方案规范、章节模板、最佳实践追加到生成流程中执行。

---

## 执行流程总览

```
Step 1: 并行信息收集(使用 subagent)
  ├─ Subagent 1: 收集需求信息(PRD)
  ├─ Subagent 2: 收集接口文档
  ├─ Subagent 3: 获取项目知识库(knowledge_hub)
  ├─ Subagent 4: 分析 UI 设计信息
  └─ Subagent 5: 获取用户自定义知识

Step 2: 信息汇总与确认
Step 3: 生成技术方案
Step 4: 输出文档
```

---

## Step 1: 并行信息收集(使用 subagent)

**重要说明**:
- 使用 Task 工具创建 5 个并行的 subagent
- 每个 subagent 独立执行,互不依赖
- 所有 subagent 完成后,汇总结果进入 Step 2
- subagent 类型统一使用 `general-agent`

### 1.1 创建并行 Subagent

使用 Task 工具在单次消息中创建 5 个 subagent(一次性调用):

```
使用 Task 工具,一次性创建 5 个 subagent:
1. prd-collector - 收集需求信息
2. api-collector - 收集接口文档
3. knowledge_hub-collector - 获取项目知识库(knowledge_hub)
4. ui-design-collector - 分析 UI 设计信息
5. custom-knowledge-collector - 获取用户自定义知识
```

### 1.2 Subagent 1: 收集需求信息(PRD)

**任务**: 收集和分析 PRD 需求文档,提取关键要素。

**执行步骤**:
1. **询问需求来源**: 向用户询问需求来源,支持 KM 文档链接、ONES 工作项链接或 ID、直接粘贴内容、已有 prd.md 文件路径
2. **提取关键信息**: 需求名称、背景与目标、功能点列表、涉及的页面/组件、端支持范围、PM 信息等
3. **返回结果**: 将收集到的信息整理返回,如果用户未提供需求来源,在 questions 字段中询问用户

### 1.3 Subagent 2: 收集接口文档

**任务**: 收集和解析接口文档。

**执行步骤**:
1. **询问接口文档**: 支持学城链接、F1API/PAPI 链接、Swagger/YApi/Apifox 链接、Mock 链接或直接描述
2. **判断是否跳过**: 只有当用户明确回复"跳过"、"暂无"、"没有"时,才能跳过
3. **获取并解析接口文档**: 根据链接类型使用对应的 MCP 工具获取
4. **返回结果**: 包含接口名称、路径、方法、参数、响应、文档链接等信息

### 1.4 Subagent 3: 获取项目知识库(knowledge_hub)

**任务**: 从本地 knowledge_hub 目录获取项目知识库信息,建立对项目的基本认知和技术栈规范。

**执行步骤**:

1. **检查 knowledge_hub 目录**: 首先检查项目根目录下是否存在 `knowledge_hub` 或 `.catpaw/knowledge_hub` 目录

2. **读取索引文件**: 如果目录存在,优先读取 `INDEX.md` 了解知识库结构和检索决策树

3. **根据需求主题查询相关文档**: 从知识库中查找相关的知识文档,包括:
   - **L0-spec.md**: 项目规范与约定
   - **L1-architecture.md**: 工程架构
   - **L2-modules.md**: 功能模块知识,查找相关业务模块
   - **ORG-1.md / ORG-2.md**: 组织级基建库,了解团队和公司级规范(技术栈规范、开发指南)
   - **EXTERNAL.md**: 外部依赖(官方文档链接)

4. **获取技术栈知识**: 从知识库中提取技术栈相关信息:
   - 技术栈类型(H5/PC/Gundam 高达/Mach/MachPro)
   - 框架规范和最佳实践
   - 组件库使用指南
   - 路由配置、埋点规范、监控配置等

5. **备选方案**(知识库目录不存在时):
   - 检查 `.catpaw/memory-bank-local` 目录
   - 检查项目根目录的 Markdown 文件(README.md、ARCHITECTURE.md 等)
   - 从 package.json 推断技术栈,从目录结构推断架构模式

**收集要点**: 技术栈、项目架构、编码规范、公共组件、接口调用方式、部署方式、开发规范、组件库文档

**返回结果结构**:
```json
{
  "hasKnowledge": true/false,
  "knowledgeSource": "knowledge_hub/memory_bank_local/project_files",
  "techStack": { "技术栈信息" },
  "architecture": { "架构信息" },
  "modules": { "相关业务模块" },
  "norms": { "规范和约定" },
  "questions": ["待确认问题列表"]
}
```

### 1.5 Subagent 4: 分析 UI 设计信息

**任务**: 自动查找并分析 UI 设计信息,提取 UI 相关的技术要求。

**执行步骤**:

1. **检查 UI 规格目录**: 检查 `.catpaw/docs/{需求名}/ui-specs/` 目录是否存在

2. **判断是否有 UI 规格**: 如果目录不存在或为空,设置 hasUIDesign: false 并跳过

3. **读取全局索引和概览文件**: 如果目录存在,优先读取以下文件进行总体分析:
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
   - **组件清单**: 从 dev.json 的 componentMapping 提取(existing 复用/new 新建/enhanced 增强)
   - **组件树**: 从 dev.json 的 componentTree 提取组件层级结构和相对布局关系
   - **样式变量**: 从 dev.json 的 designTokens 提取颜色、字体、间距、圆角等 CSS 变量定义
   - **交互状态**: 从 dev.json 的 interactions 提取事件类型、回调逻辑
   - **接口需求**: 从 dev.json 的 dataRequirements 提取请求参数、响应格式
   - **埋点规范**: 从 dev.json 的 tracking 提取埋点事件ID、参数、触发时机
   - **约束条件**: 从 dev.json 的 constraints 提取禁止事项、必须遵守项
   - **动效需求**: 从 spec.json 提取过渡动画、交互动画等

**返回结果结构**:
```json
{
  "hasUIDesign": true/false,
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

### 1.6 Subagent 5: 获取用户自定义知识

**任务**: 从项目的用户扩展文件中获取自定义技术方案规范。

**执行步骤**:
1. **扫描自定义规范文件**: 扫描项目 `.catpaw/skills/techdoc-generator/references/` 目录下的所有 `custom-*.md` 文件
2. **读取自定义规范文件**: 如果找到文件,读取所有 `custom-*.md` 文件内容
3. **整理自定义知识**: 提取自定义技术方案章节模板、项目特定的技术方案规范、额外的影响范围分析要求、项目特定的稳定性保障措施、自定义工时评估标准等
4. **返回结果**: 如果没有找到自定义文件,设置 hasCustomKnowledge: false

---

## Step 2: 信息汇总与确认

### 2.1 汇总所有 Subagent 结果

汇总所有 subagent 的返回结果,包含 prd、api、knowledgeHub、uiDesign、customKnowledge 五个部分。

### 2.2 展示汇总信息

将收集到的信息整理后展示给用户:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 信息收集汇总
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【需求信息】
- 需求名称: {requirementName}
- 需求背景: {background}
- 功能点: {features}
- 端支持: {platforms}

【接口信息】
| 序号 | 接口名称 | 接口路径 | 方法 | 文档来源 |
|-----|---------|---------|------|---------|
| 1 | xxx | /api/xxx | GET | [学城文档](链接) |

【知识库信息】
- 知识来源: {knowledgeSource}
- 技术栈: {techStack}
- 架构: {architecture}
- 框架规范: {framework 规范}
- 组件库: {components 指南}

【UI 设计信息】{如果有设计稿}
- 设计来源: {uiSource}
- 页面数量: {pages.length}
- 主要组件: {主要组件列表}
- 设计规范: {designTokens 摘要}

{如果有用户自定义知识}
【用户自定义规范】
- 自定义章节: {additionalSections}
- 项目特定规范: {specificNorms}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【待确认问题】
【需求相关】[列出 prd subagent 返回的 questions,如无则显示"无"]
【接口相关】[列出 api subagent 返回的 questions,如无则显示"无"]
【知识库相关】[列出 knowledgeHub subagent 返回的 questions,如无则显示"无"]
【UI设计相关】[列出 uiDesign subagent 返回的 questions,如无则显示"无"]
【自定义规范相关】[列出 customKnowledge subagent 返回的 questions,如无则显示"无"]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
请确认以上信息是否正确?
- 回复「确认」或「y」开始生成技术方案
- 如有遗漏或错误,请告知我进行修正
- 如有待确认问题,请提供相关信息
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**⚠️ 停止执行,等待用户确认。未经用户确认,不得进入 Step 3。**

### 2.3 处理用户回复

1. **用户确认无误** → 进入 Step 3 生成技术方案
2. **用户指出问题** → 根据用户反馈修正信息,再次展示汇总信息请求确认
3. **用户补充信息/回答问题** → 更新汇总信息,再次请求确认

---

## Step 3: 生成技术方案

基于收集到的信息(项目知识库 knowledge_hub、需求信息、接口文档、UI 设计信息、用户自定义知识),按照 `assets/techdoc-template.md` 中的模版结构生成技术方案。

### 3.1 生成原则

**功能设计**:
- 为每个功能点绘制流程图(使用 Mermaid 语法)
- 核心业务逻辑要详细描述实现思路,不能只写"按需求实现"
- 接口调用要说明参数映射、数据转换、错误处理,并附上接口文档链接
- 埋点设计要列出具体的埋点事件和参数
- UI 设计要结合设计稿分析结果,说明组件选型、样式实现方案

**影响范围分析**(重点):
- 主动分析本次改动可能影响的其他业务场景
- 考虑共用组件的改动影响、公共工具函数的改动影响、接口变更对其他调用方的影响、样式改动的全局影响
- 对每个影响点给出风险等级(高/中/低)和解决预案
- 需要周知的其他业务方要明确列出

**自查 Checklist**:
- 根据项目知识库中的规范,填写具体的自查项
- 对每个 checklist 项给出"涉及/不涉及"的初步判断和说明

**稳定性保障**:
- 版控方案: 根据端支持范围判断是否需要版控
- 合规评估: 是否涉及隐私 API、用户数据收集
- 风控风险: 是否涉及支付、优惠券等风控敏感场景
- 容灾容错: 识别核心依赖,设计降级方案
- 监控告警: 列出需要监控的关键指标
- 上线/灰度方案: 根据改动范围制定灰度策略
- 止损方案: 明确回滚步骤

**工时评估**:
- 按模块拆分工时
- 包含: 开发、自测、联调、灰度观察等阶段
- 给出合理的时间节点

**应用 UI 设计信息**:
- 如果有 UI 设计信息,在技术方案中增加 UI 实现章节
- 说明组件选型与设计稿的对应关系
- 提取设计 token,说明样式变量方案
- 描述交互状态和动效实现方案

**应用用户自定义知识**:
- 如果 customKnowledge 中有自定义章节模板,添加到技术方案中
- 如果有项目特定规范,在相应章节中体现
- 如果有额外的影响范围分析要求,补充到影响范围分析章节
- 如果有项目特定的稳定性保障措施,补充到稳定性保障章节

### 3.2 模版参考

详见 `assets/techdoc-template.md`,严格按照模版章节结构输出。

---

## Step 4: 输出文档

### 4.1 确定输出路径

```
{workspace}/.catpaw/docs/{需求名}/techdoc.md
```

其中 `{需求名}` 取自需求文档标题,去除特殊字符,使用中文或英文均可,保持简洁。

### 4.2 创建目录并写入

```bash
mkdir -p .catpaw/docs/{需求名}/
```

然后将生成的技术方案写入 `techdoc.md`。

### 4.3 输出后告知用户

- 文件路径(绝对路径)
- 文档结构概览(各章节标题)
- 需要用户补充/确认的内容(如: 接口文档待补充、工时需要确认等)

### 4.4 自动调用质量评审并修复

技术方案输出完成后，**自动启动 subagent 调用 `techdoc-reviewer` skill 进行方案评审，并根据评审结果自动修复问题**，无需用户确认。

**调用方式**：使用 `task` 工具启动 `general-agent` subagent，执行完整的 techdoc-reviewer 评审和修复流程：

```json
{
  "subagent_type": "general-agent",
  "description": "技术方案质量评审与自动修复",
  "prompt": "你是技术方案质量评审专家。请执行 techdoc-reviewer skill 对刚生成的技术方案进行质量评审，并根据评审结果自动修复问题。

任务要求：
1. 读取刚生成的技术方案文档：{workspace}/.catpaw/docs/{需求名}/techdoc.md
2. 读取原始需求文档（PRD）：{prd.md 路径}
3. 读取项目知识库：{knowledge_hub 路径}
4. 按评审维度评估：需求覆盖度、接口文档一致性、项目现实对齐、技术栈规范符合性、方案可落地性
5. 输出评审报告到：{workspace}/.catpaw/docs/{需求名}/techdoc-review.md
6. **自动修复问题**：根据评审报告中发现的问题，自动修复技术方案文档（techdoc.md）
7. 更新评审报告，标记已修复的问题

请严格按照 techdoc-reviewer skill 的流程执行评审和修复，techdoc-reviewer skill 已包含自动修复流程，请完整执行。"
}
```

**评审维度**:
- 需求覆盖度：是否完整覆盖 PRD 功能点
- 接口文档一致性：接口设计是否与实际接口文档一致
- 项目现实对齐：是否符合项目实际技术栈和架构
- 技术栈规范符合性：是否符合技术栈最佳实践
- 方案可落地性：是否具体可执行

**自动修复规则**:
- 🔴 严重问题（字段缺失、接口路径错误等）：直接修复
- 🟡 一般问题（命名不一致、枚举遗漏等）：直接修复
- 🔵 建议改进：视情况修复或标注待确认
- 无法确定的问题：标注「⚠️ 待确认」并说明原因

**评审和修复完成后输出**:

```text
## 📋 技术方案生成、评审与修复完成

### 技术方案

📄 文件路径: {techdoc.md 路径}
📊 文档结构: [各章节标题]

### 评审结果

📄 评审报告: {techdoc-review.md 路径}
📈 评审总分: X/100
⭐ 评审结论: [通过/基本通过/需改进/不通过]

### 问题修复情况

✅ **已自动修复**: M 个问题

**修复内容摘要**:
1. [具体修复项1]
2. [具体修复项2]
...

⚠️ **待确认问题**: N 个（已标注在文档中）

**待确认问题列表**:
1. [问题描述1] - 原因: [为什么需要确认]
2. [问题描述2] - 原因: [为什么需要确认]
...

### 文件更新

📄 技术方案（已修复）: {techdoc.md 路径}
📄 评审报告: {techdoc-review.md 路径}

---
💡 **下一步建议**: 请查看评审报告详情，并处理文档中标注为「⚠️ 待确认」的问题。
```

---

## 注意事项

1. **并行执行效率**: 使用 subagent 并行收集信息可以显著提高效率,但要确保每个 subagent 的任务边界清晰,避免重复工作。

2. **用户确认节点**: 
   - 接口文档确认是必须的
   - 技术栈识别确认是可选的(识别明确时不需要)
   - 缺失信息必须向用户询问

3. **不要生成空洞的模版占位符**: 每个章节都要基于实际需求填写有意义的内容,而不是复制模版中的示例文字。

4. **影响范围分析要主动**: 不要等用户提,要主动分析改动的波及范围,这是技术方案质量的核心体现。

5. **接口文档是关键输入**: 如果用户没有提供接口文档,要明确提示,并在技术方案中标注"待接口文档确认"的部分。

6. **接口文档链接必须标注**: 在技术方案中描述接口调用时,必须在接口路径旁边标注接口文档链接(学城/F1API/PAPI),方便后续查阅和对齐。

7. **与项目现实对齐**: 技术方案中的实现方式要与项目已有的技术栈、架构模式保持一致,不要引入项目中没有的技术。

8. **工时要合理**: 基于功能复杂度给出合理工时,不要过于乐观也不要过于保守。

9. **充分利用知识库**: 项目知识库(knowledge_hub)是确保技术方案符合团队规范的重要依据,在生成方案时要主动引用相关规范和最佳实践。

10. **知识库查询策略**: 优先查询本地 `knowledge_hub` 目录,按照 INDEX.md 的检索决策树查找相关文档,避免盲目搜索。

11. **技术方案要落地**: 结合知识库中的最佳实践和项目实际情况,确保技术方案可落地、可执行。
