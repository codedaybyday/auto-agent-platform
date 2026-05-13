> 本文件是 SKILL.md 的详细执行步骤，由主文件按需引用加载。

# 第五步：GitNexus 知识图谱（详细步骤）

分层知识库生成完成后，在输出最终汇总前，**必须询问用户是否同时生成 GitNexus 代码知识图谱**。

## 5.1 确认询问

向用户展示以下提示，等待明确回复后再执行：

```
📊 分层知识库已生成完毕。

是否同时为本项目生成 GitNexus 代码知识图谱？

GitNexus 可以在知识库之外提供更深层的代码结构能力：
  - 函数调用链追踪（谁调用了谁）
  - 修改影响范围分析（改动前评估风险）
  - 跨模块依赖关系查询

⏱️ 建图时间：中小型项目约 1-3 分钟，大型项目约 5-10 分钟。

请回复：
  ✅ 是  — 立即安装并生成图谱
  ❌ 否  — 跳过，直接输出汇总报告
```

用户回复「否」或未明确确认时，直接跳到第六步输出汇总，**不得自行启动 GitNexus 安装或建图**。

## 5.2 GitNexus 安装与建图（用户确认后执行）

确认后，按以下流程自动执行，**每步完成后输出进度提示**，遇到错误立即停止并告知用户：

**Step GN-1：检查仓库路径**

确认代码仓库路径已知（来自 Step 4-6-1 解析的项目路径）。若未知，询问用户提供仓库路径后再继续。

**Step GN-2：环境检查与安装**

```bash
# 1. 检查 Node 版本（必须 v22.x，v24 有 GLIBC 兼容问题）
node --version
# 若不是 v22，切换：
nvm use 22 || n 22 && hash -r

# 2. 检查 gitnexus 是否已安装
gitnexus --version 2>/dev/null || echo "NOT_INSTALLED"

# 3. 未安装时执行安装（锁定 v1.5.3）
npm install -g gitnexus@1.5.3 \
  --registry https://registry.npmmirror.com \
  --omit=optional \
  --ignore-scripts

# 4. 补装 kuzu（必须，--omit=optional 会跳过，导致 analyze 报错）
GITNEXUS_DIR=$(npm root -g)/gitnexus
cd "$GITNEXUS_DIR" && npm install kuzu --registry https://registry.npmmirror.com

# 5. 内存 patch（沙箱 4GB cgroup 限制，防止 OOM）
sed -i 's/const HEAP_MB = 8192/const HEAP_MB = 1024/' \
    "$GITNEXUS_DIR/dist/cli/analyze.js"
```

**Step GN-3：配置内网 Embedding（中文语义搜索增强，必做）**

```bash
# 配置美团内网 embedding 接口（免费，代码不出公司）
export GITNEXUS_EMBEDDING_URL=https://mmc.sankuai.com/openclaw/v1/native
export GITNEXUS_EMBEDDING_MODEL=text-embedding-3-large
export GITNEXUS_EMBEDDING_API_KEY=catpaw
export GITNEXUS_EMBEDDING_DIMS=3072

# 写入 ~/.bashrc 永久生效
grep -q "GITNEXUS_EMBEDDING_URL" ~/.bashrc || cat >> ~/.bashrc << 'EOF'
export GITNEXUS_EMBEDDING_URL=https://mmc.sankuai.com/openclaw/v1/native
export GITNEXUS_EMBEDDING_MODEL=text-embedding-3-large
export GITNEXUS_EMBEDDING_API_KEY=catpaw
export GITNEXUS_EMBEDDING_DIMS=3072
EOF
source ~/.bashrc
```

> ⚠️ **不配置 embedding 时中文关键词搜索几乎无效**，这是最常见的踩坑点，必须在建索引前完成。

**Step GN-4：生成知识图谱**

```bash
cd /path/to/repo   # 替换为实际项目路径

# 带 embedding 增强建图（推荐）
gitnexus analyze --embeddings

# 建图完成后配置 MCP（只需执行一次）
gitnexus setup
```

建图成功输出示例：
```
Repository indexed successfully (7.2s)
6,801 nodes | 17,310 edges | 404 clusters | 300 flows
```

**Step GN-5：启动 HTTP 服务（云端助理模式必做）**

```bash
# 后台启动，固定端口 3456（云端助理统一使用此端口）
nohup gitnexus serve --port 3456 > /tmp/gitnexus-serve.log 2>&1 &

# 验证服务存活
curl -s http://localhost:3456/api/heartbeat --no-buffer | head -1
```

## 5.3 GitNexus 使用规范约束

以下规范在知识库生成完成后告知用户，作为后续使用的指导原则：

| 规范 | 说明 |
|---|---|
| **增量更新** | 代码有较大改动后需重新建图：`gitnexus analyze --force --embeddings` |
| **查询语言** | HTTP API 只接受英文 symbol 名称查询，不支持中文描述（如用 `ContractDetailState` 而不是「合同详情状态」） |
| **图谱与知识库协同** | GitNexus 图谱管代码结构（调用链/依赖），分层知识库管业务知识（流程/规范/经验），两者互补不替代 |
| **Node 版本锁定** | 项目根目录建议添加 `.nvmrc` 文件写入 `22`，防止环境切换导致 gitnexus 异常 |
| **索引文件不入库** | `.gitnexus/` 目录加入 `.gitignore`，索引文件不提交到代码仓库 |
| **Kotlin 项目** | Android 仓库需额外 patch tree-sitter-kotlin，参考 gitnexus-usage skill |
| **定时维护** | 建议配置 heartbeat 或 cron 定期增量更新索引（参考 gitnexus-auto-index skill）|

## 5.4 GitNexus 建图结果展示

建图完成后，在汇总报告中追加：

```
🔗 GitNexus 知识图谱
  状态: ✅ 已生成
  仓库: [项目路径]
  统计: [N] nodes | [M] edges | [K] clusters | [F] flows
  HTTP 服务: http://localhost:3456（已启动）
  可视化: https://gitnexus.vercel.app（连接本地服务）

使用提示：
  - 调用链查询：「追踪 [FunctionName] 的调用链」
  - 影响分析：「分析修改 [FileName] 的影响范围」
  - 依赖查询：「查询依赖 [ModuleName] 的所有文件」
```
