---
name: ui-driven-development
description: UI 驱动开发流程。适用于 UI 相关开发场景，自动执行完整开发流程：解析任务 → 知识获取 → 复用现有组件 + 创建新组件 + 实现样式 → 交互与接口开发 → 代码评审 → 测试执行。当用户提到「UI 开发」「页面开发」「组件开发」「开发页面任务」「开发组件任务」时使用。
---

# UI 驱动开发流程

## ⚠️ 核心执行规则（优先级最高）

1. **顺序执行**：Step 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8，禁止跳步、合并或重排序
2. **Step 3 无设计稿时必须停止**：若无设计稿来源，必须停止并提示用户
3. **等待子 skill 确认**：调用  `unit-test-generator` 后，必须等待 `✓ {skill-name} 完成`
4. **每步完成后输出确认**：每个 Step 完成后必须输出 `✓ Step X 完成：[具体产出]`
5. **Step 7 必须执行测试**：即使认为"代码很简单不需要测试"，也必须执行
6. **Step 8 知识库更新**：测试通过后询问是否更新项目知识库
7. **任何步骤失败立即停止**：输出错误原因，不继续后续步骤

---

## 执行流程总览

Step 1: 解析任务信息
↓
Step 2: 知识获取
↓
Step 3: 获取 UI 规格（使用已有 ui-specs）
↓
Step 4: 复用现有组件 + 创建新组件 + 实现样式
↓
Step 5: 交互与接口开发
↓
Step 6: 代码评审
↓
Step 7: 测试执行
↓
Step 8: 知识库更新

---

## Step 1：解析任务信息

<workflow>
  <step id="1" name="解析任务信息" required="true">
    <action>读取 tasks.md，提取任务详情</action>

    <substeps>
      <substep id="1.1">从用户输入提取任务 ID 或搜索匹配任务标题</substep>
      <substep id="1.2">读取 `.catpaw/docs/{需求名}/tasks.md` 对应章节</substep>
      <substep id="1.3">验证任务类型为 page 或 component（UI 任务）</substep>
      <substep id="1.4">提取任务模块路径</substep>
    </substeps>

    <completion_criteria>
      - 任务 ID、标题、类型、模块路径均已提取
      - 任务类型已确认为 UI 任务
    </completion_criteria>

    <output_format>✓ Step 1 完成：任务 {task_id} 类型为 {type}，模块路径 {module_path}</output_format>

    <error_handling>
      若任务不是 UI 类型：提示用户使用 logic-driven-development，停止执行
      若任务不存在：输出错误，停止执行
    </error_handling>
  </step>
</workflow>

---

## Step 2：知识获取

### Phase 1：创建任务目录和初始化开发指南

```bash
mkdir -p .catpaw/docs/{需求名}/{task_id}
```

初始化开发指南文件 `.catpaw/docs/{需求名}/{task_id}/dev-guide.md`，包含占位章节：任务信息、技术方案要求、项目知识库要点、代码风格参考、用户扩展规范（各 Agent 依次补充）。

### Phase 2：并行获取知识 + 主 Agent 统一写入

**⚠️ 禁止让多个 Agent 并行写入同一个文件！Agent 只返回内容，由主 Agent 统一写入。**

**并行调用 Agent 获取知识**：

| Agent | 职责 | 知识来源 | 补充章节 |
|-------|------|----------|----------|
| Agent 1 | 技术方案解析 | `.catpaw/docs/{需求名}/techdoc.md` | 技术方案要求 |
| Agent 2 | 项目知识库检索 | `knowledge_hub/` 目录 | 项目知识库要点 |
| Agent 3 | 代码风格参考 | 现有代码分析 | 代码风格参考 |
| Agent 4 | 用户扩展知识 | 自定义规范文件 | 用户扩展规范 |

**Agent 2 知识库检索范围**：INDEX.md → EXTERNAL.md → ORG-1.md(公司基建) → ORG-2.md(团队基建) → L0-spec.md(规范) → L1-architecture.md(架构) → L2-modules.md(业务) → L3-process.md(流程) → L4-ops.md(运维) → L5-onboarding.md(入门) → L6-experience.md(经验)

**按任务类型检索重点**：UI 组件→组件规范+样式+Roo API；页面→L1架构+路由+状态管理；API→L2接口+请求封装；埋点→灵犀规范

**所有 Agent 返回后，主 Agent 将各 Agent 内容替换对应占位符，一次性写入开发指南文件。**

<output_format>✓ Step 2 完成：知识获取完成，开发指南已输出</output_format>

---

## Step 3：获取 UI 规格（使用已有 ui-specs）

> **说明**：UI 解析已在设计稿确认阶段完成（通过 ingee-batch-analyzer / mastergo-batch-analyzer），输出到 `ui-specs/` 目录。本步骤直接定位并使用对应的组件目录。

### ui-specs 目录结构（由 batch-analyzer 生成）

```
.catpaw/docs/{需求名}/ui-specs/
├── index.json              ← 全局索引（所有组件汇总，含 name/designId/layerId/dimensions）
├── overview.md             ← 整体布局概述（公共样式、组件层级关系）
├── {ComponentName}/        ← 每个组件一个独立目录
│   ├── index.json          ← 索引摘要（<2KB）：meta + styleSummary + componentMapping + files指针
│   ├── spec.json           ← 样式规范（设计稿原始数据）：meta + layoutStructure + modules/sections
│   └── dev.json            ← 开发解析（核心开发数据）：componentTree + componentMapping + interactions + dataRequirements + tracking + constraints + designTokens
```

### 3.1 定位 UI 规格文件

```bash
# 1. 先读取全局索引，了解所有可用组件
ls .catpaw/docs/{需求名}/ui-specs/index.json 2>/dev/null

# 2. 查看 ui-specs 下有哪些组件目录
ls -d .catpaw/docs/{需求名}/ui-specs/*/ 2>/dev/null
```

**根据任务信息匹配对应的组件目录**：

- 按 task_id / 组件名 / 任务标题匹配 `ui-specs/` 下的**组件子目录**（如 `ui-specs/Header/`、`ui-specs/ProductList/`）
- 若有多个组件目录，根据任务模块路径和组件名称精确匹配
- 优先读取全局索引 `index.json` 快速定位目标组件

### 3.2 读取并验证 UI 规格文件

读取匹配到的组件目录下的 JSON 文件，验证是否包含开发所需字段：

**① 先读 index.json（轻量入口）**：确认 meta 信息和 componentMapping 概览

**② 再读 spec.json（样式规范）**：获取布局结构和设计稿原始样式数据

**③ 最后读 dev.json（开发解析，核心文件）**：获取开发所需的所有字段

| 必备字段（dev.json） | 说明 |
|---------|------|
| componentTree | 组件树结构（含坐标转换后的相对布局） |
| componentMapping | 组件映射（existing 复用/new 新建/enhanced 增强） |
| interactions | 交互事件列表（事件类型、回调逻辑） |
| dataRequirements | 接口数据需求（请求参数、响应格式） |
| tracking | 埋点规范（事件ID、参数、触发时机） |
| constraints | 开发约束（禁止事项、必须遵守项） |
| designTokens | 设计令牌（颜色变量、字体变量、间距变量等 CSS 变量定义） |

**若字段完整** → 直接使用，后续 Step 4/5/6 分别引用对应字段

**若字段缺失或无 ui-specs 目录** → 提示用户先执行设计稿确认（ingee-batch-analyzer / mastergo-batch-analyzer）

<completion_criteria>
- 已定位到对应任务的 UI 规格文件
- 文件包含完整的开发所需字段（componentTree、componentMapping、layout、styles）
</completion_criteria>

<output_format>✓ Step 3 完成：UI 规格文件已就绪，{file_path}</output_format>

<error_handling>
若无 ui-specs 文件：提示用户先执行设计稿确认步骤
若字段缺失：提示用户重新执行 batch-analyzer 解析
</error_handling>

---

## Step 4：复用现有组件 + 创建新组件 + 实现样式

> **⚠️ 执行顺序强制要求**：必须按 4.1 → 4.2 → 4.3 → 4.4 顺序执行。**禁止跳过 4.2 直接进入 4.3**。即使 componentMapping.existing 只有一个按钮或一个小组件，也必须先完成复用再创建新组件。

<workflow>
  <step id="4" name="复用现有组件+创建新组件+实现样式" required="true">
    <action>基于开发指南（dev-guide.md）和 UI 规格文件（Step 3 定位的 ui-specs/ 下的 JSON），依次完成：复用现有组件 → 创建新组件 → 实现样式。所有组件开发必须遵循 componentMapping 中的映射关系，样式必须使用 styles 中定义的 CSS 变量，禁止违反 constraints 中的约束项。</action>

    <substeps>
      <substep id="4.1">读取开发指南 `.catpaw/docs/{需求名}/dev-guide.md` 和 UI 规格文件（Step 3 定位的 ui-specs/ 下的 JSON）</substep>

      <substep id="4.2">复用现有组件：按 `componentMapping.existing` 中指定的 `path` 和 `props` 使用，不要重复造轮子
        **⚠️ 本步骤为强制执行步骤，不可跳过。**

        **执行 checklist（逐项确认）**：
        - [ ] 读取 `componentMapping.existing` 数组，确认有哪些可复用组件
        - [ ] 对每个 existing 组件：
          - [ ] 在代码中 import 对应组件（如 `import Button from '@standard-components/Button'`）
          - [ ] 按 `props` 字段传入参数（type、size、width、children、onClick 等）
          - [ ] 如需样式差异覆盖，通过 `className` 注入自定义样式类（**禁止用原生 HTML 标签重新实现**）
          - [ ] 记录该组件的复用信息
        - [ ] 如果 `componentMapping.existing` 为空数组，记录"无现有组件需复用"并说明原因

        **❌ 常见错误警示**：
        - ❌ **禁止**：将 `componentMapping.existing` 中标注的组件用原生 HTML（如 `<button>`、`<div>`）重新实现
        - ❌ **禁止**：因为"组件样式不匹配"就放弃复用——应通过 className/style prop 覆盖差异样式
        - ❌ **禁止**：跳过本步骤直接进入 4.3 创建新组件
        - ✅ **正确做法**：先复用 existing 中的每个组件，再用 new 中的规格创建整体容器/新模块
      </substep>

      <substep id="4.3">创建新组件：按 `componentMapping.new` 中指定的 `path` 创建，实现 `features` 中定义的功能点
        **注意**：本步骤只创建 componentMapping.new 中标注的新组件/新模块。
        已在 4.2 中复用的 existing 组件（如 Button、Alert 等）不应在此步骤重新创建。
      </substep>

      <substep id="4.4">实现样式：使用 `styles.colorVariables` 中的 CSS 变量，按布局方案和样式要点实现，遵循 `constraints.prohibitedItems` 禁止事项</substep>
    </substeps>

    <completion_criteria>
      - [ ] **复用数量校验**：复用的现有组件数量 X 必须 >= componentMapping.existing.length（若 existing 为空则 X=0）
      - [ ] 每个 existing 组件已在代码中正确 import 并使用（非原生 HTML 重新实现）
      - [ ] 新组件已创建并实现所有 features
      - [ ] 样式已按规范实现，未违反禁止事项
    </completion_criteria>

    <output_format>✓ Step 4 完成：组件开发完成，复用 {existing.length} 个现有组件（{复用的组件名列表}），新建 {new.length} 个组件</output_format>
  </step>
</workflow>

---

## Step 5：交互与接口开发

<workflow>
  <step id="5" name="交互与接口开发" required="true">
    <action>实现交互逻辑、接口对接和埋点上报</action>

    <substeps>
      <substep id="5.1">按 `interactions` 字段定义的事件和逻辑实现交互行为</substep>
      <substep id="5.2">按 `dataRequirements` 定义接口调用</substep>
      <substep id="5.3">按 `tracking` 定义埋点上报</substep>
    </substeps>

    <completion_criteria>
      - 所有交互事件已实现
      - 所有接口调用已对接
      - 所有埋点已添加
    </completion_criteria>

    <output_format>✓ Step 5 完成：交互已实现，接口已对接，埋点已添加</output_format>
  </step>
</workflow>

---

## Step 6：代码评审（使用 Subagent）

**使用 subagent 调用 module-code-review 进行代码评审**：

```json
{
  "subagent_type": "general-agent",
  "description": "单模块代码评审",
  "prompt": "请执行单模块代码评审任务。\n\n**调用 module-code-review skill**：\n\n1. 读取本 skill 文件：.catpaw/skills/module-code-review/SKILL.md\n2. 按照 skill 流程执行代码评审\n\n**输入信息**：\n- task_id: {task_id}\n- task_title: {title}\n- task_type: {type}\n- module_path: {module_path}\n- requirement_dir: .catpaw/docs/{需求名}/\n- techdoc_path: .catpaw/docs/{需求名}/techdoc.md\n- prd_path: .catpaw/docs/{需求名}/prd.md（如存在）\n- dev_guide_path: .catpaw/docs/{需求名}/dev-guide.md\n- ui_spec_dir: .catpaw/docs/{需求名}/ui-specs/{componentName}/（Step 3 中定位的组件目录）
- ui_spec_index: .catpaw/docs/{需求名}/ui-specs/{componentName}/index.json
- ui_spec_dev: .catpaw/docs/{需求名}/ui-specs/{componentName}/dev.json\n\n**必须执行**：\n1. 读取项目知识库（L0-spec.md, L1-architecture.md, L2-modules.md, L6-experience.md）\n2. 读取技术方案\n3. 读取PRD文档（如存在）\n4. 读取开发指南\n5. 读取UI规格文件\n6. 读取被评审代码\n7. 执行评审检查（包含UI规格符合度检查）\n8. 输出评审报告\n\n⚠️ 必须等待评审完成后返回结果。"
}
```

**等待 subagent 返回评审报告**：

```text
✓ module-code-review 评审完成
```

**根据评审结果处理**：

| 评审结果 | 处理方式 |
|---------|----------|
| 通过 | 进入 Step 7 测试执行 |
| 通过但有建议 | 记录建议，进入 Step 7 测试执行 |
| 需修改 | 进入修复流程，修复后重新评审 |

### 修复流程

**当评审结果为「需修改」时**：

1. **读取评审报告中的问题列表**：
   - 🔴 必须修复的问题
   - 🟡 建议修复的问题（可选）

2. **逐条修复问题**：
   - 根据评审报告中的修复建议修改代码
   - 修复违反项目知识库、技术方案、PRD 的问题

3. **重新执行 Lint 检查**：
   ```bash
   npm run lint 2>&1 | tail -30
   ```

4. **重新执行代码评审**：
   - 再次调用 module-code-review
   - 直到评审结果为「通过」或「通过但有建议」

**修复循环最多 3 次**：
- 3 次修复后仍有「必须修复」问题 → 标记「开发完成但需人工介入」
- 记录未解决的问题，输出详细说明

**评审报告输出格式**：
```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 单模块代码评审报告
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
任务：{task_id} - {title}

【评审结果】
{通过/需修改}

【评分】
- 项目规范符合度：{X}/10
- 技术方案一致性：{X}/10
- PRD实现完整度：{X}/10
- UI规格符合度：{X}/10
- 代码质量：{X}/10

【检查项】
✅ 编码规范（L0）：{是否符合}
✅ 架构符合度（L1）：{是否符合}
✅ 业务逻辑（L2）：{是否符合}
✅ 踩坑点规避（L6）：{是否避开}
✅ 技术方案一致性：{是否符合}
✅ PRD一致性：{是否符合需求}
✅ UI规格符合度：{是否符合设计稿}

{如有问题}
🔴 必须修复：
- {问题描述} → 建议修复方案

🟡 建议修复：
- {问题描述} → 建议修复方案
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

<completion_criteria>
- 代码评审完成
- 评审结果为通过或通过但有建议
</completion_criteria>

<output_format>✓ Step 6 完成：代码评审通过</output_format>

---

## Step 7：测试执行

**检查是否存在测试文件**：

```bash
# 检查 __tests__ 目录下是否有对应测试文件
ls __tests__/{module_name}.test.tsx 2>/dev/null

# 或检查模块同级目录
ls src/**/{module_name}.test.tsx 2>/dev/null
```

### 7.1 存在测试文件

**执行测试**：

```bash
npm test -- {test_path}
```

**测试结果处理**：

| 测试结果 | 处理方式 |
|---------|----------|
| 全部通过 | ✅ 进入 Step 8 知识库更新 |
| 部分失败 | 分析失败原因，返回 Step 4 修复代码 |
| 全部失败 | 检查测试用例或实现代码问题 |

<completion_criteria>
- 测试已执行
- 所有测试用例通过
</completion_criteria>

<output_format>✓ Step 7 完成：测试执行完成，{Z} 个用例通过</output_format>

<error_handling>
测试失败时重试最多 3 次，每次尝试不同修复方案
3 次重试后仍失败：标记"开发完成但测试失败"，记录原因
</error_handling>

### 7.2 不存在测试文件

**跳过测试步骤**：

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ 未找到测试文件
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
模块：{module_path}

未找到对应的测试文件，跳过测试步骤。

如需添加测试，请手动创建测试文件后重新运行。
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

<output_format>✓ Step 7 完成：未找到测试文件，已跳过测试</output_format>

---

## Step 8：知识库更新

**询问是否更新本地项目知识库**：

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 知识库更新确认
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

是否需要将本次开发中的经验和规范更新到本地项目知识库（knowledge_hub/）？

【可更新的内容】
- 新增的组件映射模式
- 新的 UI 布局模式
- 踩坑点和解决方案
- 代码约定和最佳实践

请确认是否更新（Y/N）？
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 8.1 用户确认更新（Y）

调用 `layered-knowledge-builder` skill 的知识更新流程，将本次开发的经验同步到 `knowledge_hub/` 对应文件：

| 更新内容 | 目标文件 |
|---------|----------|
| 工程经验、踩坑点 | L6-experience.md |
| 模块相关业务逻辑 | L2-modules.md |
| 项目规范约定 | L0-spec.md |

<output_format>✓ Step 8 完成：知识库已更新</output_format>

### 8.2 用户拒绝更新（N）

输出提示并结束流程。

<output_format>✓ Step 8 完成：知识库未更新</output_format>

---

## 执行总结

完成所有步骤后，必须输出以下格式的总结：

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ UI 驱动开发流程完成！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

任务: {task_id} - {task_title}

已完成步骤:
  ✅ Step 1: 解析任务信息
  ✅ Step 2: 知识获取（开发指南已输出）
  ✅ Step 3: 获取 UI 规格（ui-specs 已就绪）
  ✅ Step 4: 复用现有组件 + 创建新组件 + 实现样式
  ✅ Step 5: 交互与接口开发
  ✅ Step 6: 代码评审
  ✅ Step 7: 测试执行（{Z} 个用例通过/已跳过）
  ✅ Step 8: 知识库更新

输出产物:
  📄 开发产物: {module_path}
  📄 单元测试: {test_path}
  📄 开发指南: .catpaw/docs/{需求名}/{task_id}/dev-guide.md
  📄 UI规格目录: .catpaw/docs/{需求}/ui-specs/{componentName}/

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
