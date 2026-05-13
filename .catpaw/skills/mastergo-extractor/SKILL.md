---
name: mastergo-extractor
description: 从 MasterGo / imd.sankuai.com 设计文件中提取页面内容并整理成文档。当用户提供 MasterGo 链接（imd.sankuai.com/file/... 完整链接或 imd.sankuai.com/goto/... 短链接）并希望理解、提取或整理其中的设计规范内容时使用。支持：自动处理 goto 短链接并解析真实 URL、列出所有页面、精确提取指定 layer_id 节点的完整规范数据、提取整页文字内容、整理输出为 Markdown 文档、扫描并导出设计稿中的图片资源。

metadata:
  skillhub.creator: "yaoyiwei"
  skillhub.updater: "yaoyiwei"
  skillhub.version: "V12"
  skillhub.source: "FRIDAY Skillhub"
  skillhub.skill_id: "16284"
  skillhub.high_sensitive: "false"
---

# MasterGo 内容提取

MasterGo 画布由 canvas 渲染，无法直接读取 DOM 文字。但页面加载后会在 `window.mg` 上暴露完整的插件 API，可通过它直接访问所有节点数据。

`window.mg.document` 包含整个文件的节点树：`document.children` → 所有页面（PAGE 节点），`page.children` → 页面内的顶层节点。节点可见性由 `isVisible` 属性控制（注意不是 `visible`），提取时默认跳过 `isVisible === false` 的节点。

详细属性说明见 [docs/node-reference.md](./docs/node-reference.md)。

---

## 工作流总览

```
第零步  识别链接类型（goto 短链接 / file 完整链接）→ 导航获取真实 URL
第一步  解析 URL 参数（fileId / page_id / layer_id / shareId）+ 等待 window.mg 就绪
第二步  列出所有页面
第三步  根据是否有 layer_id 选择流程：
         ├─ URL 含 layer_id → 精确节点模式（见 docs/workflow-precise.md）
         │     3A-1  exportAsync 导出节点高清 PNG → image_read 初步确认（仅确认导出成功）
         │     3A-3  dumpTree 提取完整节点树并下载
         │     3A-4  立即入库 SQLite（必须执行，防遗忘）
         │     3A-2  ⚠️ 必须执行：flat 获取子节点坐标 → AI 语义映射 → 脚本裁剪切片 → image_read 逐张验证
         │           （页面高度 > 600pt 时强制执行；切片验证全部通过后才能进入 3A-5）
         │     3A-5  逐模块拍平节点 → 推算布局 → 查精确属性 → 生成规范
         │           3A-5-0  生成布局结构描述（ASCII 树形图 + 关键布局说明，置于文档开头）
         │           3A-5-1  flat --bbox 拍平模块内节点
         │           3A-5-2  从坐标差推算 padding / gap
         │           3A-5-3  node 命令查精确属性（color / fontSize / radius 等）
         │           3A-5-4  汇总输出规范文档
         │     ⚠️  获取节点必须用 window.mg.getNodeById(LAYER_ID)，禁止用 findNode 递归遍历（会超时）
         └─ URL 无 layer_id → 整页文字模式（见 docs/workflow-fullpage.md）
               3B-1  提取整页文字
               3B-2  截图视觉验证
第四步  整理为 Markdown 文档，保存到工作区（文档结构：布局总览 → 逐模块规范）

【图片提取模式】用户想获取图片资源时（见 docs/workflow-image-extract.md）：
  I-1  扫描目标节点下所有 IMAGE fill（用 imageRef 字段，非 imageHash）
  I-2  用 exportAsync 逐个导出为 PNG，落盘到 ~/Downloads/ 后 mv 到工作区
  I-3  image_read 验证图片内容
  I-4  （可选）需要内网可用 URL 时：oa-skills citadel uploadImageToDocument --contentId <学城文档ID> --image <路径> → 返回 km.sankuai.com/api/file/cdn/... 内网 URL
```

---

## 第零步：识别链接类型并获取真实 URL

| 链接格式 | 示例 | 处理方式 |
|---------|------|---------|
| **短链接**（goto） | `https://imd.sankuai.com/goto/RDNFo8LN` | 导航后从 `data.url` 读取真实 URL |
| **完整链接**（file） | `https://imd.sankuai.com/file/137265...` | 直接解析 URL 参数 |

```bash
# goto 短链接：导航后页面已在加载中，无需二次导航
~/.catpaw/bin/catdesk browser-action '{"action":"navigate","url":"https://imd.sankuai.com/goto/XXXXXXXX","waitUntil":"networkidle"}'
```

从响应的 `data.url` 字段读取真实 URL。

---

## 第一步：解析 URL 参数 + 等待 window.mg 就绪

从真实 URL 中解析：

| 参数 | URL 字段 | 注意 |
|------|---------|------|
| `fileId` | `file/` 后的路径段 | — |
| `page_id` | `page_id=` | `%3A` → `:` |
| `layer_id` | `layer_id=` | 存在则走精确节点模式 |
| `shareId` | `shareId=` | 分享鉴权 |

**确保 devMode=true**：导航时 URL 中必须含 `devMode=true`，否则 `window.mg.viewport` 写操作不可用。

```bash
# 等待 window.mg 就绪（最多重试 3 次，每次间隔 3 秒）
~/.catpaw/bin/catdesk browser-action '{"action":"evaluate","script":"JSON.stringify(window.mg && window.mg.document ? \"ready\" : \"mg not ready\")"}'
```

完整链接需先导航再等待：

```bash
~/.catpaw/bin/catdesk browser-action '{"action":"navigate","url":"https://imd.sankuai.com/file/<fileId>?page_id=<pageId>&shareId=<shareId>&devMode=true","waitUntil":"networkidle"}'
```

---

## 第二步：列出所有页面

```bash
~/.catpaw/bin/catdesk browser-action '{"action":"evaluate","script":"JSON.stringify(window.mg.document.children.map(p=>({id:p.id,name:p.name})))"}'
```

根据是否有 `layer_id` 选择后续流程：

- **有 layer_id** → 精确节点模式，详见 [docs/workflow-precise.md](./docs/workflow-precise.md)
- **无 layer_id** → 整页文字模式，详见 [docs/workflow-fullpage.md](./docs/workflow-fullpage.md)

---

## 注意事项

- **中间产物必须输出到 .tmp/ 目录，禁止写入项目根目录**：执行过程中产生的所有临时文件（包括但不限于：exportAsync 导出的 PNG、dumpTree 下载的 JSON、切片脚本 slice_script.py、分析脚本 generate_dev_analysis.py、中间数据 dev_analysis.json 等），一律输出到项目根目录下的 `.tmp/` 子目录中。绝对禁止将任何中间产物直接写入项目根目录。工作区路径规则：
  - **PNG 截图**：`.tmp/COMPONENT_NAME.png`
  - **dumpTree JSON**：`.tmp/mg_dump_LAYER_ID.json`
  - **临时 Python 脚本**：`.tmp/slice_SCRIPT_NAME.py`
  - **中间分析数据**：`.tmp/analysis_DATA_NAME.json`
  - **最终产出文件**（index.json / spec.json / dev.json）：按调用方指定的 outputDir 输出
  - **执行完毕后应清理 .tmp/ 目录中的临时文件**（或由调用方 batch-analyzer 统一清理）
- **始终使用 devMode=true**：无论原始链接是否含有该参数，导航时都应确保 URL 含 `devMode=true`
- **goto 短链接**：导航后从 `data.url` 读取真实 URL，**无需二次导航**，页面此时已在加载中
- **goto 链接含邀请参数**：`inviteBatchId`、`inviteDocumentId` 等可忽略，只需关注 `fileId`、`page_id`、`layer_id`、`shareId`
- **导入前询问端类型**：执行 `mg_import.py` 前，若上下文中未明确说明，必须询问"这是 C 端（手机）设计稿吗？"——是则加 `--platform c`，否则不加；若用户已说明（如"C端"、"移动端"、"手机页面"）则直接使用，无需再问
- **dumpTree 执行前必须确认页面已打开**：3A-1（exportAsync）与 3A-3（dumpTree）之间可能间隔多个步骤，浏览器页面可能已跳走。执行 dumpTree 前必须先用 evaluate 检查 `window.mg` 是否就绪，若返回 "mg not ready" 则必须重新导航到目标页面，确认就绪后再继续。
- **dumpTree 必须分两步执行**：节点树较大时，单次 evaluate 同步执行 dumpTree + JSON.stringify + 触发下载会超时。必须先注入函数到 `window.__mgDump`（第一步，立即返回），再调用触发下载（第二步，异步执行）。详见 `docs/workflow-precise.md` 3A-3 方式一。
- **dumpTree 后立即入库**：必须在拿到结果后立即执行 3A-4，防止数万 token 的 JSON 在后续步骤中被遗忘
- **window.mg 不存在**：返回 "mg not ready" 时 sleep 3 后重试，最多 3 次；仍未就绪则提示用户手动刷新
- **需要登录**：页面需要用户已登录 imd.sankuai.com，浏览器 session 会自动携带 cookie
- **exportAsync 文件落盘位置**：固定保存到 `~/Downloads/`，导出后必须用 `mv` 移动到工作区
- **禁止使用 findNode 递归**：获取节点必须用 `window.mg.getNodeById(LAYER_ID)`，O(1) 直接查找；`findNode` 递归遍历整棵页面树会导致 browser-action 超时
- **切片不可跳过**：精确节点模式下，页面高度 > 600pt 时必须执行 3A-2 切片流程；整图 image_read 仅用于初步确认导出成功，不得替代切片直接分析规范；切片必须在 3A-4 入库完成后执行，验证全部通过后才能进入 3A-5
- **图片节点用 imageRef 而非 imageHash**：`imageHash` 在只读分享模式下为 `null`；扫描图片 fill 时必须检查 `f.imageRef` 字段；`imageRef` 不是公开 URL，必须通过 `exportAsync` 导出，不可直接拼接 CDN 域名访问

---

## 子文档索引

| 文档 | 内容 |
|------|------|
| [docs/workflow-precise.md](./docs/workflow-precise.md) | 精确节点模式完整步骤（exportAsync / dumpTree / 入库 + 精简 JSON / 切片） |
| [docs/workflow-fullpage.md](./docs/workflow-fullpage.md) | 整页文字模式完整步骤（文字提取 / 截图） |
| [docs/sqlite-reference.md](./docs/sqlite-reference.md) | SQLite 工具完整参考（schema / 所有查询命令 / 检索策略） |
| [docs/node-reference.md](./docs/node-reference.md) | dumpTree 属性说明 / 颜色转换 / 节点类型 / 文字过滤模板 |
| [docs/workflow-image-extract.md](./docs/workflow-image-extract.md) | 图片节点提取模式（imageRef 扫描 / exportAsync 导出 / 批量下载 / 学城 KM 附件获取内网 URL） |

## 工具脚本索引

| 脚本 | 功能 |
|------|------|
| `mg_import.py` | 将 dumpTree JSON 导入 SQLite 数据库 |
| `mg_query.py` | 查询已导入的节点数据（tree/stats/search/find/node/subtree/children） |
