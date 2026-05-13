---
name: mep-code
description: 代码托管平台 PR 管理工具。支持 PR 生命周期管理、PR 待解决评论修复、合并检查项状态查看。当用户提到「创建 PR」「提交 PR」「发起 PR」「查看 PR」「PR 评论」「合并请求」「代码评审」时使用此 skill。
---

# Code PR 管理 Skill

基于 `@ee/code-cli` 封装的 PR 管理能力，支持 PR 创建、查询、评论处理等完整流程。

> **前置条件**：确保已安装 CLI
> ```bash
> npm install -g @ee/code-cli --registry=http://r.npm.sankuai.com
> ```

---

## CLI 命令速查

| 能力 | 命令 | 说明 |
|------|------|------|
| PR 列表 | `code-cli pr list` | 查看仓库的 PR 列表 |
| 创建 PR | `code-cli pr create` | 创建新的 PR |
| PR 详情 | `code-cli pr describe` | 查看 PR 详情 |
| 仓库信息 | `code-cli repo info` | 获取仓库信息 |
| 评论查询 | `code-cli pr comments` | 查看 PR 待解决评论 |
| 评论修复 | `code-cli pr resolve-comments` | 修复待解决评论 |

---

## 使用场景

### 场景 1：创建 PR

**触发词**：「创建 PR」「提交 PR」「发起代码评审」「帮我创建一个 PR」

**交互流程**：

1. **收集信息**：
   - 源分支（默认当前分支）
   - 目标分支（默认 master/main）
   - PR 标题
   - PR 描述（可选，可从 commit 自动生成）
   - 评审人（可选）

2. **确认信息**：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 创建 PR 确认
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
源分支：feature/login-optimization
目标分支：master
标题：feat: 用户登录流程优化
评审人：zhangsan, lisi

描述：
- 优化登录页面 UI
- 添加记住密码功能
- 修复登录超时问题
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
确认创建？（回复「确认」或「y」）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

3. **执行创建**：

```bash
code-cli pr create \
  --source-branch <source> \
  --target-branch <target> \
  --title "<title>" \
  --description "<description>" \
  --reviewers "<reviewers>"
```

4. **返回结果**：

```
✅ PR 创建成功！

PR 编号：#123
标题：feat: 用户登录流程优化
链接：https://code.sankuai.com/...

评审人：@zhangsan, @lisi
状态：等待评审
```

---

### 场景 2：查看 PR 列表

**触发词**：「查看我的 PR」「PR 列表」「有哪些 PR」

**执行**：

```bash
code-cli pr list
```

**返回格式化结果**：

```
📋 PR 列表（共 N 条）：

1. #123 - feat: 用户登录优化
   状态：等待评审 | 评审人：zhangsan
   源分支：feature/login | 目标：master

2. #124 - fix: 修复订单bug
   状态：评审通过 | 评审人：lisi
   源分支：fix/order | 目标：master
```

---

### 场景 3：查询待解决评论

**触发词**：「查看 PR 评论」「PR 有哪些待解决评论」「待处理评论」

**执行**：

```bash
code-cli pr comments --pr-id <pr-id>
```

**返回**：

```
💬 PR #123 待解决评论（共 3 条）：

1. [src/utils/auth.ts:45]
   @zhangsan: 这里应该添加错误处理
   状态：待解决

2. [src/components/Login.tsx:120]
   @lisi: 密码输入框需要添加显示/隐藏切换
   状态：待解决
```

---

### 场景 4：修复待解决评论

**触发词**：「修复 PR 评论」「处理评论」「解决评审意见」

**交互流程**：

1. 列出待解决评论
2. 用户选择要处理的评论
3. AI 辅助修复代码
4. 标记评论为已解决：

```bash
code-cli pr resolve-comments --pr-id <pr-id> --comment-ids <ids>
```

---

### 场景 5：查看合并检查项

**触发词**：「PR 合并检查」「检查项状态」「能合并吗」

**执行**：

```bash
code-cli pr checks --pr-id <pr-id>
```

**返回**：

```
🔍 PR #123 合并检查项：

✅ 代码评审：通过（2/2 人）
✅ CI 流水线：通过
✅ 代码规范：通过
⚠️ 测试覆盖：未达标（78% < 80%）

❌ 暂不可合并，请处理测试覆盖率问题
```

---

## 参数说明

### pr create 命令参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--source-branch` | 否 | 源分支，默认当前分支 |
| `--target-branch` | 否 | 目标分支，默认 master |
| `--title` | 是 | PR 标题 |
| `--description` | 否 | PR 描述 |
| `--reviewers` | 否 | 评审人，逗号分隔 |
| `--draft` | 否 | 创建为草稿 PR |

### pr list 命令参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--state` | 否 | 状态过滤：open/merged/closed |
| `--author` | 否 | 作者过滤 |

---

## 错误处理

| 错误 | 处理方式 |
|------|---------|
| 分支不存在 | 提示检查分支名称 |
| 无权限 | 提示联系仓库管理员 |
| 合并冲突 | 提示需要先解决冲突 |
| CI 失败 | 展示失败原因和建议 |
