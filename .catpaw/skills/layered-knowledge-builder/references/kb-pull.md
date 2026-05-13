> 本文件是 SKILL.md 的详细执行步骤，由主文件按需引用加载。

# 拉取知识库功能（@wmfe/kb-cli）— 详细步骤

> ⚠️ **工具使用说明**：知识拉取使用 `@wmfe/kb-cli`（命令：`kb`），知识库的创建、更新、删除等写操作一律使用 `block-kb-cli`。

当用户提到「拉取知识库」、「拉取知识库文档」、「获取知识库」、「导出知识库」时，进入本流程。
本功能使用 `@wmfe/kb-cli`（命令：`kb`）完成知识库拉取，文档将同步到**用户工程目录**下的 `.catpaw/knowledge-bank-local/`。

---

## Step F-0：安装 @wmfe/kb-cli

**每次触发时先检查是否已安装，未安装则自动安装：**

```bash
kb --version 2>/dev/null || npm install -g @wmfe/kb-cli
```

安装验证：

```bash
kb --version   # 输出版本号即成功
```

> ⚠️ 若安装失败（网络问题），尝试加内网 registry：
> ```bash
> npm install -g @wmfe/kb-cli --registry=http://r.npm.sankuai.com
> ```

---

## Step F-1：询问用户工程目录 & 知识库 ID

向用户询问以下两项信息（可以一起询问）：

```
我需要两个信息来帮你拉取知识库：

1. 📁 你的工程目录路径（文档会保存在该目录下的 .catpaw/knowledge-bank-local/）
   示例：/Users/yourname/projects/my-app
   （直接回车则使用当前工作目录）

2. 🔢 知识库 ID（Block 平台知识库页面 URL 中的数字）
   示例：https://block.sankuai.com/ai-market/knowledge?catalog=469  →  ID 为 469
```

- 若用户在上下文中已提供知识库 ID（如「知识库ID 469」），直接复用，不再重复询问
- 工程目录默认值：`~/.openclaw/workspace`（若用户未指定）

---

## Step F-2：确认 SSO Token（认证前置）

`kb pull` 依赖 `~/.block-ai-config` 中的 `token.access_token` 字段（由 `block-kb-cli` 登录后写入）。

**检查 token 是否存在且有效：**

```bash
node -e "
const fs = require('fs');
const p = process.env.HOME + '/.block-ai-config';
if (!fs.existsSync(p)) { console.log('NO_TOKEN'); process.exit(0); }
const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
const t = cfg.token?.access_token;
console.log(t ? 'HAS_TOKEN' : 'NO_TOKEN');
"
```

- 若输出 `HAS_TOKEN`：直接进入 Step F-3
- 若输出 `NO_TOKEN`：需先触发 `block-kb-cli` 认证

```bash
# 触发 CIBA 大象授权，完成后 token 自动写入 ~/.block-ai-config
block-kb-cli kb list
```

> 告知用户：「需要先完成大象授权，请在大象 App 中点击同意授权」

---

## Step F-3：初始化 kb 配置（非交互式）

`kb init` 是交互式命令，**不能直接 exec 调用**。
改为**直接写入配置文件**，完全绕过交互：

```bash
# 1. 确定工程目录（用户指定或默认值）
PROJECT_DIR="<用户指定的工程目录>"
KB_ID=<知识库ID>
MIS="<从 ~/.openclaw/openclaw.json 读取的 misId，或由 block-kb-cli 已配置的 MIS>"

# 2. 读取 MIS（优先从 block-ai-config 读取，避免重复设置）
MIS=$(node -e "
const fs = require('fs');
const p = process.env.HOME + '/.block-ai-config';
if (fs.existsSync(p)) {
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  console.log(cfg.defaultMis || '');
} else { console.log(''); }
")

# 3. 获取 kb-cli 配置文件路径（固定在 npm 全局包目录下）
KB_CLI_DIR=$(node -e "require.resolve('@wmfe/kb-cli/lib/utils')" | sed 's|/lib/utils.js||')

# 4. 写入 .kb-config.json
node -e "
const fs = require('fs');
const path = require('path');
const cliDir = '$KB_CLI_DIR';
const configPath = path.join(cliDir, '.kb-config.json');
const config = {
  knowledgeBaseId: $KB_ID,
  mis: '$MIS',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('配置已写入: ' + configPath);
"

# 5. 创建本地知识库目录
mkdir -p "$PROJECT_DIR/.catpaw/knowledge-bank-local"
```

> **为什么不用 `kb init`？**
> `kb init` 使用 `readline` 交互式输入，无法在 exec 环境中自动化。通过直接写入配置文件，效果完全等同于执行 `kb init`。

---

## Step F-4：执行 kb pull 拉取文档

`kb pull` 有一个确认交互（`是否继续执行以上操作? (y/n)`），需要使用 **PTY 模式**运行：

```bash
# 切换到工程目录后执行 kb pull
cd "<用户工程目录>" && kb pull
```

**执行方式：使用 exec 工具的 PTY 模式**

```
exec(command="cd <工程目录> && kb pull", pty=true, yieldMs=30000)
```

若用户希望同时删除本地多余文档（云端已删的文档），使用：

```bash
cd "<用户工程目录>" && kb pull -d
```

**在 PTY 中自动回复确认：**

当终端输出 `是否继续执行以上操作? (y/n)` 时，通过 `process(action=send-keys, literal="y\n")` 发送确认。

---

## Step F-5：输出结果

`kb pull` 执行完成后，汇总输出：

```
✅ 知识库文档拉取完成

📚 知识库 ID: <id>
📁 文档保存位置: <工程目录>/.catpaw/knowledge-bank-local/

📊 同步统计：
  ➕ 新增: N 篇
  ✏️  更新: M 篇
  ⏭️  跳过: K 篇（无变化）
  🗑️  删除: X 篇（仅 -d 模式）
  ❌ 失败: 0 篇

💡 后续命令：
  kb diff    # 查看本地与云端差异
  kb pull    # 再次同步最新文档
  kb push    # 将本地改动推送到云端
```

---

## Step F-6：错误处理

| 错误场景 | 处理方式 |
|----------|----------|
| `kb: command not found` | 执行 `npm install -g @wmfe/kb-cli` 安装，安装后重试 |
| `❌ 未找到知识库配置` | 重新执行 Step F-3 写入配置文件 |
| `❌ 未找到有效的 SSO token` | 执行 `block-kb-cli kb list` 触发 CIBA 大象授权，完成后重试 |
| `认证失败 auth failed` | 执行 `block-kb-cli config --clear-token` 清除旧 token，重新登录 |
| 知识库 ID 不存在或无权限 | 提示用户确认 ID，建议用 `block-kb-cli kb list` 查看有权限的知识库 |
| `npm install` 失败 | 加内网 registry 重试：`npm install -g @wmfe/kb-cli --registry=http://r.npm.sankuai.com` |
| PTY 确认卡住 | 检测到 `(y/n)` 提示后，通过 `process(action=send-keys)` 发送 `y` |
