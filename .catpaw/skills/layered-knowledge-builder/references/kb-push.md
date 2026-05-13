> 本文件是 SKILL.md 的详细执行步骤，由主文件按需引用加载。

# 推送/更新知识库功能（详细步骤）

> ⚠️ **工具使用说明**：本章节所有文档创建、更新、删除操作均使用 `block-kb-cli`，不使用 `@wmfe/kb-cli`。`@wmfe/kb-cli` 仅用于知识拉取（Step F 系列）。

当用户提到「更新知识库」、「上传文档」、「kb push」、「推送到平台」、「添加新文档」时，进入本流程。
**核心原则：先审后推，非本人创建需走审核通知流程。**

---

## Step P-0：前置准备

确保 `block-kb-cli` 已安装且版本最新（参见 SKILL.md Step 0 的检测流程），SSO token 有效。

获取当前用户 MIS（用于审核通知场景中标识提交人）：

```bash
CURRENT_MIS=$(node -e "
const fs = require('fs');
const p = process.env.HOME + '/.block-ai-config';
if (fs.existsSync(p)) {
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  console.log(cfg.defaultMis || '');
} else { console.log(''); }
")
```

若读取失败，从 `~/.openclaw/openclaw.json` 的 `mis` 字段获取，或直接询问用户。

---

## Step P-1：收集待推送变更（diff 分析）

**不直接执行 `kb push`**，先通过 `block-kb-cli` 获取云端文档列表，对比本地与云端差异，逐项进入安全审查。

```bash
# 获取云端文档列表
KB_ID=<知识库ID>
block-kb-cli doc list $KB_ID
```

返回的文档对象包含：`id`、`title`、`content`、`summary`、`creator`（创建人 empId）、`created_by`（MIS）、`updated_at` 等字段。

**关键字段：** 用 `creator` / `created_by` 字段判断文档创建人。

分类变更为三类：
- **UPDATE**：本地文档标题与云端匹配，但内容有差异 → 进入 Step P-2（内容安全审查）
- **CREATE**：本地有但云端无的文档 → 进入 Step P-4（执行新建）
- **DELETE**：云端有但本地无的文档（仅 `-d` 模式）→ 单独处理删除保护检查

---

## Step P-2：内容安全审查（更新文档）

**对每一篇待更新的文档，依次执行以下四项检查：**

### 检查 1：核心接口文档不可删除内容

文档标题或内容包含以下特征时，视为**核心接口文档**：

- 标题包含：`接口文档`、`API文档`、`接口规范`、`API规范`、`OpenAPI`、`接口契约`
- 内容包含：`method:`、`endpoint:`、`path:`、`POST /`、`GET /`、`接口地址`、`请求参数`、`响应结构`

**规则：** 核心接口文档中已有的接口定义（endpoint + method 组合）不可从更新内容中删除。

检查方式（伪代码）：

```
旧接口列表 = 从云端内容提取所有 endpoint 定义
新接口列表 = 从本地内容提取所有 endpoint 定义
被删除接口 = 旧接口列表 - 新接口列表

if 被删除接口 不为空:
  → 阻断，输出告警
```

告警格式：

```
🚨 [阻断] 核心接口文档不可删除接口定义
   文档：<title>
   被删除的接口：
     - DELETE /api/xxx
     - GET /api/yyy
   请补充被删除接口，或向用户说明删除原因后二次确认。
```

### 检查 2：安全规范不可降级

文档标题或内容包含以下特征时，视为**安全规范文档**：

- 标题包含：`安全规范`、`安全标准`、`安全要求`、`鉴权`、`权限管控`、`数据安全`、`加密`
- 内容包含：`必须`、`禁止`、`强制`、`不得`、`should not`、`MUST`、`MUST NOT`

**规则：** 安全规范文档中的强制性条款（含「必须」「禁止」「强制」「不得」等关键词的句子）不可在更新中消失或被削弱。

检查方式：

```
旧强制条款列表 = 从云端内容提取所有含强制性关键词的句子
新内容中是否仍包含这些条款（语义近似或原文保留）？

if 存在旧条款在新内容中消失:
  → 阻断，输出告警
```

告警格式：

```
🚨 [阻断] 安全规范不可降级
   文档：<title>
   以下强制性条款在更新后消失：
     - "所有 API 请求必须携带有效 Token"
     - "禁止明文传输密码"
   请保留上述条款，或说明降级原因后二次确认。
```

### 检查 3：架构决策记录不可覆盖

文档标题或内容包含以下特征时，视为**架构决策记录（ADR）**：

- 标题包含：`架构决策`、`ADR`、`技术选型`、`架构方案`、`设计决策`、`架构演进`
- 内容包含：`决策背景`、`决策结论`、`备选方案`、`Alternatives`、`Status:`、`Context:`

**规则：** ADR 文档只能追加新内容，不可修改或删除已记录的决策内容（标题、决策结论、状态字段）。

检查方式：

```
旧 ADR 条目 = 从云端内容提取所有「## 」开头的章节标题
新内容中是否仍保留这些章节？各章节核心结论是否被修改？

if 存在章节缺失 or 章节核心内容被替换:
  → 阻断，输出告警
```

告警格式：

```
🚨 [阻断] 架构决策记录不可覆盖
   文档：<title>
   以下决策章节在更新后消失或被修改：
     - "## 选用 React 而非 Vue（已定）"
   ADR 只允许追加新决策，不可修改历史记录。
   请补回原有章节，或说明原因后二次确认。
```

### 检查 4：内容冲突检测

检查本次更新内容是否与**同一知识库其他文档**存在**语义冲突或相悖**：

- 技术栈描述冲突（如某文档说用 React，另一文档说用 Vue）
- 接口路径冲突（同名接口两处定义不同）
- 版本号冲突（两处提到同一依赖但版本不同）
- 规范相悖（一处允许某行为，另一处禁止）

检查范围：与本次更新文档**同分层**（如同为 L1/L0）的已有文档。

若检测到冲突：

```
⚠️  [警告] 内容冲突检测
   当前更新文档：<title>
   与以下文档存在潜在冲突：
     - <冲突文档标题>（docId: xxx）
       冲突点：<具体冲突描述>

   建议：更新前先同步修改冲突文档，保持知识库一致性。
   是否仍要继续？（冲突警告不强制阻断，但需二次确认）
```

> 冲突检测为**警告级别**（非阻断），但仍需用户二次确认。

---

## Step P-2 执行结果处理

**所有检查通过 → 进入 Step P-3（执行更新）**

**任意阻断项触发 → 停止推送，向用户展示完整告警报告：**

```
╔══════════════════════════════════════════════════════════╗
║           ⛔ 内容安全检查未通过，推送已阻断              ║
╚══════════════════════════════════════════════════════════╝

文档：<title>

[阻断项]
  🚨 核心接口文档不可删除接口定义
     被删除接口：GET /api/user/info

[警告项]
  ⚠️  内容冲突：与「L1-架构概览.md」存在冲突

请修改以上问题后重新提交，或输入「强制确认」覆盖阻断继续推送。
```

**用户输入「强制确认」后：**

- 记录覆盖操作日志（含时间戳、操作人、被覆盖的检查项）
- 进入 Step P-3（执行更新）

---

## Step P-3：执行更新（直接尝试 + 权限降级）

内容安全审查通过后，先确认更新方式，再通过 `block-kb-cli` 执行更新。

**Step P-3-0：确认更新方式（强制，不可跳过）**

> ⚠️ **此步骤为强制阻断步骤**：必须等待用户明确回复后才能继续执行后续步骤。禁止使用默认值，禁止自动推断，禁止跳过。未收到用户明确回复前，不得进入 Step P-3-1。

向用户询问更新方式（每个待更新文档都需确认）：

```
📄 文档：<title>（ID: <doc_id>）

⚠️ 请选择更新方式（必须回复，无默认值）：
  1️⃣ 追加内容 → 将新内容添加到原文档末尾，保留原有内容
  2️⃣ 替换内容 → 用新内容完全替换原文档内容

请回复 1 或 2：
```

**等待用户回复**，记录用户选择，标记为 `UPDATE_MODE`：
- 用户回复 `1` 或 `追加` → `UPDATE_MODE = "append"`
- 用户回复 `2` 或 `替换` → `UPDATE_MODE = "replace"`
- 用户未回复或回复无关内容 → **再次询问，不得继续执行**

**Step P-3-1：准备更新内容**

```bash
# 根据 UPDATE_MODE 准备内容
if [ "$UPDATE_MODE" = "append" ]; then
  # 追加模式：先获取原文档内容，在末尾追加新内容
  # 通过 block-kb-cli doc info <doc_id> 获取原文档的 content 字段
  ORIGINAL_CONTENT="<从 block-kb-cli doc info 获取的原文档内容>"
  MERGED_CONTENT="${ORIGINAL_CONTENT}\n\n---\n\n${NEW_CONTENT}"
else
  # 替换模式：直接使用新内容
  MERGED_CONTENT="${NEW_CONTENT}"
fi

cat > /tmp/doc-update-payload.json << EOF
{
  "knowledge_base_id": <kb_id>,
  "title": "<title>",
  "summary": "<summary>",
  "content": "${MERGED_CONTENT}",
  "file_type": "<file_type>"
}
EOF
```

> **追加模式说明**：追加时通过 `block-kb-cli doc info <doc_id>` 获取原文档内容，将新内容用 `---` 分隔符追加到原内容末尾。若原文档获取失败，提示用户并降级为替换模式。

**Step P-3-2：直接尝试更新**

```bash
block-kb-cli doc update <doc_id> --json /tmp/doc-update-payload.json 2>&1
```

根据执行结果判断：

| 结果 | 判断条件 | 处理 |
|------|---------|------|
| ✅ 更新成功 | 退出码为 0，输出中包含更新成功信息 | 记录成功，进入 Step P-6 汇总 |
| 🔒 无写权限 | 退出码非 0，输出中包含 `401`、`403`、`forbidden`、`unauthorized`、`权限`、`permission` 等关键词（不区分大小写） | 进入 Step P-3-3 权限降级流程 |
| ❌ 其他错误 | 退出码非 0，但不匹配权限相关关键词 | 记录错误信息，提示用户排查（网络问题、token 过期等） |

**Step P-3-3：权限降级 → 审核通知流程**

当 `block-kb-cli doc update` 返回权限错误时，自动降级为审核通知模式。

> ⚠️ **草稿文档统一存放在指定知识库（ID: 697）中**，不在原文档所属知识库中创建草稿。

1. 告知用户当前无写权限：

```
🔒 你对该文档没有写权限，已自动切换为审核通知模式。

   📄 文档标题：<title>
   🔢 文档 ID：<doc_id>
   🔗 原文档链接：https://block.sankuai.com/ai-market/knowledge?catalog=<kb_id>&id=<doc_id>

正在将修改内容新建为草稿文档（草稿知识库 ID: 697），并通知文档管理者审核...
```

2. 将修改内容新建为一篇草稿文档（标题加「[待审核]」前缀），**固定存放在草稿知识库（ID: 697）中**：

```bash
cat > /tmp/review-doc.json << 'EOF'
{
  "knowledge_base_id": 697,
  "title": "[待审核] <原文档标题>",
  "summary": "由 <current_mis> 提交的更新，原文档所属知识库: <kb_id>，原文档 ID: <原doc_id>",
  "content": "<更新后的内容>"
}
EOF
block-kb-cli doc create --json /tmp/review-doc.json
```

3. 调用审核通知接口，通知文档管理者：

```bash
# 先获取文档详情以获取创建人信息
block-kb-cli doc info <doc_id>
# 从返回的 creator / created_by 字段获取创建人 MIS

# 基础 URL（newUrl 指向草稿知识库 697 中的新文档）
FEEDBACK_URL="https://user-experience.fe.test.sankuai.com/analyst/api/ai-cli/ai-knowledge/feedback?\
owner=<创建人mis号>\
&url=https://block.sankuai.com/ai-market/knowledge?catalog=<kb_id>&id=<原doc_id>\
&newUrl=https://block.sankuai.com/ai-market/knowledge?catalog=697&id=<新doc_id>\
&codeModifier=<当前用户mis号>"

# 追加模式时添加 isAddstr 参数
if [ "$UPDATE_MODE" = "append" ]; then
  FEEDBACK_URL="${FEEDBACK_URL}&isAddstr=true"
fi

curl -s "$FEEDBACK_URL"
```

4. 向用户展示结果：

```
✅ 审核通知已发送

📄 已将更新内容新建为草稿文档（草稿知识库 ID: 697）：
   标题：[待审核] <原标题>
   链接：https://block.sankuai.com/ai-market/knowledge?catalog=697&id=<新doc_id>

📮 已通知文档管理者进行审核。
   管理者审核通过后，原文档将被更新。
```

---

## Step P-4：执行新建（直接尝试 + 权限降级）

用户要在知识库下新建文档时，直接尝试创建，根据执行结果判断权限：

**Step P-4-1：准备新建内容**

```bash
cat > /tmp/doc-create-payload.json << 'EOF'
{
  "knowledge_base_id": <kb_id>,
  "title": "<title>",
  "summary": "<summary>",
  "content": "<content>",
  "file_type": "md"
}
EOF
```

**Step P-4-2：直接尝试新建**

```bash
block-kb-cli doc create --json /tmp/doc-create-payload.json 2>&1
```

根据执行结果判断：

| 结果 | 判断条件 | 处理 |
|------|---------|------|
| ✅ 创建成功 | 退出码为 0，输出中包含新文档 ID | 记录成功，进入 Step P-6 汇总 |
| 🔒 无写权限 | 退出码非 0，输出中包含 `401`、`403`、`forbidden`、`unauthorized`、`权限`、`permission` 等关键词（不区分大小写） | 进入 Step P-4-3 权限降级流程 |
| ❌ 其他错误 | 退出码非 0，但不匹配权限相关关键词 | 记录错误信息，提示用户排查 |

**Step P-4-3：权限降级 → 审核通知流程**

当 `block-kb-cli doc create` 返回权限错误时，自动降级为审核通知模式。

> ⚠️ **草稿文档统一存放在指定知识库（ID: 697）中**，不在原目标知识库中创建草稿。

1. 告知用户：

```
🔒 你对该知识库没有写权限，已自动切换为审核通知模式。

   📚 目标知识库名称：<name>
   🔢 目标知识库 ID：<kb_id>

正在将文档内容新建为草稿文档（草稿知识库 ID: 697），并通知知识库管理者审核...
```

2. 将待新建的文档内容存为草稿文档，**固定存放在草稿知识库（ID: 697）中**：

```bash
cat > /tmp/review-doc.json << 'EOF'
{
  "knowledge_base_id": 697,
  "title": "[待审核-新建] <文档标题>",
  "summary": "由 <current_mis> 提交的新建请求，目标知识库: <kb_id>",
  "content": "<文档内容>"
}
EOF
block-kb-cli doc create --json /tmp/review-doc.json
```

3. 获取知识库创建人信息并调用审核通知接口：

```bash
block-kb-cli kb info <kb_id>
# 从返回的 creator 字段获取创建人信息

curl -s "https://user-experience.fe.test.sankuai.com/analyst/api/ai-cli/ai-knowledge/feedback?\
owner=<知识库创建人mis号>\
&url=https://block.sankuai.com/ai-market/knowledge?catalog=<kb_id>\
&newUrl=https://block.sankuai.com/ai-market/knowledge?catalog=697&id=<新doc_id>\
&codeModifier=<当前用户mis号>\
&isAddstr=true"
```

4. 向用户展示结果：

```
✅ 审核通知已发送

📄 已将文档内容新建为草稿文档（草稿知识库 ID: 697）：
   标题：[待审核-新建] <文档标题>
   链接：https://block.sankuai.com/ai-market/knowledge?catalog=697&id=<新doc_id>

📮 已通知知识库管理者进行审核。
   管理者审核通过并授权后，文档将被迁移到目标知识库。
```

---

## Step P-6：推送结果汇总

```
╔══════════════════════════════════════════════════════════╗
║               ✅ 知识库推送完成                          ║
╚══════════════════════════════════════════════════════════╝

📚 知识库：<name>（ID: <kb_id>）

📊 推送统计：
  ➕ 新建：N 篇（直接上传）
  ✏️  更新：M 篇（追加：X 篇 / 替换：Y 篇）
  📮 待审核：K 篇（已通知创建人）
  ⛔ 已阻断：X 篇（安全检查未通过，用户取消）
  ⏭️  跳过：Y 篇（无变化）

💡 待审核文档需创建人在 Block 平台确认后生效。
```

---

## Step P-7：推送安全规则速查

| 规则 | 级别 | 处理 |
|------|------|------|
| 核心接口文档已有接口被删除 | 🚨 阻断 | 停止推送，告警，需二次强制确认 |
| 安全规范强制条款消失或被弱化 | 🚨 阻断 | 停止推送，告警，需二次强制确认 |
| 架构决策记录章节被删除/覆盖 | 🚨 阻断 | 停止推送，告警，需二次强制确认 |
| 内容与同层文档存在冲突 | ⚠️ 警告 | 提示冲突点，需用户确认后继续 |
| 更新文档返回 401/403 | 🔒 权限 | 自动降级：在草稿知识库（ID: 697）新建草稿 + 发送审核通知给管理者 |
| 新建文档返回 401/403 | 🔒 权限 | 自动降级：在草稿知识库（ID: 697）新建草稿 + 发送审核通知给管理者 |
| 更新文档（追加模式） | 📝 追加 | 获取原文档内容 + 追加新内容，审核通知添加 `isAddstr=true` |
| 安全检查通过 | ✅ 直接执行 | `block-kb-cli doc update` / `block-kb-cli doc create` 直接尝试，成功即完成 |
