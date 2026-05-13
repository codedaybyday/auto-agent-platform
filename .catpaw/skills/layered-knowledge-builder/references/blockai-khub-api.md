# block-kb-cli 命令与 JSON 约定
包名：**`@block/knowledge-cli`**，可执行名：**`block-kb-cli`**。
全局帮助：
```bash
block-kb-cli --help
block-kb-cli kb --help
block-kb-cli group --help
block-kb-cli space --help
block-kb-cli emp --help
block-kb-cli doc --help
```
---
## config
| 命令 | 说明 |
|------|------|
| `block-kb-cli config` | 打印配置文件路径、默认环境、MIS、token 缓存、知识库配置条数 |
| `block-kb-cli config --set-mis <mis>` | 设置默认 MIS |
| `block-kb-cli config --set-env prod\|test` | 设置默认请求环境 |
| `block-kb-cli config --clear-token` | 清除配置文件中的 token 缓存 |
---
## space（知识空间）⭐ 最外层结构

> **版本要求**：`@block/knowledge-cli >= 0.1.6`

| 命令 | 说明 |
|------|------|
| `space list [--name <name>]` | 知识空间列表（可按名称过滤） |
| `space create --json <文件>` | 创建知识空间 |
| `space info <id>` | 获取知识空间详情 |
| `space tree <id>` | 获取知识空间树（含直挂知识库和分组） |
| `space update --json <文件> <id>` | 更新知识空间，`id` 为正整数 |
| `space remove <id>` | 删除知识空间 |
| `space add-kbs <spaceId> --kb-ids <id1,id2,...>` | 添加知识库到知识空间 |
| `space remove-kbs <spaceId> --kb-ids <id1,id2,...>` | 从知识空间移除知识库 |

### 创建知识空间 JSON（`space create`）
- **必填**：`name`（非空字符串）
- **可选**：`description`（string）；`owner_user_ids`、`owner_org_ids`、`visitor_user_ids`、`visitor_org_ids`（字符串数组）

最小示例：
```json
{
  "name": "外卖终端",
  "description": "外卖终端团队知识空间"
}
```

### 知识空间响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 空间 ID（用于后续 group create、add-kbs 等） |
| `name` | string | 空间名称 |
| `creator` | string | 创建人 empId |
| `owner_user_ids` | string[] | 管理员 empId 列表 |

---
## group（知识库分组）

> **注意**：`group create` 必须指定所属 `space_id`（知识空间 ID）。

| 命令 | 说明 |
|------|------|
| `group list [--name <name>] [--space-id <id>]` | 分组列表（可按名称或空间 ID 过滤） |
| `group create --json <文件>` | 在指定知识空间下创建知识库分组 |
| `group info <id>` | 获取分组详情 |
| `group update <id> --json <文件>` | 更新分组，`id` 为正整数 |
| `group remove <id>` | 删除分组 |
| `group add-kbs <groupId> --kb-ids <id1,id2,...>` | 添加知识库到分组 |
| `group remove-kbs <groupId> --kb-ids <id1,id2,...>` | 从分组移除知识库 |

### 创建分组 JSON（`group create`）
- **必填**：`space_id`（**JSON number**，正整数，所属知识空间 ID）、`name`（非空字符串）
- **可选**：`description`（string）；`owner_user_ids`、`owner_org_ids`（**字符串数组**）

最小示例：
```json
{
  "space_id": 5,
  "name": "外卖研发组",
  "description": "外卖研发组知识库分组"
}
```

### 更新分组 JSON（`group update`）
- 至少 **一个** 合法字段；字段名白名单：`name`、`description`、`owner_user_ids`、`owner_org_ids`
- 若包含 `name`，须为非空字符串

最小示例：
```json
{
  "description": "更新后的分组说明"
}
```

### 分组增删知识库参数（`group add-kbs/remove-kbs`）
- `groupId`：正整数
- `--kb-ids`：逗号分隔正整数列表，至少 1 个（如 `123,456`）

---
## kb（知识库）
| 命令 | 说明 |
|------|------|
| `kb list` | 当前用户有权限的知识库列表 |
| `kb list --type\|--process\|--role\|--category <v>` | 按维度 value 筛选 |
| `kb categories` | 分类列表 |
| `kb types` | 自定义标签列表 |
| `kb processes` | 流程类型列表 |
| `kb roles` | 角色类型列表 |
| `kb create --json <文件>` | 创建知识库 |
| `kb info <id>` | 获取知识库详情（`GET .../knowledge-bases/find-one/:id`） |
| `kb update <id> --json <文件>` | 更新知识库，`id` 为正整数 |
| `kb remove <id>` | 删除知识库 |
### 创建知识库 JSON（`kb create`）
- **必填**：`name`（非空字符串）
- **可选**：`description`（string）；`type`、`process`、`role`、`category`（**字符串数组**）；`owner_user_ids`、`owner_org_ids`、`visitor_user_ids`、`visitor_org_ids`（字符串数组）；`is_private`（boolean）
最小示例：
```json
{
  "name": "示例知识库",
  "description": "说明"
}
```
### 更新知识库 JSON（`kb update`）
- 至少 **一个** 合法字段；字段名必须在白名单内（与创建可选字段一致，含 `name`）
- 若包含 `name`，须为非空字符串
最小示例：
```json
{
  "description": "更新后的说明"
}
```
---
## emp（组织员工）
| 命令 | 说明 |
|------|------|
| `emp by-ids <empId...>` | 按 empId 批量查询员工信息（`GET .../common/api/emp/list`，query: `empIdList`） |
---
## doc（知识文档）
| 命令 | 说明 |
|------|------|
| `doc list <knowledgeBaseId> [--version <v>] [--output-path <path>]` | 获取知识库文档列表；`version` 可选（不传默认最新版本），可输出到文件 |
| `doc info <id>` | **获取文档详情**（`GET .../documents/find-one/:id`），`id` 为正整数 |
| `doc create --json <文件>` | 创建文档 |
| `doc update <id> --json <文件>` | 更新文档，`id` 为正整数 |
| `doc remove <id>` | 删除文档 |
### 文档列表响应（`doc list`）
返回结构：
- `knowledge_base_id`: number
- `version`: string
- `documents`: `DocumentRecord[]`
若传入 `--output-path <path>`，CLI 将以上结构写入对应 JSON 文件，并在 stdout 输出写入成功提示。
### 文档详情响应（`doc info`）
与 `DocumentRecord` 对齐，常见字段包括（以接口实际返回为准）：`id`、`knowledge_base_id`、`title`、`summary`、`content`、`version`、`file_type`、`track_km`、`creator`、`updater`、`created_at`、`updated_at`。
### 创建文档 JSON（`doc create`）
- **必填**：`knowledge_base_id`（**JSON number**，正整数）、`title`（非空字符串）、`summary`（非空字符串）
- **可选**：`content`、`version`、`file_type`、`track_km`（均为 string，若出现）
- 若需关联学城文档，`track_km` 传学城文档 URL（格式：`https://km.sankuai.com/collabpage/xxx`）
```json
{
  "knowledge_base_id": 459,
  "title": "文档标题",
  "summary": "摘要",
  "content": "正文可选"
}
```
### 更新文档 JSON（`doc update`）
- **必填**：`knowledge_base_id`（**JSON number**，正整数）、`title`（非空字符串）、`summary`（非空字符串）
- **可选**：`content`、`version`、`file_type`、`track_km`（均为 string，若出现）
- 若需关联学城文档，`track_km` 传学城文档 URL（格式：`https://km.sankuai.com/collabpage/xxx`）
```json
{
  "knowledge_base_id": 459,
  "title": "新标题",
  "summary": "新摘要",
  "content": "可选更新正文"
}
```
---
## 常见校验错误
| 错误含义 | 处理 |
|----------|------|
| 请指定 JSON 文件路径（不支持从 stdin 读取） | 使用真实文件路径，勿用 `-` |
| `knowledge_base_id` 须为正整数 | 使用 JSON 数字 `459`，不要用 `"459"` |
| `space_id` 须为正整数 | 创建分组时使用 JSON 数字，不要用字符串 |
| 创建/更新文档缺少 `summary` | `summary` 必填且非空 |
| 更新知识库「至少须包含一个字段」 | JSON 不能为空对象 |
| 更新分组「至少须包含一个字段」 | JSON 不能为空对象 |
| `--kb-ids` 至少须包含一个 ID | 使用逗号分隔正整数，如 `123,456` |
| 输出文件写入失败 | 检查 `--output-path` 路径、父目录权限与磁盘空间 |
