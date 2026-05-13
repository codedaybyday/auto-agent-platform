# Agent Code Stats —— AI 编码占比统计工具

> 🖥️ **CLI 工具**：[`@wmfe/ai-coding-stats`](https://r.npm.sankuai.com/package/@wmfe/ai-coding-stats)  
> 自动记录 Agent 每次文件编辑的代码变更，统计 AI 生成代码与人工代码的行数占比，并支持记录任务各阶段进展，完整追踪 Spec Coding 全流程。

---

## 一、功能概述

`spec-coding-stats` 是一款专为 Spec Coding 流程设计的 **AI 编码量化统计工具**，底层由 CLI 工具 **`@wmfe/ai-coding-stats`** 驱动。它通过 IDE Hook 自动捕获每次 Agent 编辑文件时产生的代码变更，与 Git 分支差异对比后精确计算 AI 生成代码的占比，同时支持记录任务在各阶段（需求分析 → 方案设计 → 编码 → 测试 → 归档）的进展信息。

### 核心统计指标

| 指标 | 说明 |
|------|------|
| **AI 新增行数** | diff 中的新增行，且该行出现在 Agent Hooks 记录中 |
| **AI 删除行数** | diff 中的删除行，且该行出现在 Agent Hooks 记录中 |
| **人工新增行数** | diff 中的新增行，但未在 Agent Hooks 记录中找到 |
| **人工删除行数** | diff 中的删除行，但未在 Agent Hooks 记录中找到 |
| **AI代码覆盖率** | (AI 新增行数 + AI 删除行数) / (人工新增行数 + 人工删除行数 + AI 新增行数 + AI 删除行数) |
| **阶段进展** | 记录任务各阶段（需求分析 / 方案设计 / 编码 / 测试 / 归档）的进展信息 |
| **Spec使用新增行数** | 当前分支 diff 中，属于 spec commit 的新增行数 |
| **Spec使用删除行数** | 当前分支 diff 中，属于 spec commit 的删除行数 |
| **Spec总新增行数** | spec commit 本身引入的总新增行数 |
| **Spec总删除行数** | spec commit 本身引入的总删除行数 |
| **Spec Coding代码覆盖率** | (Spec使用新增 + Spec使用删除) / (总新增 + 总删除)，衡量 spec commit 对分支变更的覆盖程度 |
| **Spec Code无效代码率** | 1 − (Spec使用新增 + Spec使用删除) / (Spec总新增 + Spec总删除)，衡量 spec commit 中未被实际使用的代码占比 |

---

## 二、工作原理

### 1. AI 代码覆盖率统计流程

#### 整体流程

```
┌──────────────────────────┐   Hook 触发    ┌────────────────────────────────────┐
│  Agent 编辑文件           │ ────────────► │  after-file-edit Hook               │
│  (string_replace / write │               │  自动调用 addRecord                  │
│   等每次写操作)           │                │  将变更代码片段写入                   │
└──────────────────────────┘               │  .git/catpaw/agent-code-stats/     │
                                           └────────────────────────────────────┘
                                                             │
                    ┌────────────────────────────────────────┘
                    │  执行 ai-coding-stats stats
                    ▼
┌───────────────────────────────────────────────────────────────────┐
│  Step 1  git diff <base>...HEAD                                   │
│          获取当前分支相对于基准分支的所有变更行（新增行 / 删除行）         │
├───────────────────────────────────────────────────────────────────┤
│  Step 2  逐行与 AI 缓存记录匹配                                      │
│          · 命中  → 归为 AI 新增 / AI 删除                            │
│          · 未命中 → 归为 人工新增 / 人工删除                           │
├───────────────────────────────────────────────────────────────────┤
│  Step 3  计算 AI 代码覆盖率                                         │
│                                                                   │
│          AI 代码覆盖率 =                                           │
│            (AI新增行数 + AI删除行数)                                │
│          ─────────────────────────────────────────────────────── │
│          (AI新增行数 + AI删除行数 + 人工新增行数 + 人工删除行数)         │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

#### 行匹配规则

每次 Agent 编辑文件时，Hook 将变更的**代码片段**（每行内容）写入本地缓存。`stats` 统计时，对 `git diff` 中的每一条新增行或删除行，去掉首尾空白后在缓存中查找：
- **找到** → 该行计为 AI 生成
- **未找到** → 该行计为人工编写

> 匹配以**行内容**（trim 后）为单位，支持跨文件路径的模糊匹配，避免路径变化导致的漏判。

---

### 2. Spec Coding 代码覆盖率统计流程

Spec Coding 代码覆盖率衡量的是：**Spec commit（方案设计阶段产出的提交）在当前分支实际变更中的落地程度**。

#### 前置：设置 Spec Commit

```bash
ai-coding-stats setSpecCommit --commits "xxxxxxx,yyyyyyy"
# 将 spec commit 号保存到 .git/catpaw/agent-code-stats/<branch>/spec.json
```

#### 统计流程

```
┌─────────────────────────────────────────────────────────────────────┐
│  读取 spec.json 中记录的 Spec Commit 号列表                            │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
               ┌───────────────┴───────────────┐
               ▼                               ▼
┌──────────────────────────┐        ┌──────────────────────────────────────┐
│  计算 Spec 总变更行数      │        │  计算 Spec 在分支 diff 中的使用量        │
│                          │        │                                      │
│  对每个 spec commit 执行  │        │  对 base...HEAD diff 中每个变更文件:    │
│  git diff <commit>^..<commit>│    │  · git blame 当前版本                 │
│  统计新增 / 删除行数之和    │        │  · git blame 基准分支版本              │
│                          │        │  · 匹配来自 spec commit 的行内容        │
│  → spec_total_add_line   │        │                                      │
│  → spec_total_delete_line│        │  → spec_use_add_line                 │
└──────────────────────────┘        │  → spec_use_delete_line              │
                                    └──────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│  平台计算派生指标                                                      │
│                                                                     │
│  Spec Coding 代码覆盖率 =                                             │
│    (spec_use_add_line + spec_use_delete_line)                       │
│  ─────────────────────────────────────────────────────────────────  │
│  (总新增行数 + 总删除行数)                                             │
│                                                                     │
│  Spec Code 无效代码率 =                                               │
│    1 − (spec_use_add_line + spec_use_delete_line)                   │
│        ────────────────────────────────────────                     │
│        (spec_total_add_line + spec_total_delete_line)               │
└─────────────────────────────────────────────────────────────────────┘
```

> CLI 上报 4 个原始 Spec 指标（`spec_use_add_line` / `spec_use_delete_line` / `spec_total_add_line` / `spec_total_delete_line`），**Spec Coding 代码覆盖率和无效代码率由统计平台自动计算**。

---

### 3. 自定义阶段进展上报流程

记录任务在 Spec Coding 全流程各阶段（需求分析 → 方案设计 → 编码 → 测试 → 归档）的进展，`--submit` 时随统计数据一并上报至平台。

#### 记录与上报流程

```
Spec Coding 全流程
──────────────────────────────────────────────────────────────
  需求分析          方案设计          编码          测试 / 归档
  req_analysis     tech_design      dev_coding     test / archive
      │                │               │                │
      ▼                ▼               ▼                ▼
  updateStage      updateStage     updateStage      updateStage
  --stage 需求分析  --stage 方案设计  --stage 编码    --stage 归档
  --type skill     --type skill    --type command  --type command
  --value "..."    --value "..."   --value "..."   --value "..."
──────────────────────────────────────────────────────────────
                            │
                            ▼
               ┌────────────────────────┐
               │    写入 stage.json      │
               │  同阶段相同 value 覆盖   │
               │  不同 value 追加        │
               └────────────┬───────────┘
                            │
            ┌───────────────┴────────────────┐
            ▼                                ▼
  ┌──────────────────┐            ┌──────────────────────────┐
  │  单独更新阶段      │            │  --submit 模式            │
  │  仅写入本地        │            │  写入本地 stage.json      │
  │  stage.json      │            │  + 自动执行 stats         │
  └──────────────────┘            │  + 携带全部阶段数据上报     │
                                  └──────────────────────────┘
```

#### 核心规则

| 规则 | 说明 |
|------|------|
| **5 个阶段独立存储** | `req_analysis` / `tech_design` / `dev_coding` / `test` / `archive`，互不影响 |
| **去重机制** | 同一阶段内相同 `value` 只保留一条，后设置的覆盖先设置的（包括 `type` 和 `tips`） |
| **灵活上报** | 可随时单独更新某个阶段；加 `--submit` 则更新后立即触发统计+提交 |
| **空值处理** | 无内容的阶段上报为**空字符串**，有内容阶段上报为 JSON 数组字符串 |

> 数据存放在 `.git/catpaw/agent-code-stats/` 目录，天然不被 git 追踪、不随 clone 传播。有效期 **6 个月**，超期分支目录会在下次 `addRecord` 时自动清理。

---

## 三、快速上手

### 1. 一键初始化（init）

在**项目根目录**执行 `init` 命令，完成 Hook 配置和项目配置文件的写入（**首次执行时会自动安装 `@wmfe/ai-coding-stats` CLI**）：

```bash
ai-coding-stats init                          # 默认 catpaw 平台
ai-coding-stats init --platform catpaw         # 写入 .catpaw/hooks.json
ai-coding-stats init --platform cursor         # 写入 .cursor/hooks.json
ai-coding-stats init --platform claudecode     # 写入 .claude/settings.local.json
```

`init` 会做三件事：
1. **自动安装** `@wmfe/ai-coding-stats` CLI（未安装或版本过低时）
2. 将 `after-file-edit` 的 Hook 配置写入项目对应目录
3. 在项目根目录生成 `spec-config.json` 默认配置文件

> **重要**：只有配置了此 Hook，才能准确统计 AI 生成代码与人工代码的占比。

### 2. 绑定 ONES 需求（bindOnes）

在首次生成报告前，需要将当前分支与 ONES 任务绑定：

```bash
ai-coding-stats bindOnes \
  --task_id "93779130" \
  --task_name "终端组-Spec Coding指标统计平台建设" \
  --ones_url "https://ones.sankuai.com/..." \
  --requirement_id "93329401" \
  --requirement_name "智能化研发提效TG"
```

**必填参数**：`task_id`、`ones_url`、`requirement_id`
**可选参数**：`task_name`、`requirement_name`、`prd_url`、`requirement_ones_url`、`start_time`、`end_time`、`metric_name`、`metric_value`、`extra_data`

### 3. 统计并上报（stats）

```bash
# 默认对比 master 分支（未绑定 ONES 会提示绑定）
ai-coding-stats stats

# 对比 develop 分支
ai-coding-stats stats --base develop

# 保存报告到文件
ai-coding-stats stats --output report.txt

# 提交统计数据到统计平台
ai-coding-stats stats --submit

# 组合使用
ai-coding-stats stats --output report.txt --submit
```

上报成功后，可前往统计平台查看数据：**https://api-call-tracker-hub.mynocode.host/#/requirement/${requirement_id}**

**上报字段包括**：需求ID、需求名称、PRD链接、ONES链接、开发者名称、AI新增行数、AI删除行数、首次AI新增行数、首次AI删除行数、总新增行数、总删除行数、各阶段进展数据（req_analysis / tech_design / dev_coding / test / archive）、Spec Commit 指标（spec_use_add_line / spec_use_delete_line / spec_total_add_line / spec_total_delete_line）

> **Spec Coding 代码覆盖率** 与 **Spec Code 无效代码率** 由统计平台根据上报的原始数据自动计算，无需 CLI 上报。

---

## 四、完整命令列表

| 命令 | 说明 |
|------|------|
| `init` | 初始化 Hook 配置和 spec-config.json |
| `init --platform <name>` | 指定平台：catpaw / cursor / claudecode |
| `stats` | 统计 AI 编码占比（核心功能） |
| `stats --base <branch>` | 指定基准分支（默认 master） |
| `stats --output <file>` | 保存报告到文件 |
| `stats --submit` | 将统计数据提交到统计平台 |
| `bindOnes` | 绑定 ONES 需求信息 |
| `setLabel --key <k> --value <v> [--tips <t>]` | 设置自定义指标（相同 key 自动覆盖） |
| `setFirstData --firstAiAddLine <n> --firstAiDeleteLine <n>` | 设置首次 AI 编辑行数 |
| `setSpecCommit --commits <commits>` | 设置 Spec Commit 号（逗号分隔，追加模式） |
| `updateStage --stage <名称> --type <类型> --value <值> [--tips <备注>] [--submit]` | 更新任务各阶段进展 |
| `addRecord` | 手动记录一次文件变更（Hook 自动调用） |
| `list` | 列出所有 AI 变更记录 |
| `list --json` | 以 JSON 格式输出记录 |
| `clear` | 清空当前分支的所有记录 |
| `config` | 查看/修改项目配置 |
| `formatTime <时间戳>` | 时间戳格式化（毫秒 → 可读字符串） |

---

## 五、自定义指标（Label）

除 ONES 绑定外，可以为当前分支附加任意自定义指标，用于标记迭代、团队、优先级等维度。指标以 `key / value / tips` 三元组形式存储在 `label.json` 中，`stats --submit` 时一并提交。

### 命令

```bash
ai-coding-stats setLabel \
  --key "<指标key>" \
  --value "<指标值>" \
  --tips "<可选备注>"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--key` | ✅ | 指标唯一标识，相同 key 直接覆盖已有值 |
| `--value` | ✅ | 指标值 |
| `--tips` | ❌ | 备注说明，默认空字符串 |

### 示例

```bash
ai-coding-stats setLabel --key "一次生码率" --value "97.2%" --tips "Agent 生成的代码无需人工修改直接通过的行数占比"
ai-coding-stats setLabel --key "team" --value "终端组"
ai-coding-stats setLabel --key "一次生码率" --value "98.5%"  # 覆盖已有的同 key 记录
```

生成的 `label.json`：

```json
[
  { "key": "一次生码率", "value": "98.5%", "tips": "Agent 生成的代码无需人工修改直接通过的行数占比" },
  { "key": "team",      "value": "终端组",  "tips": "" }
]
```

---

## 六、任务各阶段进展（updateStage）

用于记录任务在 Spec Coding 各阶段的进展信息，支持 **5 个阶段**：需求分析、方案设计、编码、测试、归档。每个阶段可记录多条进展内容，数据存储在 `stage.json` 中，`stats --submit` 时随任务记录一并上报。

### 命令

```bash
ai-coding-stats updateStage \
  --stage "<阶段名称>" \
  --type "<类型>" \
  --value "<值>" \
  --tips "<可选备注>"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--stage` | ✅ | 阶段名称，可选值见下方映射表 |
| `--type` | ✅ | 内容类型标识，如 `command`、`skill` 等 |
| `--value` | ✅ | 内容值，**同一阶段内相同 value 会覆盖已有记录** |
| `--tips` | ❌ | 备注说明，默认空字符串 |
| `--submit` | ❌ | 更新后自动执行 `stats --submit` |

### 支持的阶段名称与上报字段

| 阶段名称 | 上报字段名 | 说明 |
|---------|-----------|------|
| `需求分析` | `req_analysis` | 需求分析阶段进展 |
| `方案设计` | `tech_design` | 方案设计阶段进展 |
| `编码` | `dev_coding` | 编码实现阶段进展 |
| `测试` | `test` | 测试阶段进展 |
| `归档` | `archive` | 归档阶段进展 |

### 去重规则

- 同一阶段内，**相同的 `value` 只保留一条**，后设置的覆盖先设置的（包括 `type` 和 `tips`）
- 不同 `value` 的记录可在同一阶段共存

### 示例

```bash
# 需求分析阶段添加进展
ai-coding-stats updateStage --stage "需求分析" --type command --value "需求分析" --tips ""
ai-coding-stats updateStage --stage "需求分析" --type skill --value "req_analysis_skill" --tips "校验需求完备度"

# 覆盖已有 value
ai-coding-stats updateStage --stage "需求分析" --type command --value "需求分析" --tips "已补充 PRD 链接"

# 不同阶段
ai-coding-stats updateStage --stage "编码" --type command --value "编码实现" --tips "核心功能开发"

# 更新后自动触发统计+提交
ai-coding-stats updateStage --stage "归档" --type command --value "归档完成" --tips "代码已合入主分支" --submit
```

生成的 `stage.json`：

```json
{
  "req_analysis": [
    { "type": "command", "value": "需求分析", "tips": "已补充 PRD 链接" },
    { "type": "skill", "value": "req_analysis_skill", "tips": "校验需求完备度" }
  ],
  "tech_design": [],
  "dev_coding": [
    { "type": "command", "value": "编码实现", "tips": "核心功能开发" }
  ],
  "test": [],
  "archive": [
    { "type": "command", "value": "归档完成", "tips": "代码已合入主分支" }
  ]
}
```

**上报规则**：有内容的阶段以 JSON 数组字符串上报；无内容的阶段（空数组）以**空字符串**上报。

---

## 七、设置 Spec Commit（setSpecCommit）

用于记录方案设计阶段产出的 Spec Commit 号，是计算 **Spec Coding 代码覆盖率** 与 **Spec Code 无效代码率** 的前置步骤。commit 号保存在 `spec.json` 中，`stats --submit` 时自动读取并计算相关指标后上报。

### 命令

```bash
ai-coding-stats setSpecCommit --commits "<commit1>,<commit2>,..."
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--commits` | ✅ | 逗号分隔的 commit hash 列表，支持单个或多个 |

### 追加模式

多次调用会**追加**而非覆盖：新 commit 号与已有记录自动去重合并，不会丢失之前设置的 commit。

### 示例

```bash
# 设置单个 Spec Commit
ai-coding-stats setSpecCommit --commits "xxxxxxx"

# 一次性设置多个
ai-coding-stats setSpecCommit --commits "xxxxxxx,yyyyyyy"

# 追加新的 Spec Commit（不影响已有记录）
ai-coding-stats setSpecCommit --commits "newcommit1"
```

生成的 `spec.json`：

```json
{
  "commits": ["commit1", "commit2", "commit3"],
  "updated_at": 1741234567890
}
```

> 设置完成后，执行 `stats` 或 `stats --submit` 时会自动读取 spec.json，对每个 commit 统计其引入的行变更与在分支 diff 中的实际使用量。

---

## 八、首次 AI 编辑行数（setFirstData）

用于记录 Agent **首次**对文件进行编辑时的新增和删除行数。一般用于 Spec Coding 首次完成 AI 编码后设置。数据存储在 `first-data.json` 中，`stats` 时自动读取展示，`--submit` 时以 `first_ai_add_line` / `first_ai_delete_line` 字段上报。

### 命令

```bash
ai-coding-stats setFirstData \
  --firstAiAddLine <首次AI新增行数> \
  --firstAiDeleteLine <首次AI删除行数>
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--firstAiAddLine` | ❌ | 首次 AI 新增行数，未传则保留已有值 |
| `--firstAiDeleteLine` | ❌ | 首次 AI 删除行数，未传则保留已有值 |

### 示例

```bash
ai-coding-stats setFirstData --firstAiAddLine 30 --firstAiDeleteLine 20
```

生成的 `first-data.json`：

```json
{
  "firstAiAddLine": 30,
  "firstAiDeleteLine": 20
}
```

---

## 九、配置说明

执行 `init` 后，配置文件生成在项目根目录 `spec-config.json`（JSON 格式），可根据项目实际情况修改：

```json
{
  "base_branch": "master",
  "fileExtensions": [],
  "includeDirectories": []
}
```

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `base_branch` | string | `"master"` | stats 统计时对比的基准分支 |
| `fileExtensions` | string[] | `[]`（统计所有）| 要统计的文件扩展名 |
| `includeDirectories` | string[] | `[]`（统计所有）| 要统计的目录（相对于项目根目录） |

### 查看与修改配置

```bash
# 人性化格式查看
ai-coding-stats config

# JSON 格式查看
ai-coding-stats config --json

# 修改配置项
ai-coding-stats config --set base_branch develop
ai-coding-stats config --set fileExtensions '[".js",".ts",".tsx"]'
ai-coding-stats config --set includeDirectories '["src/"]'
```

---

## 十、数据存储格式

所有运行时数据存储在 `.git/catpaw/agent-code-stats/<branch-name>/` 目录下：

### 变更记录（按源文件分散存储）

每条记录一个 JSON 文件：

```json
{
  "id": "rec-abc123",
  "file_path": "/绝对路径/src/index.tsx",
  "date": 1741234567890,
  "branch": "feature/my-branch",
  "change_type": "新增",
  "change_code": "const foo = 1;\nconst bar = 2;",
  "added_lines": 2,
  "deleted_lines": 0
}
```

### ONES 需求绑定（ones-info.json）

```json
{
  "task_id": "",
  "task_name": "",
  "ones_url": "",
  "requirement_id": "",
  "requirement_name": "",
  "prd_url": "",
  "requirement_ones_url": "",
  "start_time": "",
  "end_time": null,
  "bound_at": null,
  "raw_url": ""
}
```

### 自定义指标（label.json）

```json
[
  { "key": "一次生码率", "value": "98.5%", "tips": "..." }
]
```

### 阶段进展（stage.json）

```json
{
  "req_analysis": [],
  "tech_design": [],
  "dev_coding": [],
  "test": [],
  "archive": []
}
```

每条进展项格式：`{ "type": "<类型>", "value": "<值>", "tips": "<备注>" }`

### 首次 AI 编辑行数（first-data.json）

```json
{
  "firstAiAddLine": 30,
  "firstAiDeleteLine": 20
}
```

### Spec Commit 列表（spec.json）

```json
{
  "commits": ["commit1", "commit2"],
  "updated_at": 1741234567890
}
```

---

## 十一、文件结构

```
.catpaw/skills/spec-coding-stats/           # skill 目录（只读）
├── SKILL.md                                 # Agent Skill 指令文档
└── references/
    ├── README.md                            # 功能介绍（当前文件）
    └── metrics.md                           # 指标详细说明

# ============================================================
#  🖥️ @wmfe/ai-coding-stats — 核心驱动 CLI
# ============================================================
# 安装方式：npm i -g @wmfe/ai-coding-stats
# npm 地址：https://r.npm.sankuai.com/package/@wmfe/ai-coding-stats
# 所有命令通过 ai-coding-stats <command> 调用

# init 命令在项目目录生成（可提交到 git）：
<repo-root>/.catpaw/hooks.json              # CatPaw hook 配置
<repo-root>/.cursor/hooks.json             # Cursor hook 配置
<repo-root>/.claude/settings.local.json     # Claude Code hook 配置（优先）
<repo-root>/.claude/settings.json          # Claude Code hook 配置（备选）
<repo-root>/spec-config.json           # 项目级通用配置（JSON 格式）

# 运行时数据存储在 .git 目录下（不被 git 追踪）：
<repo-root>/.git/catpaw/agent-code-stats/<branch-name>/
├── <file_safe_name>.json                   # 变更记录（按源文件路径分散存储）
├── ones-info.json                          # ONES 需求绑定信息
├── label.json                              # 自定义指标列表
├── first-data.json                         # 首次 AI 编辑行数
├── spec.json                               # Spec Commit 号列表
└── stage.json                              # 各阶段进展数据
```

---

## 十二、注意事项

- **必须配置 Hook**：Hook 未配置时，AI 编辑记录将无法自动保存，`stats` 无法区分 AI 与人工代码。请务必执行 `init` 完成初始化。
- **ONES 绑定**：`--submit` 上报前需先绑定 ONES 需求（`bindOnes`）。用户必须提供**任务链接**（非需求链接），任务和需求须在同一空间。
- **数据安全性**：数据仅存储在本地 `.git` 目录，不会被推送到远程仓库。
- **可重复执行**：`stats` / `updateStage --submit` 支持随时重复执行，每次基于最新状态重新计算/更新；`--submit` 时若数据已存在会自动更新而非报错。
- **版本检查**：Skill 激活时会自动检测 **`@wmfe/ai-coding-stats`** 是否为最新版本，非最新时会自动安装更新。
