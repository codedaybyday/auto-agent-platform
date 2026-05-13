---
name: skill-evolver
description: AI 工作流失败诊断与 Skill 自动进化工具。监听 PRD 生成/评审、技术方案生成/评审、代码生成等评审意见、测试报告或错误日志，收集失败案例和人工反馈，分析失败根因（知识缺失 / 流程错误 / 工具使用问题），优先以"打补丁（Patch）"模式精准更新现有 SKILL.md，或在必要时生成全新 skill，并创建 PR 清晰展示修改内容和原因。当用户提到"skill 进化"、"skill 自动修复"、"分析失败案例"、"PRD 评审失败"、"技术方案被打回"、"代码生成质量差"、"测试报告有问题"、"给 skill 打补丁"、"skill 哪里出了问题"、"为什么 AI 总是犯同样的错误"时立即使用。即使用户只是说"帮我看看这次 AI 哪里做错了"或"这个 skill 需要改进"也应触发。
---

# Skill Evolver — AI 工作流失败诊断与 Skill 自动进化

## 概述

这个 skill 的核心使命是：**让 AI 从失败中学习，并将学到的东西固化到 skill 里**。

工作流程分为四个阶段：

1. **收集（Collect）** — 从评审意见、测试报告、错误日志、人工反馈中提取失败案例
2. **诊断（Diagnose）** — 分析失败根因，判断是知识缺失、流程错误还是工具使用问题
3. **修复（Patch / Create）** — 优先对现有 skill 打补丁，必要时创建新 skill
4. **提交（PR）** — 生成 PR，清晰展示修改内容和原因，供人工审核

**⚠️ 重要：四个阶段必须连续执行，不可中断！**

- 阶段一完成后 → 自动进入阶段二
- 阶段二完成后 → 自动进入阶段三
- **阶段三完成后 → 必须自动进入阶段四（创建 PR）**

只有在以下情况才能跳过阶段四：
- 用户明确要求

---

## 阶段一：收集失败案例

### 输入来源

Skill Evolver 监听以下类型的输入，从中提取失败信号：

| 输入类型 | 典型内容 | 失败信号 |
|---------|---------|---------|
| PRD 评审意见 | 产品经理/评审人的批注、打回原因 | 需求理解偏差、遗漏关键约束、格式不符合规范 |
| 技术方案评审 | 架构师/技术负责人的评审意见 | 技术选型错误、边界条件未考虑、安全/性能问题 |
| 代码评审意见 | Code Review 评论、PR 被拒原因 | 编码规范违反、逻辑错误、测试覆盖不足 |
| 测试报告 | 自动化测试结果、QA 报告 | 功能缺陷、边界用例失败、回归问题 |
| 错误日志 | 运行时异常、工具调用失败 | 工具参数错误、API 调用失败、环境问题 |
| 人工反馈 | 用户直接描述的问题 | 任何上述类型的组合 |

### 收集步骤

**Step 1.1：识别输入类型**

读取用户提供的内容，判断属于哪种输入类型（可以是多种）。如果用户没有提供具体内容，询问：

> "请提供失败案例的具体内容——可以是评审意见截图/文字、测试报告、错误日志，或者直接描述问题。"

**Step 1.2：提取失败案例**

从输入中提取结构化的失败案例，每个案例包含：

```json
{
  "case_id": "唯一标识，如 case-001",
  "source_type": "prd_review | tech_review | code_review | test_report | error_log | manual_feedback",
  "description": "失败的具体描述（一句话）",
  "context": "失败发生时的上下文（AI 被要求做什么）",
  "actual_output": "AI 实际产出了什么",
  "expected_output": "应该产出什么（如果已知）",
  "reviewer_comment": "评审人/用户的原话（如果有）",
  "related_skill": "涉及的 skill 名称（如果已知，否则为 null）",
  "severity": "critical | major | minor"
}
```

**Step 1.3：去重和聚类**

如果有多个失败案例，检查是否有相似的根因。将相似案例聚合，避免重复修复同一问题。

---

## 阶段二：诊断根因

这是最关键的阶段。诊断的目标是找到**可以通过修改 skill 来解决的根本原因**。

### 根因分类框架

**类型 A：知识缺失（Knowledge Gap）**

AI 不知道某个领域知识、规范或约束。

特征：
- AI 产出的内容在逻辑上自洽，但不符合特定领域规范
- 评审意见中出现"这个行业/公司/团队的规范是..."
- AI 没有犯明显的推理错误，只是缺少特定知识

修复方向：在 skill 中补充相关知识、规范文档或示例。

**类型 B：流程错误（Process Error）**

AI 执行了错误的步骤顺序，或跳过了必要步骤。

特征：
- 评审意见中出现"你应该先...再..."
- 输出缺少某个必要的环节（如缺少安全审查、缺少边界条件分析）
- AI 做了不该做的事（如直接给出方案而没有先澄清需求）

修复方向：在 skill 中明确步骤顺序，添加检查点或 checklist。

**类型 C：工具使用问题（Tool Usage Error）**

AI 调用了错误的工具，或工具参数不正确。

特征：
- 错误日志中有工具调用失败的记录
- AI 用了低效的工具（如用截图代替直接读取文件）
- 工具参数格式错误

修复方向：在 skill 中明确工具选择逻辑和参数格式。

**类型 D：格式/规范问题（Format/Convention Error）**

输出格式不符合预期，但内容本身是正确的。

特征：
- 评审意见主要是关于格式、命名、结构的
- 内容正确但组织方式不对

修复方向：在 skill 中添加输出格式模板或示例。

### 诊断步骤

**Step 2.1：逐案例分析**

对每个失败案例，按以下顺序思考：

1. AI 在这个案例中**知道什么**？（已有知识）
2. AI 在这个案例中**不知道什么**？（缺失知识）
3. AI **做了什么**？（实际行为）
4. AI **应该做什么**？（期望行为）
5. 差距在哪里？（根因）

**Step 2.2：根源分析（关键步骤）**

确定根因后，必须进一步分析问题的**根源**在哪里：

**来源判断框架**：

1. **检查 Skill 本身**：
   - 读取相关 skill 的 SKILL.md
   - 检查 skill 是否缺少相关步骤、知识或规范
   - 检查 skill 的描述是否清晰、完整
   - 检查 skill 是否有误导性的描述或示例

2. **检查项目知识库**：
   - 检查 `knowledge_hub/` 目录是否存在
   - 检查相关知识点文档（如 L0-spec.md、L2-modules.md 等）
   - 检查知识库内容是否包含必要的规范、约束、最佳实践
   - 检查知识库内容是否过时或不准确

3. **判断逻辑**：

   **问题来源 = Skill 本身**，如果：
   - Skill 缺少必要的执行步骤或检查点
   - Skill 的描述模糊或有歧义
   - Skill 的示例或模板不符合实际需求
   - Skill 没有明确指示去查询知识库
   - Skill 指示错误的知识库路径或文件名

   **问题来源 = 项目知识库**，如果：
   - Skill 明确要求查询知识库，但知识库内容缺失
   - 知识库中的规范与实际要求不符
   - 知识库内容过时或不完整
   - 知识库文件路径错误或命名不规范

   **问题来源 = 两者都有**，如果：
   - Skill 和知识库都有缺陷
   - 例如：Skill 没有明确知识库路径，知识库也缺少关键内容

4. **优先级判断**：
   - 如果问题来源于 Skill 本身，优先修复 Skill
   - 如果问题来源于知识库，优先补充知识库内容（并在 Skill 中明确引用）
   - 如果两者都有问题，先修复 Skill 的流程，再补充知识库

**Step 2.3：生成诊断报告**

```
## 诊断报告

### 案例 [case_id]
- **根因类型**: [A/B/C/D]
- **问题来源**: [Skill 本身 | 项目知识库 | 两者都有]
- **具体根因**: [一句话描述]
- **证据**: [支持这个判断的具体内容]
- **Skill 检查结果**: [Skill 的具体问题]
- **知识库检查结果**: [知识库的具体问题]
- **可修复性**: [可以通过修改 skill 解决 / 需要补充知识库 / 需要两者都修复]
- **修复建议**: [具体应该在 skill 里加什么/改什么，或者在知识库里补充什么]
```

**Step 2.4：确认诊断**

将诊断报告展示给用户，询问：

> "以上是我对失败案例的诊断。请确认这些判断是否准确，或者补充我遗漏的信息。"

---

## 阶段三：修复 Skill

### 优先级原则

**优先打补丁（Patch），而非重写。**

原因：
- 现有 skill 经过了测试和验证，大部分内容是正确的
- 精准的小改动比全量重写风险更低
- Patch 模式让 PR 的 diff 更清晰，便于人工审核

只有在以下情况才考虑创建新 skill：
- 失败案例涉及的能力完全不在任何现有 skill 的范围内
- 现有 skill 的结构性问题导致无法通过 patch 修复
- 用户明确要求创建新 skill

### Step 3.1：定位目标 Skill

如果失败案例中已知 `related_skill`，直接读取该 skill 的 SKILL.md。

如果不确定，搜索 `/.catpaw/skills/` 目录，找到最相关的 skill：

```bash
ls /.catpaw/skills/
```

读取候选 skill 的 SKILL.md，判断是否是正确的修复目标。

**如果问题来源于项目知识库**：
- 定位知识库文件路径（如 `knowledge_hub/L0-spec.md`、`knowledge_hub/L2-modules.md` 等）
- 检查知识库内容是否需要补充或更新

### Step 3.2：生成 Patch 计划

在实际修改文件之前，先生成完整的 Patch 计划并展示给用户确认。

每个 Patch 对应一个根因，格式根据问题来源有所不同：

#### 如果问题来源于 Skill 本身：

```
## Patch [patch_id]

**修复的根因**: [case_id] — [根因类型] — [一句话描述]
**问题来源**: Skill 本身
**修改位置**: SKILL.md 的 [章节名称] 部分
**修改类型**: 新增内容 | 替换内容 | 删除内容 | 重组结构

**修改前**:
[原始内容（精确引用，包含足够上下文）]

**修改后**:
[修改后的内容]

**修改原因**: [为什么这样改能解决问题，解释背后的逻辑]
```

#### 如果问题来源于项目知识库：

```
## Patch [patch_id]

**修复的根因**: [case_id] — [根因类型] — [一句话描述]
**问题来源**: 项目知识库
**修改位置**: knowledge_hub/[文件名] 的 [章节名称] 部分
**修改类型**: 新增内容 | 更新内容 | 补充示例

**修改前**:
[原始内容（如果存在）]

**修改后**:
[修改后的内容]

**修改原因**: [为什么需要补充这个知识，解释对 AI 工作流的影响]
```

#### 如果问题来源于两者：

需要生成两个 Patch，分别修复 Skill 和知识库：

**Patch A（修复 Skill）**：
```
## Patch [patch_id-a]

**修复的根因**: [case_id] — [根因类型] — [一句话描述]
**问题来源**: Skill 本身
**修改位置**: SKILL.md 的 [章节名称] 部分
**修改类型**: 新增内容

**修改前**:
[原始内容]

**修改后**:
[明确指示查询知识库的相关内容]

**修改原因**: [Skill 需要明确引用知识库中的规范]
```

**Patch B（补充知识库）**：
```
## Patch [patch_id-b]

**修复的根因**: [case_id] — [根因类型] — [一句话描述]
**问题来源**: 项目知识库
**修改位置**: knowledge_hub/[文件名]
**修改类型**: 新增内容

**修改前**:
[空或不存在]

**修改后**:
[具体的知识库内容]

**修改原因**: [补充缺失的知识库内容，确保 Skill 能正确引用]
```

**Patch 生成原则：**

- 每个 Patch 只解决一个根因，保持原子性
- 修改范围尽量小，不要改动无关内容
- 新增内容要融入现有结构，不要破坏 skill 或知识库的整体逻辑
- 如果需要新增章节，选择合适的位置插入，并更新目录（如果有）
- 修改前的内容必须精确引用原文，确保 `string_replace` 能唯一匹配
- **优先修复 Skill 的流程问题，再补充知识库的内容**

### Step 3.3：备份并应用 Patch

在应用 Patch 之前，先备份原始文件：

**如果是 Skill 文件**：
```bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
cp /.catpaw/skills/[skill-name]/SKILL.md \
   /.catpaw/skills/[skill-name]/SKILL.md.bak.$TIMESTAMP
echo "备份已保存：SKILL.md.bak.$TIMESTAMP"
```

**如果是知识库文件**：
```bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
cp knowledge_hub/[filename].md \
   knowledge_hub/[filename].md.bak.$TIMESTAMP
echo "备份已保存：[filename].md.bak.$TIMESTAMP"
```

然后使用 `string_replace` 或 `multi_edit` 工具逐个应用 Patch。

应用每个 Patch 后，重新读取文件确认修改正确，再继续下一个。

**应用顺序**：
1. 先应用 Skill 相关的 Patch
2. 再应用知识库相关的 Patch
3. 确保两者修改都正确完成

### Step 3.4：创建新 Skill（仅在必要时）

如果需要创建新 skill，参考 skill-creator 的规范：

```
/.catpaw/skills/[new-skill-name]/
├── SKILL.md
└── references/  (如果需要)
    └── [domain-knowledge].md
```

SKILL.md 的 frontmatter 必须包含：
- `name`: kebab-case 命名
- `description`: 触发条件和功能描述（参考 skill-creator 的描述优化指南）

### 阶段三完成标准

**⚠️ 阶段三完成后，必须立即进入阶段四（创建 PR），不可中断！**

完成条件：
- [ ] 所有 Patch 已应用并验证
- [ ] 备份文件已创建
- [ ] 修改后的 skill 文件已确认无误
- [ ] **准备进入阶段四：提交 PR**

**下一步操作**：开始执行阶段四 — 克隆仓库 → 同步修改 → 创建分支 → 提交 → 创建 PR

---

## 阶段四：提交 PR 到远程仓库

Patch 应用完成后，需要将修改后的 skill 文件提交到远程 Git 仓库，并创建 PR 供人工审核。

### 远程仓库信息

Skill 仓库地址：`ssh://git@git.sankuai.com/wm/ide-spec-workflow.git`

Skill 在仓库中的默认路径：`src/skills/[skill-name]/`

### Step 4.1：在临时目录克隆仓库

使用浅克隆（shallow clone）减少克隆时间，只克隆最近的提交历史：

```bash
# 创建临时工作目录
TEMP_DIR=$(mktemp -d)
echo "临时目录: $TEMP_DIR"

# 浅克隆仓库
cd $TEMP_DIR
git clone --depth=1 ssh://git@git.sankuai.com/wm/ide-spec-workflow.git repo
cd repo
```

> **说明**：使用浅克隆可以大幅减少克隆时间，因为我们只需要最新代码即可创建新分支和 PR。

### Step 4.2：同步修改到仓库

将修改过的文件复制到仓库对应目录：

**如果是 Skill 文件**：
```bash
# 确保目标目录存在
mkdir -p src/skills/[skill-name]/

# 复制修改的文件
cp /.catpaw/skills/[skill-name]/SKILL.md src/skills/[skill-name]/SKILL.md

# 如有其他修改的文件，一并复制
if [ -d /.catpaw/skills/[skill-name]/references ]; then
  cp -r /.catpaw/skills/[skill-name]/references src/skills/[skill-name]/
fi
```

### Step 4.3：创建新分支并提交

在仓库中创建新分支，提交变更：

```bash
# 生成分支名
cd $TEMP_DIR/repo
BRANCH_NAME="fix/evolve-[skill-name]-$(date +%Y%m%d)"

# 创建新分支
git checkout -b $BRANCH_NAME

# 添加修改的文件
git add src/skills/[skill-name]/

# 提交
git commit -m "fix([skill-name]): [一句话描述本次修复的内容]"

# 推送到远程
git push origin $BRANCH_NAME
```

分支命名规范：
- 修复现有 skill：`fix/evolve-[skill-name]-YYYYMMDD`
- 新增 skill：`feat/add-[skill-name]-YYYYMMDD`

### Step 4.4：用 @ee/code-cli 创建 PR

使用 `@ee/code-cli` 提交 PR：

```bash
# 生成 PR body
cat > /tmp/pr-body.txt << 'EOF'
## 背景
[失败案例来源和问题描述]

## 根因分析
[每个案例的根因类型和分析]

## 修改内容
[每个 Patch 的修改前/后对比和原因]

## 预期效果
[修改后 AI 在类似场景下的预期表现]
EOF

# 创建 PR
npx @ee/code-cli pr create \
  -R "wm/ide-spec-workflow" \
  --head "$BRANCH_NAME" \
  --base "master" \
  --title "fix([skill-name]): [一句话描述]" \
  --body "$(cat /tmp/pr-body.txt)"
```

PR body 应包含（写入 `/tmp/pr-body.txt` 再引用，避免换行问题）：

```markdown
## 背景
[失败案例来源和问题描述]

## 根因分析
[每个案例的根因类型和分析]

## 修改内容
[每个 Patch 的修改前/后对比和原因]

## 预期效果
[修改后 AI 在类似场景下的预期表现]
```

PR body 模板详见 `references/pr-template.md`。

### Step 4.5：清理并告知结果

PR 创建成功后：

1. 删除临时目录：`rm -rf $TEMP_DIR`
2. 删除备份文件：`rm /.catpaw/skills/[skill-name]/SKILL.md.bak.[timestamp]`
3. 删除临时 body 文件：`rm /tmp/pr-body.txt`
4. 将 PR 链接展示给用户：

> "PR 已创建：[PR 链接]。修改已提交到 `fix/evolve-[skill-name]` 分支，等待审核合并。"

---

## 完整工作流示例

### 场景：PRD 生成 skill 被评审打回

**用户输入**：
> "我们的 PRD 生成 skill 最近被产品经理打回了两次，评审意见是：1）缺少竞品分析章节；2）用户故事格式不符合公司规范，应该用 'As a [role], I want [goal], so that [benefit]' 格式。"

**Skill Evolver 的处理流程**：

1. **收集**：提取两个失败案例
   - case-001：缺少竞品分析章节（来源：PRD 评审，severity: major）
   - case-002：用户故事格式错误（来源：PRD 评审，severity: major）

2. **诊断**：
   - case-001：类型 A（知识缺失）— PRD skill 不知道需要包含竞品分析
   - case-002：类型 D（格式规范）— PRD skill 没有指定用户故事的格式模板

3. **Patch 计划**：
   - Patch 1：在 PRD skill 的"文档结构"章节添加"竞品分析"章节要求
   - Patch 2：在 PRD skill 的"用户故事"部分添加格式模板和示例

4. **应用 Patch**：备份 → 应用 Patch 1 → 确认 → 应用 Patch 2 → 确认

5. **PR**：生成 PR 文档，展示两个 Patch 的具体内容、原因和 diff

---

## 辅助参考

详细的 schema、模板和脚本见以下文件：

- `references/case-schema.md` — 失败案例的完整 JSON schema
- `references/pr-template.md` — PR 文档模板
- `scripts/generate_diff.py` — 生成格式化 diff 的脚本
- `scripts/format_pr.py` — 生成 PR Markdown 文档的脚本
