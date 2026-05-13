---
name: spec-coding-stats
description: 记录 Agent 每次文件编辑的代码变更，并统计 AI 生成代码与人工代码的行数占比。Use when you need to record agent code changes, analyze agent coding ratio, or when the user mentions agent代码统计, agent编码占比, AI编码记录.
triggers: ["代码统计", "agent编码占比", "AI编码记录", "spec-coding-stats"]

metadata:
  skillhub.creator: "xutao42"
  skillhub.updater: "xutao42"
  skillhub.version: "V11"
  skillhub.source: "FRIDAY Skillhub"
  skillhub.skill_id: "3380"
  skillhub.high_sensitive: "false"
---

# Agent Code Stats Skill

通过全局安装的 `@wmfe/ai-coding-stats` CLI 记录 Agent 每次文件编辑的代码变更，并统计 AI 生成代码与人工代码的行数占比。

## 前置检查：确保安装最新版本

每次执行命令前，先检查 `@wmfe/ai-coding-stats` 是否已安装**最新版本**：

```bash
node -e "const cp=require('child_process');const r='http://r.npm.sankuai.com';try{const v=cp.execSync('npm list -g @wmfe/ai-coding-stats --depth=0 --json',{stdio:['pipe','pipe','pipe']}).toString();const d=JSON.parse(v);const pkgs=Object.keys(d.dependencies||{});if(!pkgs.length)throw new Error('no_pkg');const installed=d.dependencies[pkgs[0]].version;const latest=cp.execSync('npm view @wmfe/ai-coding-stats version --registry='+r,{stdio:['pipe','pipe','pipe']}).toString().trim();process.stdout.write(installed===latest?'latest':'outdated:'+installed+'->'+latest)}catch(e){process.stdout.write('not_installed')}"
```

- 如果输出 **`latest`**：已为最新版本，无需操作
- 如果输出 **`outdated:x.y.z->a.b.c`**：版本过旧，需更新到最新版
- 如果输出 **`not_installed`**：尚未安装，需执行安装

当检测到非最新版本（`outdated` 或 `not_installed`）时，执行以下命令安装或更新至最新版本：

```bash
npm install -g @wmfe/ai-coding-stats@latest --registry=http://r.npm.sankuai.com
```

**此步骤必须在每次 skill 激活时执行一次，否则 CLI 不存在或版本过旧导致运行失败。**

## 功能概述

专门记录 **Agent 在本次 Spec Coding 流程内** 产生的文件变更，并通过与 Git 分支差异对比，统计：

| 指标 | 说明 |
|------|------|
| **AI 新增行数** | diff 中的新增行，且该行出现在 Agent 记录中 |
| **AI 删除行数** | diff 中的删除行，且该行出现在 Agent 记录中 |
| **人工新增行数** | diff 中的新增行，但未在 Agent 记录中找到 |
| **人工删除行数** | diff 中的删除行，但未在 Agent 记录中找到 |
| **AI 新增占比** | AI新增 / (AI新增 + 人工新增) |
| **AI 变更占比** | (AI新增 + AI删除) / 总变更行数 |
| **首次AI新增行数** | 通过 setFirstData 命令设置，记录Agent 首次生成的代码行数 |
| **阶段进展** | 通过 updateStage 命令设置，记录任务各阶段（需求分析/方案设计/编码/测试/归档）的进展信息 |
| **Spec使用新增行数** | 当前分支 diff 中，属于 spec commit 的新增行数 |
| **Spec使用删除行数** | 当前分支 diff 中，属于 spec commit 的删除行数 |
| **Spec总新增行数** | spec commit 本身引入的总新增行数 |
| **Spec总删除行数** | spec commit 本身引入的总删除行数 |
| **Spec Coding代码覆盖率** | (Spec使用新增 + Spec使用删除) / (总新增 + 总删除)，衡量 spec commit 对分支变更的覆盖程度 |
| **Spec Code无效代码率** | 1 - (Spec使用新增 + Spec使用删除) / (Spec总新增 + Spec总删除)，衡量 spec commit 中未被实际使用的代码占比 |

## 工作原理

1. **记录阶段**：每次 Agent 编辑文件后，`after-file-edit` hook 自动调用 `ai-coding-stats addRecord`，将变更代码片段写入 `.git/catpaw/agent-code-stats/` 目录
2. **统计阶段**：执行 `ai-coding-stats stats` 命令时，通过 `git diff <base>...HEAD` 获取所有变更行，然后逐行与缓存中的记录进行匹配，判断每行是否为 AI 生成

## Hook 集成

Hook 脚本会在 Agent 每次编辑文件后自动触发，无需手动调用。

### IDE Hook 配置（重要）

在**项目根目录**执行 `init` 命令，完成 hook 配置和 `spec-config.json` 的写入。

**初始化流程分两种情况**：

#### 情况 A：`spec-config.json` 已存在（跳过询问）

先检查配置文件是否已存在：

```bash
ai-coding-stats config >/dev/null 2>&1 && echo "exists" || echo "not_exists"
```

若已存在，**直接执行 `init` 即可，不再询问用户**：

```bash
ai-coding-stats init
```

> 原因：配置文件已说明用户之前已设置过配置，无需重复询问。如需修改配置可使用 `ai-coding-stats config --set` 命令。

#### 情况 B：`spec-config.json` 不存在（首次初始化，需询问）

**首次初始化时必须先收集用户以下三项配置**，收集完毕后再执行 `init` + `config --set` 命令。

##### Step 1：收集用户配置（双路径策略）

Agent 需要收集以下三个配置项：

| # | 收集内容 | 默认值 | 说明 |
|---|---------|--------|------|
| 1 | **基准分支** | `master` | stats 统计时对比的基准分支名 |
| 2 | **统计的文件格式** | `（空，统计所有）` | 要统计的文件扩展名列表，如 `.js,.ts,.tsx`（逗号分隔），留空表示统计所有文件 |
| 3 | **统计代码变更目录** | `（空，统计所有目录）` | 要统计的代码目录（相对于项目根目录），如 `src/`，留空表示统计所有目录 |

**根据当前环境是否提供 `AskQuestion` 工具，选择对应的收集方式**：

###### 路径 A：`AskQuestion` 工具可用（优先）

如果当前环境提供了 `AskQuestion` 结构化问答工具（如 CatPaw、Cursor 等支持交互式表单的 IDE），**优先使用该工具**以结构化方式收集配置。

调用方式示例：

```
AskQuestion({
  title: "Spec Coding Stats 初始化配置",
  questions: [
    {
      id: "base_branch",
      prompt: "请输入基准分支（stats 统计时对比的 Git 分支名）：",
      options: [
        { id: "master",  label: "master（默认）" },
        { id: "main",    label: "main" },
        { id: "develop", label: "develop" }
      ]
    },
    {
      id: "file_extensions",
      prompt: "请输入要统计的文件格式（逗号分隔，如 .js,.ts,.tsx），留空表示统计所有文件：",
      options: [
        { id: "all",         label: "统计所有文件（默认）" },
        { id: "js_ts",       label: ".js, .ts, .tsx" },
        { id: "js_ts_vue",   label: ".js, .ts, .tsx, .vue" }
      ]
    },
    {
      id: "include_dirs",
      prompt: "请输入要统计的代码目录（相对于项目根目录，如 src/），留空表示统计所有目录：",
      options: [
        { id: "all",  label: "统计所有目录（默认）" },
        { id: "src",  label: "src/" },
        { id: "cli",  label: "cli/" }
      ]
    }
  ]
})
```

工具返回后，从结果中提取每个问题的选项 `id` 作为用户选择值。

> **优势**：结构化表单展示，选项清晰，不会产生歧义，用户体验更好。

###### 路径 B：`AskQuestion` 工具不可用（降级为文本交互）

如果当前环境**没有**提供 `AskQuestion` 工具（如纯 CLI 环境、不支持交互式表单的 IDE 等），则**通过文本对话形式**逐项向用户询问配置。

以自然语言文本依次询问三项配置，每项展示默认值并告知用户可直接回车使用默认值：

> 📋 **请确认 Spec Coding Stats 初始化配置：**
>
> **1. 基准分支**（默认: `master`，直接回车使用默认值）：
> **2. 统计的文件格式**（默认: 统计所有文件，直接回车使用默认值；或输入如 `.js,.ts,.tsx`）：
> **3. 统计代码变更目录**（默认: 统计所有目录，直接回车使用默认值；或输入如 `src/`）：

等待用户回复后解析每项的输入值（空值 / 仅回车视为使用默认值）。

> **说明**：文本降级方案适用于不支持 `AskQuestion` 工具的环境，确保 skill 在各种 IDE/终端中均可正常工作。

##### Step 2：执行 init + 写入配置

收集完用户输入后（无论通过哪种路径），按顺序执行以下命令：

```bash
# 1. 执行 init（写入 hook 配置 + 生成 spec-config.json 默认配置到项目根目录）
ai-coding-stats init

# 2. 如果用户修改了基准分支（非 master），执行：
ai-coding-stats config --set base_branch "<用户输入的基准分支>"

# 3. 如果用户填写了文件格式，执行（JSON 数组格式）：
ai-coding-stats config --set fileExtensions '[".js",".ts",".tsx"]'

# 4. 如果用户填写了统计目录，执行（JSON 数组格式）：
ai-coding-stats config --set includeDirectories '["src/"]'
```

> **注意**：只有用户明确修改了默认值的项才需要执行对应的 `config --set` 命令。如果用户全部使用默认值，只需执行 `ai-coding-stats init` 即可。

#### 指定平台（可选）

```bash
ai-coding-stats init --platform catpaw      # 写入 .catpaw/hooks.json（默认）
ai-coding-stats init --platform cursor      # 写入 .cursor/hooks.json
ai-coding-stats init --platform claudecode  # 写入 .claude/settings.local.json（不存在则写入 settings.json）
```

配置说明：
- hook 会接收变更信息并自动调用 `addRecord` 记录 AI 生成的代码
- 只有配置了此 hook，才能准确统计 AI 生成代码与人工代码的占比

## 使用方法

### 绑定 ONES 需求

在首次生成报告前，需要将当前分支与 ONES 任务绑定。当用户提供 ONES 任务链接时，Agent 需按以下步骤自动获取任务和需求信息，然后执行绑定命令。

#### Step 1：解析任务链接

用户提供任务链接格式：
```
https://ones.sankuai.com/ones/product/{space_id}/workItem/task/detail/{task_id}
```

从链接中提取 `space_id` 和 `task_id`。

#### Step 2：获取任务信息

**优先使用 `web_fetch`** 获取任务详情：
```
https://ones.sankuai.com/ones/product/{space_id}/workItem/task/detail/{task_id}
```

从返回数据中提取以下字段：
- `task_id`: `data.id.value`
- `task_name`: `data.name.value`
- `ones_url`: 任务链接本身
- `parentId.value`: 父需求 ID（用于构造需求链接）
- `developer`: `data.createdBy.value`（ONES 任务创建者的 MIS ID，作为 developer 参数传入绑定命令）

**任务详情响应结构参考**（web_fetch 方式）：
```json
{
  "code": 200,
  "data": {
    "id": { "value": "任务ID" },
    "name": { "value": "任务名称" },
    "state": { "displayValue": "状态中" },
    "assigned": { "displayValue": "负责人姓名" },
    "createdBy": { "value": "创建人MIS ID", "displayValue": "创建人姓名" },
    "createdAt": { "value": "创建时间戳" },
    "expectStart": { "value": "期望开始时间戳" },
    "expectClose": { "value": "期望结束时间戳" },
    "expectTime": { "displayValue": "期望工时" },
    "parentId": { "value": "父需求ID" }
  }
}
```

> **⚠️ 降级策略**：如果当前环境没有 `web_fetch` 工具，或 `web_fetch` 请求失败（网络错误、403、超时等），则使用 **ee-ones skill** 的 CLI 命令作为降级方案：
>
> **执行步骤**：
> 1. 先通过 skill 系统加载（或手动搜索并读取）**ee-ones skill** 的 SKILL.md，了解 CLI 用法和认证方式
> 2. 确保 ones CLI 已安装：`which ones >/dev/null 2>&1 || npm install -g @ee/ones-cli --registry=http://r.npm.sankuai.com`
> 3. 使用 ones CLI 查询任务详情：
>
> ```bash
> ones workitem-detail -i <task_id> --json
> ```
>
> 从 CLI JSON 输出中提取对应字段（字段映射关系）：
>
> | 目标字段 | web_fetch 路径 | ones CLI 路径 |
> |---------|---------------|-------------|
> | `task_id` | `data.id.value` | `id.value` |
> | `task_name` | `data.name.value` | `name.value` |
> | `ones_url` | 任务链接本身 | 由 `projectId.value` + `task_id` 拼接：`https://ones.sankuai.com/ones/product/${projectId}/workItem/task/detail/${task_id}` |
> | `parentId` | `data.parentId.value` | `parentId.value`（父需求 ID） |
| `developer` | `data.createdBy.value`（MIS ID） | `createdBy.value`（创建者 MIS ID） |
> | `expectStart` | `data.expectStart.value` | `expectStart.value`（毫秒时间戳） |
> | `expectClose` | `data.expectClose.value` | `expectClose.value`（毫秒时间戳） |
>

#### Step 3：构造需求链接并获取需求信息

基于 Step 2 获取到的 `parentId`（父需求 ID），构造需求链接并获取需求信息。

**方式 A：优先使用 `web_fetch`**（如果 Step 2 使用的是 web_fetch 且可用）：
```
https://ones.sankuai.com/ones/product/{space_id}/workItem/requirement/detail/{requirement_id}
```

从返回数据中提取：
- `requirement_id`: `data.id.value`
- `requirement_name`: `data.name.value`
- `requirement_ones_url`: 构造的需求链接
- `start_time`: `data.createdAt.value`（毫秒时间戳，需转换为可读格式）
- `end_time`: `data.expectClose.value`（毫秒时间戳，需转换为可读格式）
- `description`: `data.description.displayValue`（用于提取 PRD 链接）

**需求详情响应结构参考**（web_fetch 方式）：
```json
{
  "code": 200,
  "data": {
    "id": { "value": "需求ID" },
    "name": { "value": "需求名称" },
    "description": { "displayValue": "需求描述内容" },
    "createdAt": { "value": "创建时间戳" },
    "expectClose": { "value": "期望结束时间戳" }
  }
}
```

> **⚠️ 降级策略**：如果 `web_fetch` 不可用或请求失败（与 Step 2 保持一致），使用 **ee-ones skill** CLI 命令：
>
> **执行步骤**（若 Step 2 已读取过 ee-ones SKILL.md 则跳过步骤 1）：
> 1. 通过 skill 系统加载（或手动搜索并读取）**ee-ones skill** 的 SKILL.md
> 2. 使用 ones CLI 查询需求详情：
>
> ```bash
> ones workitem-detail -i <requirement_id> --json
> ```
>
> 从 CLI JSON 输出中提取对应字段（字段映射关系）：
>
> | 目标字段 | web_fetch 路径 | ones CLI 路径 |
> |---------|---------------|-------------|
> | `requirement_id` | `data.id.value` | `id.value` |
> | `requirement_name` | `data.name.value` | `name.value` |
> | `requirement_ones_url` | 构造的需求链接 | 由 `projectId.value` + `requirement_id` 拼接 |
> | `start_time` | `data.createdAt.value` | `createdAt.value`（毫秒时间戳） |
> | `end_time` | `data.expectClose.value` | `expectClose.value`（毫秒时间戳，可能为空） |
> | `description` | `data.description.displayValue` | `desc`（HTML 格式，需从中提取 PRD 链接） |

#### Step 4：提取 PRD 链接

从 `data.description.displayValue` 中查找 `【MRD/BRD文档链接】` 后的 URL，提取为 `prd_url`（可能为空）。

#### Step 5：时间戳转换

ONES 返回的时间戳是毫秒级 Unix 时间戳，通过以下命令转换为 `YYYY-MM-DD HH:mm:ss` 格式的可读字符串：

```bash
ai-coding-stats formatTime <毫秒时间戳>
```

例如，将 `data.createdAt.value` 和 `data.expectClose.value` 分别转换为 `start_time` 和 `end_time`：

```bash
ai-coding-stats formatTime 1736906400000
# => 2025-01-15 10:00:00
```

> 命令输出即为最终值，直接作为 `start_time` / `end_time` 参数传入 Step 6 的绑定命令。输入为空或非法时脚本返回非零退出码。

#### Step 6：执行绑定命令

将上述步骤获取到的参数传给脚本：

```bash
ai-coding-stats bindOnes \
  --task_id "93779130" \
  --task_name "终端组-Spec Coding指标统计平台建设" \
  --ones_url "https://ones.sankuai.com/ones/product/50573/workItem/task/detail/93779130" \
  --requirement_id "93329401" \
  --requirement_name "智能化研发提效TG" \
  --prd_url "https://km.sankuai.com/collabpage/xxx" \
  --requirement_ones_url "https://ones.sankuai.com/ones/product/50573/workItem/requirement/detail/93329401" \
  --developer "xutao42"
```

**必填参数**：
- `task_id` - 任务ID
- `ones_url` - 任务 ONES 链接
- `requirement_id` - 关联的需求ID

**可选参数**：
- `task_name` - 任务名称
- `requirement_name` - 需求名称
- `prd_url` - PRD文档链接
- `requirement_ones_url` - 需求 ONES 链接
- `start_time` - 需求创建时间
- `end_time` - 需求结束时间
- `developer` - ONES 任务创建者的 MIS ID，从任务详情 `createdBy.value` 字段获取
- `metric_name` / `metric_value` / `extra_data` - 自定义字段

> **注意**：用户必须提供任务链接（非需求链接），任务和需求必须在同一个空间（`space_id` 相同）。

### 设置自定义指标（Label）

除 ONES 绑定外，可以为当前分支附加任意自定义指标，用于标记迭代、团队、优先级等维度。指标以 `key/value/tips` 三元组的形式存储在 `.git/catpaw/agent-code-stats/<branch>/label.json` 中。

**写入规则：若已存在相同 `key`，则直接覆盖其 `value`（以及 `tips`）；否则追加新条目。**

#### 命令格式

```bash
ai-coding-stats setLabel \
  --key "<指标key>" \
  --value "<指标值>" \
  --tips "<可选备注>"
```

**参数说明**：
- `--key`（必填）：指标的唯一标识符
- `--value`（必填）：指标值
- `--tips`（可选）：备注说明，默认为空字符串

#### 示例

```bash
# 新增一次生码率指标
ai-coding-stats setLabel \
  --key "一次生码率" --value "97.2%" --tips "Agent 生成的代码无需人工修改直接通过 CR/测试的行数占比"

# 新增团队标签
ai-coding-stats setLabel \
  --key "team" --value "终端组"

# 覆盖已有的一次生码率（相同 key 自动覆盖）
ai-coding-stats setLabel \
  --key "一次生码率" --value "98.5%"
```

执行后，`.git/catpaw/agent-code-stats/<branch>/label.json` 内容示例：

```json
[
  {
    "key": "一次生码率",
    "value": "98.5%",
    "tips": "Agent 生成的代码无需人工修改直接通过 CR/测试的行数占比"
  },
  {
    "key": "team",
    "value": "终端组",
    "tips": ""
  }
]
```

### 设置首次AI编辑行数（setFirstData）

用于记录 Agent **首次**对文件进行编辑时的新增和删除行数。一般用于 Spec Coding 首次完成 AI 编码后进行设置。数据存储在 `.git/catpaw/agent-code-stats/<branch>/first-data.json` 中，`stats` 时自动读取并在报告中展示，`--submit` 时以 `first_ai_add_line` 和 `first_ai_delete_line` 字段上报。

#### 命令格式

```bash
ai-coding-stats setFirstData \
  --firstAiAddLine <首次AI新增行数> \
  --firstAiDeleteLine <首次AI删除行数>
```

**参数说明**：
- `--firstAiAddLine`（可选）：首次AI新增行数，未传则保留已有值
- `--firstAiDeleteLine`（可选）：首次AI删除行数，未传则保留已有值

#### 示例

```bash
ai-coding-stats setFirstData --firstAiAddLine 30 --firstAiDeleteLine 20
```

执行后，`.git/catpaw/agent-code-stats/<branch>/first-data.json` 内容示例：

```json
{
  "firstAiAddLine": 30,
  "firstAiDeleteLine": 20
}
```

### 设置 Spec Commit 号（setSpecCommit）

用于设置 Spec Commit 的 commit 号列表，用于统计 **Spec Commit 指标**（Spec使用新增/删除行数、Spec总新增/删除行数、Spec Coding代码覆盖率、Spec Code无效代码率）。数据存储在 `.git/catpaw/agent-code-stats/<branch>/spec.json` 中，`stats` 时自动读取并计算相关指标，`--submit` 时以 `spec_use_add_line`、`spec_use_delete_line`、`spec_total_add_line`、`spec_total_delete_line` 字段上报。

#### 命令格式

```bash
ai-coding-stats setSpecCommit --commits "<commit号1>,<commit号2>,..."
```

**参数说明**：
- `--commits`（必填）：逗号分隔的 commit 号列表，支持完整 hash 或短 hash

#### 示例

```bash
# 设置单个 spec commit
ai-coding-stats setSpecCommit --commits "xxxxxxx"

# 设置多个 spec commit（逗号分隔）
ai-coding-stats setSpecCommit --commits "xxxxxxx,yyyyyyy"
```

**追加模式**：重复执行时会与已有的 commit 号合并去重，而非覆盖。

执行后，`.git/catpaw/agent-code-stats/<branch>/spec.json` 内容示例：

```json
{
  "commits": ["xxxxxxx", "yyyyyyy"],
  "updated_at": 1741234567890
}
```

### 更新任务各阶段进展（updateStage）

用于记录任务在各阶段的进展信息，支持 5 个阶段：**需求分析**、**方案设计**、**编码**、**测试**、**归档**。每个阶段可记录多条进展内容，数据存储在 `.git/catpaw/agent-code-stats/<branch>/stage.json` 中，`stats --submit` 时以 `req_analysis`、`tech_design`、`dev_coding`、`test`、`archive` 字段上报到服务端。

#### 命令格式

```bash
ai-coding-stats updateStage \
  --stage "<阶段名称>" \
  --type "<类型>" \
  --value "<值>" \
  --tips "<可选备注>"
```

**参数说明**：
- `--stage`（必填）：阶段名称，可选值为 `需求分析` | `方案设计` | `编码` | `测试` | `归档`
- `--type`（必填）：内容类型，如 `command`（命令）、`skill`（技能调用）等自定义类型标识
- `--value`（必填）：内容值，同一阶段内相同 `value` 会覆盖已有记录（去重）
- `--tips`（可选）：备注说明，默认为空字符串
- `--submit`（可选）：更新阶段后自动执行 `stats --submit`，一并统计数据并提交到服务端

#### 支持的阶段名称与字段映射

| 阶段名称 | 上报字段名 | 说明 |
|---------|-----------|------|
| `需求分析` | `req_analysis` | 需求分析阶段的进展 |
| `方案设计` | `tech_design` | 方案设计阶段的进展 |
| `编码` | `dev_coding` | 编码实现阶段的进展 |
| `测试` | `test` | 测试阶段的进展 |
| `归档` | `archive` | 归档阶段的进展 |

#### 去重规则

- 同一个阶段内，**相同的 `value` 只保留一条记录**
- 后设置的会**覆盖**先设置的（包括 `type` 和 `tips`）
- 不同 `value` 的记录可以共存于同一阶段

#### 示例

```bash
# 在需求分析阶段添加一条命令类型的进展
ai-coding-stats updateStage --stage "需求分析" --type command --value "需求分析" --tips ""

# 在需求分析阶段添加一条 skill 类型的进展（不同 value，追加）
ai-coding-stats updateStage --stage "需求分析" --type skill --value "req_analysis_skill" --tips "校验需求完备度"

# 覆盖已有的相同 value（type 和 tips 都会被更新）
ai-coding-stats updateStage --stage "需求分析" --type command --value "需求分析" --tips "已补充 PRD 链接"

# 在编码阶段添加进展
ai-coding-stats updateStage --stage "编码" --type command --value "编码实现" --tips "核心功能开发"

# 更新阶段后自动触发统计和提交
ai-coding-stats updateStage --stage "归档" --type command --value "归档完成" --tips "代码已合入主分支" --submit
```

执行后，`.git/catpaw/agent-code-stats/<branch>/stage.json` 内容示例：

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

**上报说明**：
- 使用 `--submit` 或在 `stats --submit` 时，各阶段数据会随任务记录一起提交到统计平台
- 有内容的阶段以 JSON 数组字符串形式上报（如 `[{"type":"command","value":"xxx","tips":""}]`）
- 无内容的阶段（空数组）以**空字符串**上报

### 统计 AI 编码占比

```bash
# 默认对比 master 分支（如果未绑定 ONES 会提示绑定）
ai-coding-stats stats

# 对比 develop 分支
ai-coding-stats stats --base develop

# 保存报告到文件
ai-coding-stats stats --output report.txt
ai-coding-stats stats -o report.txt

# 组合使用：对比指定分支并保存报告
ai-coding-stats stats --base develop --output report.txt

# 提交统计数据到统计平台（需先绑定 ONES 需求）
ai-coding-stats stats --submit
ai-coding-stats stats -s

# 组合使用：保存报告并提交到统计平台
ai-coding-stats stats --output report.txt --submit
```

**重复执行说明**：
- `stats` 命令**支持随时重复执行**，每次都会基于当前最新的 Git diff 和记录重新计算，生成最新报告
- 使用 `--submit` 提交时，若该需求/任务数据**已存在，会自动更新**（而非报错或跳过）；若不存在则创建新记录
- 因此，在已生成报告或已上报指标的情况下，**可以直接再次运行相同命令**，无需任何特殊处理

**提交参数说明**：
- 使用 `--submit` 或 `-s` 参数时，会将统计数据提交到 `https://dbpzj193oirpql1omt.database.sankuai.com/rest/v1/requirement_stats`
- 提交的数据包括：需求ID、需求名称、PRD链接、ONES链接、开发者名称、AI新增行数、AI删除行数、首次AI新增行数、首次AI删除行数、总新增行数、总删除行数、**各阶段进展数据**（req_analysis / tech_design / dev_coding / test / archive）、**Spec Commit 指标**（spec_use_add_line / spec_use_delete_line / spec_total_add_line / spec_total_delete_line）
- Spec Coding 代码覆盖率、Spec Code 无效代码率由平台根据上报数据自动计算，无需 CLI 上报
- 开发者名称自动从 Git 配置中获取（`git config user.name`）
- 提交成功后，可前往统计平台查看数据：**https://api-call-tracker-hub.mynocode.host/#/requirement/${requirement_id}**
- 上报完成后，**务必将统计平台链接 `https://api-call-tracker-hub.mynocode.host/#/requirement/${requirement_id}` 告知用户**，让用户知道可以在哪里查看数据

### 手动记录变更（一般由 hook 自动触发）

```bash
ai-coding-stats addRecord \
  --file_path "/绝对路径/src/index.tsx" \
  --change_type "新增" \
  --change_code "const foo = 1;"
```

**`change_type` 可选值**：`新增` | `删除`

### 列出所有记录

```bash
ai-coding-stats list

# JSON 格式
ai-coding-stats list --json
```

### 清空记录

```bash
ai-coding-stats clear
```

## 配置

执行 `init` 命令后，配置文件会生成在项目根目录的 `spec-config.json`（JSON 格式），可根据项目实际情况修改。

### 查看配置

```bash
# 人性化格式查看当前配置
ai-coding-stats config

# JSON 格式查看
ai-coding-stats config --json
```

### 修改配置

```bash
# 修改基准分支
ai-coding-stats config --set base_branch develop

# 设置要统计的文件扩展名（JSON 格式字符串）
ai-coding-stats config --set fileExtensions '[".js",".ts",".tsx"]'

# 设置要统计的目录（JSON 格式字符串）
ai-coding-stats config --set includeDirectories '["src/"]'
```

### 配置项说明

`spec-config.json` 的完整结构如下（位于**项目根目录**）：

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

## 数据格式

### 变更记录
每条记录存储在 `.git/catpaw/agent-code-stats/<branch-name>/<file_path_safe>.json` 中，格式如下：

```json
{
  "id": "rec-abc123",
  "file_path": "/绝对路径/src/index.tsx",
  "date": 1741234567890,
  "branch": "feature/my-branch",
  "ones_id": "",
  "spec_node": "",
  "change_type": "新增",
  "change_code": "const foo = 1;\nconst bar = 2;",
  "added_lines": 2,
  "deleted_lines": 0
}
```

### 阶段进展数据
存储在 `.git/catpaw/agent-code-stats/<branch-name>/stage.json` 中：

```json
{
  "req_analysis": [],
  "tech_design": [],
  "dev_coding": [],
  "test": [],
  "archive": []
}
```

**字段说明**：
| 字段 | 对应阶段 | 说明 |
|------|---------|------|
| `req_analysis` | 需求分析 | 需求分析阶段的进展列表 |
| `tech_design` | 方案设计 | 方案设计阶段的进展列表 |
| `dev_coding` | 编码 | 编码实现阶段的进展列表 |
| `test` | 测试 | 测试阶段的进展列表 |
| `archive` | 归档 | 归档阶段的进展列表 |

每条进展项格式：`{ "type": "<类型>", "value": "<值>", "tips": "<备注>" }`

### 首次AI编辑行数
存储在 `.git/catpaw/agent-code-stats/<branch-name>/first-data.json` 中：

```json
{
  "firstAiAddLine": 30,
  "firstAiDeleteLine": 20
}
```

### Spec Commit 数据
存储在 `.git/catpaw/agent-code-stats/<branch-name>/spec.json` 中：

```json
{
  "commits": ["xxxxxxx", "yyyyyyy"],
  "updated_at": 1741234567890
}
```

**字段说明**：
| 字段 | 类型 | 说明 |
|------|------|------|
| `commits` | string[] | spec commit 号列表（支持完整 hash 或短 hash） |
| `updated_at` | number | 最后更新时间戳 |

### ONES 需求绑定信息
存储在 `.git/catpaw/agent-code-stats/<branch-name>/ones-info.json` 中：

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
  "developer": "",
  "metric_name": null,
  "metric_value": null,
  "extra_data": null,
  "bound_at": null,
  "raw_url": ""
}
```

**字段说明**：
| 字段 | 来源 | 说明 |
|------|------|------|
| `task_id` | 任务详情 `data.id.value` | ONES 任务 ID（必填） |
| `task_name` | 任务详情 `data.name.value` | 任务名称 |
| `ones_url` | 用户输入的任务链接 | 任务 ONES 链接（必填） |
| `requirement_id` | 父需求 `data.id.value` | 关联的需求 ID（必填） |
| `requirement_name` | 父需求 `data.name.value` | 需求名称 |
| `prd_url` | 需求描述中解析 | PRD 文档链接 |
| `requirement_ones_url` | 构造的需求链接 | 需求 ONES 地址 |
| `start_time` | 父需求 `data.createdAt.value` | 需求创建时间 |
| `end_time` | 父需求 `data.expectClose.value` | 需求结束时间 |
| `developer` | 任务详情 `data.createdBy.value` | ONES 任务创建者的 MIS ID |
| `metric_name` | 自定义 | 自定义指标名称 |
| `metric_value` | 自定义 | 自定义指标值 |
| `extra_data` | 自定义 | 自定义字段 |
| `bound_at` | 绑定时间 | 绑定时间戳 |
| `raw_url` | 原始链接 | 用户输入的原始链接 |

## 文件结构

```
.catpaw/skills/spec-coding-stats/   # skill 目录（只读，勿手动修改）
├── SKILL.md                     # 说明文档（当前文件）
└── references/
    ├── README.md                # 功能介绍
    └── metrics.md               # 指标说明

# CLI 通过 npm 全局安装：@wmfe/ai-coding-stats
# 所有命令通过 ai-coding-stats <command> 调用

# init 命令在项目目录生成（可提交到 git）：
<repo-root>/.catpaw/hooks.json                    # CatPaw hook 配置
<repo-root>/.cursor/hooks.json                   # Cursor hook 配置
<repo-root>/.claude/settings.local.json           # Claude Code hook 配置（优先）
<repo-root>/.claude/settings.json                # Claude Code hook 配置（备选）
<repo-root>/spec-config.json                      # 项目级通用配置（JSON 格式，可提交到 git）

# 变更记录存储在 .git 目录下（不被 git 追踪，不会被提交）：
<repo-root>/.git/catpaw/agent-code-stats/<branch-name>/
├── <file_safe_name>.json   # 变更记录（按源文件路径分散存储）
├── ones-info.json          # ONES 需求绑定信息
├── label.json              # 自定义指标列表
├── first-data.json         # 首次AI编辑行数
├── spec.json               # Spec Commit 号列表
└── stage.json              # 各阶段进展数据
```

> **存储说明**：数据存放在 `.git/catpaw/agent-code-stats/` 目录，天然不被 git 追踪、不随 clone 传播、不受系统清理影响。有效期 **6 个月**，超期的分支目录会在下次 `addRecord` 时自动清理。
