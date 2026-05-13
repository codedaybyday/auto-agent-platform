---
name: mep-talos
description: Talos 前端持续交付平台工具。支持 Talos 1.0 & 2.0 全覆盖，包括应用管理、模板选择、泳道部署、流水线发布、发布日志查看。当用户提到「部署到 Talos」「发布测试环境」「Talos 部署」「前端发布」「查看发布日志」「环境部署」时使用此 skill。
---

# Talos 部署 Skill

基于 `@ee/talos-cli` 封装的 Talos 部署能力，支持前端应用的测试环境发布、泳道隔离、发布日志查看等完整流程。

> **前置条件**：确保已安装 CLI
> ```bash
> npm install -g @ee/talos-cli --registry=http://r.npm.sankuai.com
> ```

---

## CLI 命令速查

| 能力 | 命令 | 说明 |
|------|------|------|
| 应用列表 | `talos app ls -c` | 根据当前仓库查询应用 |
| 应用列表 | `talos app ls -r <repo>` | 根据指定仓库查询应用 |
| 应用详情 | `talos app describe <appId>` | 查看应用详情 |
| 模板列表 | `talos template ls <appId>` | 查看发布模板 |
| 发布部署 | `talos flow publish` | 发布到测试环境 |
| 发布日志 | `talos flow logs` | 查看发布日志 |
| 发布状态 | `talos flow status` | 查看发布状态 |

---

## 执行流程

### 第零步：检测 ONES 开发任务

检查项目根目录是否存在 `.catpaw/ones.json` 文件：

```bash
ls -la .catpaw/ones.json
```

**如果存在配置文件**，读取并展示需求/任务信息：

```json
{
  "requirement": {
    "id": "REQ-123",
    "title": "用户登录流程优化"
  },
  "tasks": [
    {
      "id": "TASK-456",
      "title": "用户登录流程优化-前端开发",
      "type": "前端开发"
    }
  ]
}
```

展示信息：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 检测到 ONES 开发任务
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
需求：REQ-123 - 用户登录流程优化
任务：TASK-456 - 用户登录流程优化-前端开发
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

继续执行部署流程。

---

### 第一步：获取应用信息

#### 1.1 获取当前分支

```bash
git branch --show-current
git remote -v
```

#### 1.2 获取可发布应用

如果用户未指定应用，优先根据当前仓库地址查询应用，**必须同时查询 Talos v1 和 v2 两个平台**：

```bash
# 获取当前仓库地址
git remote get-url origin

# 查询 Talos 2.0 应用（默认）
talos app ls -c

# 查询 Talos 1.0 应用
talos app ls -c -P v1
```

**如果遇到权限问题**，尝试手动指定仓库地址查询：

```bash
# 获取仓库地址
git remote get-url origin
# 示例输出：git@git.sankuai.com:team/project.git

# 手动指定仓库地址查询应用
# Talos 2.0
talos app ls -r git@git.sankuai.com:team/project.git

# Talos 1.0
talos app ls -r git@git.sankuai.com:team/project.git -P v1
```

**查询结果示例**：

```
📋 当前仓库关联的应用：

【Talos 2.0 应用】
1. waimai-web-user (ID: 36943)
   仓库：git@git.sankuai.com:waimai/web-user.git
   平台：Talos 2.0
   最后发布：2024-01-10 15:30

2. waimai-web-user-h5 (ID: 36944)
   仓库：git@git.sankuai.com:waimai/web-user.git
   平台：Talos 2.0
   最后发布：2024-01-09 10:00

【Talos 1.0 应用】
3. waimai-web-old (ID: 12345)
   仓库：git@git.sankuai.com:waimai/web-user.git
   平台：Talos 1.0
   最后发布：2024-01-08 14:20

请选择要发布的应用（输入序号或应用名）：
```

**注意事项**：

- ⚠️ **必须同时查询 v1 和 v2 两个平台的应用**，确保不遗漏任何应用
- ✅ 优先使用 `talos app ls -c` 自动根据当前仓库查询应用
- ⚠️ **如果遇到权限问题**，使用 `talos app ls -r <repo-url>` 手动指定仓库地址查询
- ✅ 权限问题可能是由于当前用户未关联仓库，使用 `-r` 参数可绕过此限制
- ✅ 一个仓库可能关联多个应用（如 PC 端和 H5 端），需根据实际情况选择
- ✅ 部署时需注意应用所属平台版本（v1 或 v2），发布命令需使用对应的平台参数

---

### 第二步：获取发布模板

查询应用可用的发布模板：

```bash
talos template ls <app-id>
```

展示模板列表供选择：

```
📋 可用的发布模板：

1. test - 测试环境
   说明：用于日常开发测试

2. test-swimlane - 泳道测试环境
   说明：用于泳道隔离测试

3. staging - 预发环境
   说明：上线前验证

请选择发布模板（输入序号或模板名，默认 test）：
```

---

### 第三步：泳道名称确认

**判断条件**：如果用户选择的模板名称包含 `swimlane` 或 `泳道` 关键字，需要询问泳道名称。

**询问用户**：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏊 检测到泳道环境模板
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
请输入要使用的泳道名称：

💡 泳道说明：
  - 泳道用于隔离测试环境，避免多人同时开发时互相干扰
  - 通常以需求名称或开发人员命名，如：login-optimization、zhangsan
  - 如果泳道不存在，Talos 会自动创建

示例：feature-login、zhangsan-dev
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
泳道名称：
```

**⚠️ 停止执行，等待用户输入泳道名称。**

记录泳道名称，用于后续发布命令的 `--swimlane` 参数。

---

### 第四步：确认发布信息

展示发布信息，等待用户确认：

**普通模板**：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 Talos 发布确认
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
应用：waimai-web-user (36943)
分支：feature/login-optimization
模板：test（测试环境）

⚠️ 发布前检查：
  ✅ 代码已提交
  ✅ 本地构建通过
  ⚠️ PR 尚未合并

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
确认发布？（回复「确认」或「y」）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**泳道模板**（包含泳道名称）：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 Talos 发布确认
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
应用：waimai-web-user (36943)
分支：feature/login-optimization
模板：test-swimlane（泳道测试环境）
🏊 泳道：feature-login

⚠️ 发布前检查：
  ✅ 代码已提交
  ✅ 本地构建通过
  ⚠️ PR 尚未合并

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
确认发布？（回复「确认」或「y」）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**⚠️ 停止执行，等待用户确认。**

---

### 第五步：执行发布

**普通模板**：

```bash
talos flow publish -a <app-id> -t <template> --target newtest
```

**泳道模板**（注入泳道参数）：

```bash
talos flow publish -a <app-id> -t <template> --target newtest --swimlane <swimlane-name>
```

---

### 第六步：跟踪发布进度

发布开始后，实时展示发布日志：

```
📜 发布日志 - flow-12345

[15:30:01] 🔄 开始构建...
[15:30:15] ✅ 依赖安装完成
[15:30:45] ✅ 构建完成
[15:31:00] 🔄 上传产物...
[15:31:30] ✅ 部署完成
```

---

### 第七步：输出结果

**部署成功（普通环境）**：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 发布成功！

📋 发布信息：
  应用：waimai-web-user
  分支：feature/login-optimization
  环境：测试环境

🔗 访问地址：
  https://waimai-web-user.test.sankuai.com/

💡 建议下一步：
  1. 访问测试环境验证功能
  2. 通知测试人员进行测试
  3. 测试通过后合并 PR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**部署成功（泳道环境）**：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 发布成功！

📋 发布信息：
  应用：waimai-web-user
  分支：feature/login-optimization
  环境：泳道测试环境
  🏊 泳道：feature-login

🔗 访问地址：
  https://feature-login.waimai-web-user.test.sankuai.com/

💡 建议下一步：
  1. 访问泳道环境验证功能
  2. 泳道环境与多人隔离，可独立测试
  3. 测试通过后合并 PR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 发布失败处理

如果发布失败，自动分析原因并给出建议：

```
❌ 发布失败

失败阶段：构建阶段
错误原因：ESLint 检查未通过

错误详情：
  src/utils/auth.ts:45:15 - 'token' is defined but never used

建议修复：
  移除未使用的变量 'token'

修复后重新发布：
  /环境部署
```

---

## 参数说明

### app ls 命令参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `-c, --current` | 否 | 使用当前 git 仓库地址查询 |
| `-r, --repo <repo>` | 否 | 指定仓库地址（如 git@git.sankuai.com:team/project.git） |
| `-a, --app-id <appId>` | 否 | 指定应用 ID 查询详情 |
| `-P, --platform <v1|v2>` | 否 | 平台版本，v1=Talos 1.0，v2=Talos 2.0（默认） |

### flow publish 命令参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `-a, --app-id` | 是 | 应用 ID |
| `-t, --template` | 是 | 发布模板名称 |
| `--target` | 否 | 目标环境：newtest/staging |
| `--swimlane` | 否 | 泳道名称（泳道模板时必填） |
| `-b, --branch` | 否 | 分支名，默认当前分支 |
| `-P, --platform` | 否 | 平台版本：v1/v2（默认 v2） |

### flow logs 命令参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `-a, --app-id` | 是 | 应用 ID |
| `--latest` | 否 | 查看最新发布日志 |
| `--follow` | 否 | 实时跟踪日志 |

### template ls 命令参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `<appId>` | 是 | 应用 ID（位置参数） |
| `--target` | 否 | 环境过滤：test01~08/newtest/staging/production |
| `--type` | 否 | 模板类型：publish/canary/rollback/ci/cd/all |
| `-P, --platform` | 否 | 平台版本：v1/v2（默认 v2） |

---

## 发布流程最佳实践

1. **发布前检查**：
   - 确保代码已提交
   - 本地测试通过
   - PR 已创建或已合并

2. **选择正确的模板**：
   - 日常开发：test 模板
   - 多人并行开发：test-swimlane 模板（需提供泳道名称）
   - 上线前验证：staging 模板
   - 正式发布：prod 模板

3. **泳道使用建议**：
   - 泳道名称建议使用需求名或开发人员名，便于识别
   - 同一泳道可被多次发布复用
   - 泳道环境互相隔离，不会互相影响

4. **发布后验证**：
   - 检查发布日志
   - 访问测试环境验证功能
   - 确认无问题后通知测试

---

## 错误处理

| 错误情况 | 处理方式 |
|---------|---------|
| 应用不存在 | 列出可用应用供选择 |
| 模板不存在 | 列出可用模板供选择 |
| 泳道名称未填写 | 提示用户输入泳道名称 |
| 构建失败 | 分析日志，给出修复建议 |
| 部署超时 | 提示检查网络或重试 |
| 权限不足 | 提示联系应用管理员 |
| 有未提交代码 | 提示先提交或暂存代码 |
| ONES 配置文件损坏 | 提示重新执行 `/create-requirement` |
