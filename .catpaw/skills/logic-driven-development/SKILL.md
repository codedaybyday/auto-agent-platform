---
name: logic-driven-development
description: 逻辑驱动开发流程。适用于非 UI 的纯逻辑开发场景。当用户提到「开发逻辑任务」「开发非 UI 任务」「纯逻辑开发」「开发 API」「开发工具函数」「开发 hook」「开发 service」时立即使用此 skill。
---

# 逻辑驱动开发流程

专注于纯逻辑开发的流程编排工具。

---

## ⚠️ 核心执行规则（优先级最高）

1. **顺序执行**：Step 1 → 2 → 3 → 4 → 5 → 6，禁止跳步、合并或重排序
2. **等待子 skill 确认**：调用 `unit-test-generator` 后，必须等待 `✓ {skill-name} 完成`
3. **每步完成后输出确认**：每个 Step 完成后必须输出 `✓ Step X 完成：[具体产出]`
4. **Step 5 必须执行测试**：即使认为"代码很简单不需要测试"，也必须执行
5. **Step 6 知识库更新**：测试通过后询问是否更新项目知识库
6. **任何步骤失败立即停止**：输出错误原因，不继续后续步骤

---

## 执行流程总览

Step 1: 解析任务信息
↓
Step 2: 知识获取（读取项目知识库、技术方案等知识）
↓
Step 3: 模块化开发
↓
Step 4: 代码评审
↓
Step 5: 测试执行
↓
Step 6: 知识库更新

---

## Step 1：解析任务信息

<workflow>
  <step id="1" name="解析任务信息" required="true">
    <action>读取 tasks.md，提取任务详情</action>

    <substeps>
      <substep id="1.1">从用户输入提取任务 ID 或搜索匹配任务标题</substep>
      <substep id="1.2">读取 `.catpaw/docs/{需求名}/tasks.md` 对应章节</substep>
      <substep id="1.3">验证任务类型为 api/tool/hook/service（非 UI 任务）</substep>
    </substeps>

    <completion_criteria>
      - 任务 ID、标题、类型、模块路径均已提取
      - 任务类型已确认为非 UI 任务
    </completion_criteria>

    <output_format>✓ Step 1 完成：任务 {task_id} 类型为 {type}，模块路径 {path}</output_format>

    <error_handling>
      若任务类型为 UI（page/component）：提示用户使用 ui-driven-development，停止执行
      若任务不存在：输出错误，停止执行
    </error_handling>
  </step>
</workflow>

---

## Step 2：知识获取

### Phase 1：创建任务目录和初始化开发指南

**创建任务目录**：

```bash
mkdir -p .catpaw/docs/{需求名}/{task_id}
```

**初始化开发指南文件**：

保存到：`.catpaw/docs/{需求名}/{task_id}/dev-guide.md`

```markdown
# 模块开发指南：{模块名}

## 任务信息
- 任务 ID：{task_id}
- 任务标题：{title}
- 任务类型：{type}
- 模块路径：{module_path}

<!-- 以下内容由各 Agent 依次补充 -->

## 技术方案要求
<!-- Agent 1 将在此补充 -->

## 项目知识库要点
<!-- Agent 2 将在此补充 -->

## 代码风格参考
<!-- Agent 3 将在此补充 -->

## 用户扩展规范
<!-- Agent 4 将在此补充 -->
```

### Phase 2：并行获取知识 + 主 Agent 统一写入

**⚠️ 并发写入警告：禁止让多个 Agent 并行写入同一个文件！并行 Agent 各自读取-修改-写入同一文件会产生竞态条件，后写入的会覆盖先写入的内容。正确做法是：Agent 只负责获取知识并返回内容，由主 Agent 统一写入文件。**

**并行调用以下 Agent 获取知识（Agent 只返回内容，不写入文件）**：

| Agent | 职责 | 知识来源 | 补充章节 |
|-------|------|----------|----------|
| Agent 1 | 技术方案解析 | `.catpaw/docs/{需求名}/techdoc.md` | 技术方案要求 |
| Agent 2 | 项目知识库检索 | `knowledge_hub/` 目录 | 项目知识库要点 |
| Agent 3 | 代码风格参考 | 现有代码分析 | 代码风格参考 |
| Agent 4 | 用户扩展知识 | 自定义规范文件 | 用户扩展规范 |

**Agent 2 知识库检索范围**：

```
knowledge_hub/
├── INDEX.md           # 知识库索引（检索决策树）
├── EXTERNAL.md        # 外部依赖（官方文档链接）
├── ORG-1.md          # 公司级基建库（Nine、Roo、Raptor、高达、mach 等）
├── ORG-2.md          # 团队级基建库
├── L0-spec.md        # 项目规范与约定
├── L1-architecture.md # 工程架构
├── L2-modules.md     # 功能模块（业务逻辑、接口、PRD）
├── L3-process.md     # 研发流程
├── L4-ops.md         # 运维与质量
├── L5-onboarding.md  # 新人入门
└── L6-experience.md  # 工程经验（踩坑点、痛点、最佳实践）
```

**按任务类型检索重点**：

| 任务类型 | 必检知识 |
|---------|----------|
| UI 组件开发 | 高达/mach 组件规范 + 样式规范 + Roo 组件 API |
| 页面开发 | L1 架构 + 路由规范 + 状态管理方案 |
| API 接口开发 | L2 模块接口 + 请求封装规范 |
| 埋点开发 | 灵犀埋点规范 |

**每个 Agent 执行流程**：

1. 执行知识获取任务
2. **将获取的知识内容作为返回值返回给主 Agent（禁止 Agent 直接写入文件！）**
3. 输出完成确认

**必须等待所有 Agent 返回知识内容**：
```
✓ Agent 1 完成：技术方案解析，已返回内容
✓ Agent 2 完成：知识库检索，已返回内容
✓ Agent 3 完成：代码风格分析，已返回内容
✓ Agent 4 完成：扩展知识获取，已返回内容
```

**所有 Agent 返回后，主 Agent 统一写入开发指南文件**：

1. 读取 `.catpaw/docs/{需求名}/{task_id}/dev-guide.md` 初始文件
2. 将 Agent 1 返回的内容替换 `<!-- Agent 1 将在此补充 -->` 占位符
3. 将 Agent 2 返回的内容替换 `<!-- Agent 2 将在此补充 -->` 占位符
4. 将 Agent 3 返回的内容替换 `<!-- Agent 3 将在此补充 -->` 占位符
5. 将 Agent 4 返回的内容替换 `<!-- Agent 4 将在此补充 -->` 占位符
6. 一次性写入完整文件

<completion_criteria>
- 4 个 Agent 并行调用完成
- 所有 Agent 均已返回知识内容（非写入文件）
- 主 Agent 已将所有知识内容统一写入开发指南文件
- 开发指南文件已完整输出到 .catpaw/docs/{需求名}/{task_id}/dev-guide.md
</completion_criteria>

<output_format>✓ Step 2 完成：知识获取完成，开发指南已输出</output_format>

---

## Step 3：模块化开发

### Phase 1：读取开发指南

**读取开发指南**：

```bash
read_file .catpaw/docs/{需求名}/{task_id}/dev-guide.md
```

### Phase 2：检查自动化工具（API 接口开发专用）

**⚠️ 仅当任务类型为 `api` 时执行此步骤**

**检查项**：
- 检查项目中是否存在 `ats.config.js` 或类似配置文件
- 检查 package.json 中是否安装了 `@waimai/slp-ats` 或类似工具
- 检查知识库 L3-process.md 或 ORG-1.md 中是否有接口生成工具的使用说明

**如果存在自动化工具**：

1. **阅读工具文档**：
   ```bash
   npx ats --help
   # 或查看知识库中的使用说明
   ```

2. **使用工具生成接口文件**：
   ```bash
   # 注意：参数是 api_project_id，不是 api_id
   npx ats {api_project_id}
   ```

3. **验证生成的文件**：
   - 检查文件路径是否符合预期
   - 检查类型定义是否完整
   - 检查请求函数是否正确

**输出格式**：
```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Phase 2 自动化工具检查完成
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
工具名称：{ats/其他工具名称}
配置文件：{ats.config.js 路径}
生成命令：npx ats {api_project_id}
生成文件：{文件路径列表}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**如果不存在自动化工具**：
- 继续执行 Phase 3，手动创建接口文件

<completion_criteria>
- 开发指南已读取
- 自动化工具已检查（API 任务）
</completion_criteria>

---

### Phase 3：增量编码（如自动化工具未生成）

**按照开发指南执行开发**：

**步骤**：

1. **理解开发要求**：
   - 阅读开发指南中的技术方案要求
   - 理解项目知识库要点
   - 参考代码风格规范

2. **查找可复用代码**：
   - 在项目中搜索功能相似的现有代码
   - 参考开发指南中推荐的参考文件

3. **按开发指南实现功能**：
   - 按照技术方案要求实现
   - 按代码风格规范组织代码
   - 实现错误处理和边界情况

4. **验证实现**：
   - 对照开发指南验证技术方案实现
   - 验证接口定义是否符合预期
   - 验证错误处理是否完整

5. **循环检查**：
   - 检查是否所有功能点都已实现
   - 检查是否所有边界情况都已处理

<completion_criteria>
- 所有功能点已实现
- 代码已完成
- 技术方案验证通过
</completion_criteria>

---

### Phase 4：Lint 检查

```bash
npm run lint 2>&1 | tail -30
```

若有 lint 错误，逐条修复并重新检查。

<completion_criteria>
- Lint 检查通过
- 无错误或警告
</completion_criteria>

<output_format>✓ Step 3 完成：模块化开发完成</output_format>

---

## Step 4：代码评审（使用 Subagent）

**使用 subagent 调用 module-code-review 进行代码评审**：

```json
{
  "subagent_type": "general-agent",
  "description": "单模块代码评审",
  "prompt": "请执行单模块代码评审任务。\n\n**调用 module-code-review skill**：\n\n1. 读取本 skill 文件：.catpaw/skills/module-code-review/SKILL.md\n2. 按照 skill 流程执行代码评审\n\n**输入信息**：\n- task_id: {task_id}\n- task_title: {title}\n- task_type: {type}\n- module_path: {module_path}\n- requirement_dir: .catpaw/docs/{需求名}/\n- techdoc_path: .catpaw/docs/{需求名}/techdoc.md\n- prd_path: .catpaw/docs/{需求名}/prd.md（如存在）\n\n**必须执行**：\n1. 读取项目知识库（L0-spec.md, L1-architecture.md, L2-modules.md, L6-experience.md）\n2. 读取技术方案\n3. 读取PRD文档（如存在）\n4. 读取被评审代码\n5. 执行评审检查\n6. 输出评审报告\n\n⚠️ 必须等待评审完成后返回结果。"
}
```

**等待 subagent 返回评审报告**：

```text
✓ module-code-review 评审完成
```

**根据评审结果处理**：

| 评审结果 | 处理方式 |
|---------|----------|
| 通过 | 进入 Step 5 测试执行 |
| 通过但有建议 | 记录建议，进入 Step 5 测试执行 |
| 需修改 | 进入修复流程，修复后重新评审 |

### 修复流程

**当评审结果为「需修改」时**：

1. **读取评审报告中的问题列表**：
   - 🔴 必须修复的问题
   - 🟡 建议修复的问题（可选）

2. **逐条修复问题**：
   - 根据评审报告中的修复建议修改代码
   - 修复违反项目知识库、技术方案、PRD的问题

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
- 代码质量：{X}/10

【检查项】
✅ 编码规范（L0）：{是否符合}
✅ 架构符合度（L1）：{是否符合}
✅ 业务逻辑（L2）：{是否符合}
✅ 踩坑点规避（L6）：{是否避开}
✅ 技术方案一致性：{是否符合}
✅ PRD一致性：{是否符合需求}

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

<output_format>✓ Step 4 完成：代码评审通过</output_format>

---

## Step 5：测试执行

**检查是否存在测试文件**：

```bash
# 检查 __tests__ 目录下是否有对应测试文件
ls __tests__/{module_name}.test.ts 2>/dev/null

# 或检查模块同级目录
ls src/**/{module_name}.test.ts 2>/dev/null
```

### 5.1 存在测试文件

**执行测试**：

```bash
npm test -- {test_path}
```

**测试结果处理**：

| 测试结果 | 处理方式 |
|---------|----------|
| 全部通过 | ✅ 进入 Step 6 知识库更新 |
| 部分失败 | 分析失败原因，返回 Step 3 修复代码 |
| 全部失败 | 检查测试用例或实现代码问题 |

<completion_criteria>
- 测试已执行
- 所有测试用例通过
</completion_criteria>

<output_format>✓ Step 5 完成：测试执行完成，{Z} 个用例通过</output_format>

<error_handling>
测试失败时重试最多 3 次，每次尝试不同修复方案
3 次重试后仍失败：标记"开发完成但测试失败"，记录原因
</error_handling>

### 5.2 不存在测试文件

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

<output_format>✓ Step 5 完成：未找到测试文件，已跳过测试</output_format>

---

## Step 6：知识库更新

**询问是否更新本地项目知识库**：

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 知识库更新确认
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

是否需要将本次开发中的经验和规范更新到本地项目知识库（knowledge_hub/）？

【可更新的内容】
- 新增的接口封装模式
- 错误处理最佳实践
- 踩坑点和解决方案
- 代码约定和最佳实践

请确认是否更新（Y/N）？
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 6.1 用户确认更新（Y）

调用 `layered-knowledge-builder` skill 的知识更新流程，将本次开发的经验同步到 `knowledge_hub/` 对应文件：

| 更新内容 | 目标文件 |
|---------|----------|
| 工程经验、踩坑点 | L6-experience.md |
| 模块相关业务逻辑 | L2-modules.md |
| 项目规范约定 | L0-spec.md |

<output_format>✓ Step 6 完成：知识库已更新</output_format>

### 6.2 用户拒绝更新（N）

输出提示并结束流程。

<output_format>✓ Step 6 完成：知识库未更新</output_format>

---

## 执行总结

完成所有步骤后，必须输出以下格式的总结：

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 逻辑驱动开发流程完成！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

任务: {task_id} - {task_title}

已完成步骤:
  ✅ Step 1: 解析任务信息
  ✅ Step 2: 知识获取（开发指南已输出）
  ✅ Step 3: 模块化开发
    - Phase 1: 读取开发指南
    - Phase 2: 检查自动化工具
    - Phase 3: 增量编码
    - Phase 4: Lint 检查
  ✅ Step 4: 代码评审
  ✅ Step 5: 测试执行（{Z} 个用例通过/已跳过）
  ✅ Step 6: 知识库更新

输出产物:
  📄 开发产物: {module_path}
  📄 单元测试: {test_path}
  📄 开发指南: .catpaw/docs/{需求}/{task_id}/dev-guide.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 任务类型验证

执行 Step 1 时，验证任务类型：

| 类型 | 是否适用 | 动作 |
|------|---------|------|
| api, tool, hook, service | ✅ 适用 | 继续执行 |
| page, component | ❌ 不适用 | 提示用户使用 `ui-driven-development`，停止执行 |

**不适用时的输出**：
```text
❌ 任务 {task_id} 类型为 {type}，不适用逻辑驱动开发流程。
请使用 ui-driven-development skill。
```

