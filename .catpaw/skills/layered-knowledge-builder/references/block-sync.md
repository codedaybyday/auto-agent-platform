> 本文件是 SKILL.md 的详细执行步骤，由主文件按需引用加载。

# 第七步：从本地 Git 项目同步到 Block AI 平台（详细步骤）

全部知识库本地生成完成后，询问用户是否将本地 Git 项目同步到 Block AI 平台：

```
🌐 是否将本地知识库同步到 Block AI 平台？

📂 知识库位置：<项目根目录>/knowledge_hub/（11 个知识文件）
同步后，你的团队成员可以通过 Block AI 检索和使用这些知识条目。

  ✅ 是 → 读取项目中 knowledge_hub/ 下的 md 文件，逐个上传到 Block AI
  ❌ 否 → 跳过，仅保留本地文件
```

用户回答「否」或「跳过」→ 直接结束，展示知识库文件夹路径。

用户回答「是」→ 进入 Step S-0 开始同步流程。

---

## Step S-0：前置检查（block-kb-cli）

```bash
# 检查 block-kb-cli 是否可用
block-kb-cli --version
```

若命令不存在，先安装（参见 SKILL.md Step 0）：

```bash
mtskills i block-kb --registry http://r.npm.sankuai.com
```

检查认证状态：

```bash
block-kb-cli config
```

- 若 token 有效 → 进入 Step S-1
- 若未认证或 token 失效 → 触发 CIBA 大象授权：

```bash
block-kb-cli kb list
# 提示用户在大象 App 点击同意授权，等待认证完成
```

---

## Step S-1：自动解析用户组织信息 + 收集知识库元信息

在同步前，先通过 `block-kb-cli` 自动解析当前用户的组织信息，用于生成**三层结构**：知识空间 → 知识库分组 → 知识库。严格按照此三层结构进行命名及上传，禁止因为名称相似而误传

> 📐 **三层命名规则**
> | 层级 | 名称来源 |
> |------|---------|
> | 知识空间（Space） | 创建人的**上上上级**组织名称 |
> | 知识库分组（Group） | 创建人的**上上级**组织名称 |
> | 知识库（KB） | 创建人的**上级**组织名 + `-` + 项目名称 |

### Step S-1-0：获取当前用户 empId

从 `~/.block-ai-config` 中读取当前用户 MIS，再通过 empId 接口反查组织信息：

```bash
# 1. 读取 MIS
CURRENT_MIS=$(node -e "
const fs = require('fs');
const p = process.env.HOME + '/.block-ai-config';
if (fs.existsSync(p)) {
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  console.log(cfg.defaultMis || '');
} else { console.log(''); }
")

# 2. 通过 block-kb-cli emp 接口查询当前用户信息（MIS → empId 需先查 creator 字段）
# 方案：先用 kb list 取一个自己创建的知识库，从 creator 字段拿 empId
block-kb-cli kb list
```

> **实现说明：** 使用 `block-kb-cli kb create` 创建任意临时知识库取到 `creator` 后删除。

### Step S-1-1：查询当前用户的组织层级（向上递归三层）

拿到 empId 后，通过 `block-kb-cli emp by-ids` 查询组织信息，向上递归获取**三个不同的**组织名称：

```bash
# 查询当前用户信息
block-kb-cli emp by-ids <empId>

# 返回字段中提取：
# - orgName: 直属部门名称（上级组织，用于 "知识库名称前缀"）
# - reportEmpId: 直属上级 empId（用于向上查询）
```

**递归查询逻辑（伪代码）：**

```
CURRENT_EMP_INFO = block-kb-cli emp by-ids <empId>
L1_ORG_NAME = CURRENT_EMP_INFO.orgName   // 上级组织（直属部门，知识库名称前缀）

// 向上查询直属上级 → 获取上上级组织名（分组名）
REPORT_EMP_ID = CURRENT_EMP_INFO.reportEmpId
REPORT_EMP_INFO = block-kb-cli emp by-ids <REPORT_EMP_ID>
L2_ORG_NAME = REPORT_EMP_INFO.orgName

// 若 L2_ORG_NAME == L1_ORG_NAME（同一部门），继续向上查
WHILE L2_ORG_NAME == L1_ORG_NAME:
  NEXT_REPORT_ID = REPORT_EMP_INFO.reportEmpId
  REPORT_EMP_INFO = block-kb-cli emp by-ids <NEXT_REPORT_ID>
  L2_ORG_NAME = REPORT_EMP_INFO.orgName

// 继续向上查询 → 获取上上上级组织名（空间名）
REPORT_EMP_ID_2 = REPORT_EMP_INFO.reportEmpId
REPORT_EMP_INFO_2 = block-kb-cli emp by-ids <REPORT_EMP_ID_2>
L3_ORG_NAME = REPORT_EMP_INFO_2.orgName

// 若 L3_ORG_NAME == L2_ORG_NAME（同一部门），继续向上查
WHILE L3_ORG_NAME == L2_ORG_NAME:
  NEXT_REPORT_ID_2 = REPORT_EMP_INFO_2.reportEmpId
  REPORT_EMP_INFO_2 = block-kb-cli emp by-ids <NEXT_REPORT_ID_2>
  L3_ORG_NAME = REPORT_EMP_INFO_2.orgName

// 最终得到三个不同的组织名称：
// L1_ORG_NAME = 上级组织（直属部门名） → 知识库名称前缀
// L2_ORG_NAME = 上上级组织（大组名）  → 分组名
// L3_ORG_NAME = 上上上级组织（更大组）→ 空间名
```

> ⚠️ 向上递归时，若某一层查询返回为空（到达组织顶层），则用已获得的最高层名称补位。例如，若 L3_ORG_NAME 为空，则用 L2_ORG_NAME 作为空间名。

### Step S-1-2：自动生成三层命名

```
知识空间名 = L3_ORG_NAME（上上上级组织名称）
知识库分组名 = L2_ORG_NAME（上上级组织名称）
知识库名称   = L1_ORG_NAME + "-" + 项目名称
```

**示例：**
- 当前用户部门：`神券业务组`，上上级部门：`营销研发组`，上上上级：`到店事业群`，项目名：`coupon-h5`
- → 空间名：`到店事业群`
- → 分组名：`营销研发组`
- → 知识库名：`神券业务组-coupon-h5`

### Step S-1-3：检查空间是否已存在，若无则创建

```bash
# 搜索平台上是否已有同名空间
block-kb-cli space list --name "<L3_ORG_NAME>"
```

- 若已存在同名空间 → **复用该空间 ID**，跳过创建，使用已有空间
- 若不存在 → 自动创建：

```bash
cat > /tmp/space-create.json << EOF
{
  "name": "<L3_ORG_NAME>",
  "description": "<L3_ORG_NAME> 知识空间"
}
EOF
block-kb-cli space create --json /tmp/space-create.json
# 从返回值中提取 SPACE_ID
```

> ⚠️ **同名空间不重复创建**：若 `space list --name` 返回非空列表，直接取第一条的 `id` 作为 SPACE_ID，不再新建。

### Step S-1-4：检查分组是否已存在，若无则在空间下创建

```bash
# 在该空间下搜索同名分组（必须同时指定 space-id，避免跨空间同名误判）
block-kb-cli group list --space-id <SPACE_ID> --name "<L2_ORG_NAME>"
```

- 若已存在同名分组（同一空间内） → **复用该分组 ID**，跳过创建
- 若不存在 → 在该空间下创建新分组：

```bash
cat > /tmp/group-create.json << EOF
{
  "space_id": <SPACE_ID>,
  "name": "<L2_ORG_NAME>",
  "description": "<L2_ORG_NAME> 知识库分组"
}
EOF
block-kb-cli group create --json /tmp/group-create.json
# 从返回值中提取 GROUP_ID
```

> ⚠️ **同名分组不重复创建**：在同一空间内，若已有同名分组，直接复用，不新建。

### Step S-1-5：向用户确认最终配置

```
📋 即将在 Block AI 平台创建以下知识库：

  知识空间：[L3_ORG_NAME]（上上上级组织，已存在/新建）
  知识库分组：[L2_ORG_NAME]（上上级组织，已存在/新建）
  知识库名称：[L1_ORG_NAME]-[project-name]
  描述：[项目描述，自动从 P1 信息提取]
  类型：项目类（project）
  条目数：N 个

  👤 当前用户：[mis]（[L1_ORG_NAME]）
  🏢 组织层级：[L1_ORG_NAME] → [L2_ORG_NAME] → [L3_ORG_NAME]

是否使用以上配置？（可以告诉我需要调整的地方）
```

- 用户确认 → 进入 Step S-2（创建知识库）
- 用户需要修改 → 记录修改后进入 Step S-2

> ⚠️ 若 `emp by-ids` 无法获取组织信息（网络问题或 empId 为空），降级为手动模式：提示用户分别输入空间名、分组名和知识库名称，并在之前的步骤中使用手动输入值替代自动推导值。

**分类映射规则：**

| 知识库类型 | Block AI 分类值 |
|----------|----------------|
| 团队规范类（ORG/L0） | `standard` |
| 模板/脚手架类（L1） | `template` |
| 技能/工具类（L6） | `skill` |
| 项目业务类（L2~L5） | `project` |
| 默认（混合/不确定） | `project` |

---

## Step S-2：创建 Block AI 知识库

```bash
# 写入知识库创建请求
cat > /tmp/kb-create-payload.json << 'EOF'
{
  "name": "<知识库名称>",
  "description": "<知识库描述>",
  "category": "<分类值>",
  "labels": ["<项目名>", "AI知识库", "layered-kb"]
}
EOF

block-kb-cli kb create --json /tmp/kb-create-payload.json
```

> 返回值中提取 `id` 字段作为 `KB_ID`，后续所有文档上传均使用此 ID。

**创建成功示例输出：**

```
✅ 知识库创建成功
   名称：[知识库名称]
   ID：<kb_id>
   链接：https://block.sankuai.com/ai-market/knowledge?catalog=<kb_id>
```

若创建失败（如名称重复）：

- 提示用户，询问是否使用已有同名知识库（展示已有知识库 ID 和链接）
- 或修改名称后重新创建

**知识库创建成功后，依次执行以下两步关联操作：**

**Step S-2-1：将知识库加入分组**

```bash
block-kb-cli group add-kbs <GROUP_ID> --kb-ids <KB_ID>
```

成功后输出：

```
✅ 知识库已加入分组
   分组：[L2_ORG_NAME]（ID: <group_id>）
   知识库：[知识库名称]（ID: <kb_id>）
```

**Step S-2-2：将知识库加入知识空间**

```bash
block-kb-cli space add-kbs <SPACE_ID> --kb-ids <KB_ID>
```

成功后输出：

```
✅ 知识库已加入知识空间
   空间：[L3_ORG_NAME]（ID: <space_id>）
   知识库：[知识库名称]（ID: <kb_id>）
```

> ⚠️ **操作顺序**：先 group add-kbs，再 space add-kbs。若 CLI 版本不支持 `space` 命令（< 0.1.6），跳过 Step S-2-2 并提示用户升级版本。

---

## Step S-3：从项目知识库文件夹读取文件并批量上传

遍历项目根目录下 `knowledge_hub/` 文件夹中的 11 个 md 文件，逐个读取文件内容并调用 `block-kb-cli doc create` 上传：

**上传循环（伪代码）：**

```
KB_ID = <Step S-2 返回的知识库 ID>
PROJECT_DIR = <项目根目录>/knowledge_hub/
成功数 = 0
失败列表 = []

# 按分层顺序定义上传文件列表
FILE_LIST = [
  "EXTERNAL.md",
  "ORG-1.md",
  "ORG-2.md",
  "L0-spec.md",
  "L1-architecture.md",
  "L2-modules.md",
  "L3-process.md",
  "L4-ops.md",
  "L5-onboarding.md",
  "L6-experience.md",
  "INDEX.md"
]

FOR EACH file in FILE_LIST:
  # 读取本地文件内容
  CONTENT = read(PROJECT_DIR + file)
  TITLE = 从文件第一行 # 标题提取，若无则用文件名
  SUMMARY = 从文件内容提取前 200 字摘要

  # 写入上传 payload
  写入 /tmp/doc-payload-{file}.json:
  {
    "knowledge_base_id": <KB_ID>,
    "title": "<TITLE>",
    "summary": "<SUMMARY>",
    "content": "<CONTENT>",
    "file_type": "md"
  }

  执行：block-kb-cli doc create --json /tmp/doc-payload-{file}.json

  成功 → 记录返回的 doc_id，在本地文件尾部追加 <!-- khub: docId=xxx -->，打印进度
  失败 → 记录到失败列表，继续下一条（不中断）

**上传进度展示（逐个输出）：**

```
📤 正在从 knowledge_hub/ 上传到 Block AI... (5/11)
  ✅ EXTERNAL.md → docId: xxxxx
  ✅ ORG-1.md → docId: xxxxx
  ✅ ORG-2.md → docId: xxxxx
  ✅ L0-spec.md → docId: xxxxx
  ✅ L1-architecture.md → docId: xxxxx
  ⏳ L2-modules.md → 上传中...
```

**上传策略：**
- 按分层顺序上传：EXTERNAL → ORG-1 → ORG-2 → L0 → L1 → L2 → L3 → L4 → L5 → L6 → INDEX
- 单条失败不中断，继续上传后续条目
- 上传成功后在本地文件中标注 docId（尾部注释）
- 失败条目在最终报告中汇总展示

---

## Step S-4：同步结果汇总

全部上传完成后，展示最终结果：

```
╔══════════════════════════════════════════════════════════╗
║          ✅ Block AI 平台同步完成                        ║
╚══════════════════════════════════════════════════════════╝

📂 知识库位置：<项目根目录>/knowledge_hub/
   所有知识文件的 docId 已标注在文件尾部注释中，随项目 Git 仓库管理

🏗️  三层结构：
   知识空间：[L3_ORG_NAME]（ID: <space_id>，已存在/新建）
   知识库分组：[L2_ORG_NAME]（ID: <group_id>，已存在/新建）
   知识库：[L1_ORG_NAME]-[project-name]（ID: <kb_id>，新建）

📚 知识库信息：
   名称：<知识库名称>
   ID：<kb_id>
   🔗 链接：https://block.sankuai.com/ai-market/knowledge?catalog=<kb_id>

📊 上传统计：
   ✅ 成功：N 个条目
   ❌ 失败：M 个条目（见下方）

[若有失败条目]
⚠️  以下条目上传失败，请手动处理：
   - <条目标题> → 错误：<错误信息>
   - <条目标题> → 错误：<错误信息>

💡 提示：
   - 团队成员可直接在 Block AI 搜索使用上传的知识条目
   - 如需更新内容，使用「kb push」命令或重新运行本 Skill
   - 知识库链接已记录在本地 INDEX.md 中
```

同时将知识库链接写入本地 INDEX.md 的头部：

```markdown
## Block AI 平台同步

- 知识空间：<L3_ORG_NAME>（ID: <space_id>）
- 知识库分组：<L2_ORG_NAME>（ID: <group_id>）
- 知识库名称：<名称>
- 知识库 ID：<kb_id>
- 平台链接：https://block.sankuai.com/ai-market/knowledge?catalog=<kb_id>
- 同步时间：<YYYY-MM-DD HH:mm>
- 条目数量：N 个
```

---

## Step S-5：同步异常处理

| 异常情况 | 处理方式 |
|----------|----------|
| 认证失败（401） | 执行 `block-kb-cli config --clear-token` 后重新触发 CIBA 授权 |
| 知识库名称重复 | 询问用户：使用已有知识库 ID 继续上传，或重命名创建新库 |
| 单条文档上传失败 | 记录失败条目，继续上传，最终在 Step S-4 汇总展示 |
| 全部失败（网络异常等） | 中断上传，提示用户检查网络后重试：「重新同步」或「跳过同步」 |
| 内容超长（超过平台限制） | 自动截断至前 10000 字符并添加「[内容已截断，完整版见本地文件]」 |
