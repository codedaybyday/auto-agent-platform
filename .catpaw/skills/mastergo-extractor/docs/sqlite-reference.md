# SQLite 本地存储与检索参考

工具脚本位于 skill 目录：`mg_import.py`（导入）、`mg_query.py`（检索）。

**数据库位置**：
- 默认路径：`~/.catpaw/mastergo.db`
- 使用 `--output-dir` 时：`{output_dir}/data/mastergo.db`

---

## 目录组织方式（默认启用）

**默认自动创建独立目录**，AI 自动生成目录名 `mg_export/YYYYMMDD_NNN/`：

```bash
# 默认行为：自动创建目录（如 ./mg_export/20250326_001/）
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_import.py \
    dump.json \
    --file-id <FILE_ID> \
    --page-id <PAGE_ID> \
    --page-name "首页"

# 输出示例：
# 📁 输出目录：./mg_export/20250326_001
#    📷 图片目录：./mg_export/20250326_001/images
#    💾 数据目录：./mg_export/20250326_001/data

# 检索时指定目录
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py \
    --output-dir ./mg_export/20250326_001 tree
```

目录结构：
```
./mg_export/20250326_001/
├── index.md              # 索引文件
├── images/               # 图片资源
└── data/
    ├── mastergo.db       # SQLite 数据库
    └── mg_tree_*.md      # 缩略节点树
```

---

## mg_import.py 参数

```bash
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_import.py \
    <json_file>              # JSON 文件路径，或 - 表示 stdin
    --file-id <ID>           # MasterGo 文件 ID（必填）
    --page-id <ID>           # MasterGo 页面 ID（必填）
    --page-name <NAME>       # 页面名称（可选，便于识别）
    --no-dir                 # 禁用目录模式，保存到 ~/.catpaw/mastergo.db
    --output-dir <DIR>       # 自定义输出目录（会创建 images/、data/ 子目录）
    --clear                  # 导入前清除同页旧数据
    --no-tree                # 跳过缩略节点树生成
    --tree-out <PATH>        # 指定缩略树输出路径（默认与 db 同目录）
    --db <PATH>              # 数据库路径（与目录模式互斥）
```

**默认行为（推荐）**：
- AI 自动生成目录名：`mg_export/YYYYMMDD_NNN/`
- 自动创建 `images/` 和 `data/` 子目录
- 数据库保存到 `data/mastergo.db`
- 缩略节点树保存到 `data/mg_tree_*.md`
- 自动生成 `index.md` 索引文件

**使用 `--output-dir` 时**：
- 使用用户指定的目录名
- 其他与默认行为相同

**使用 `--no-dir` 时**：
- 数据库保存到 `~/.catpaw/mastergo.db`（或 `--db` 指定路径）
- 缩略节点树保存到数据库同目录

---

## 检索命令速查

### 使用目录方式检索（推荐）

```bash
# 使用 --output-dir 自动定位数据库
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py \
    --output-dir ./mg_export/20250326_001 tree

python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py \
    --output-dir ./mg_export/20250326_001 stats

python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py \
    --output-dir ./mg_export/20250326_001 search "登录"
```

### 查看缩略节点树（基础使用首选）

```bash
# 查看最近导入的节点树摘要（含尺寸、颜色、padding、gap、圆角、描边等）
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py tree

# 指定文件和页面
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py \
    --file-id <FILE_ID> --page-id <PAGE_ID> tree

# 使用目录方式
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py \
    --output-dir ./mg_export/20250326_001 tree
```

缩略树每行格式：
```
[类型] 名称  宽×高  "文字"  fs:字号  #填充色  border:粗细/颜色/位置  radius:圆角  p:padding  gap:间距  layout:H/V
```

### 列出已导入页面

```bash
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py pages
```

### 统计概况

```bash
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py stats
```

### 全文搜索（name + text）

```bash
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py search 登录
```

### 多条件精确查询（find）

```bash
# 找所有 TEXT 节点，字号 >= 24
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py \
    find --type TEXT --min-font-size 24

# 找有描边的节点
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py \
    find --has-stroke

# 找圆角 >= 8 的 FRAME
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py \
    find --type FRAME --min-radius 8

# 找有 padding 且水平布局的容器
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py \
    find --type FRAME --layout HORIZONTAL --has-padding

# 找特定填充色
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py \
    find --fills-hex "#ff5500"

# 找有阴影/模糊效果的节点
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py \
    find --has-effects

# 找 gap 在 8~16 之间的节点
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py \
    find --min-gap 8 --max-gap 16
```

find 支持的所有过滤条件：

| 参数 | 说明 |
|------|------|
| `--type` | 节点类型（TEXT/FRAME/GROUP/INSTANCE 等） |
| `--name` | 名称包含（模糊匹配） |
| `--text` | 文字内容包含（模糊匹配） |
| `--min-font-size` / `--max-font-size` | 字号范围 |
| `--layout` | 布局方向（HORIZONTAL/VERTICAL） |
| `--fills-hex` | 填充色 HEX（精确匹配，如 `#ff5500`） |
| `--strokes-hex` | 描边颜色 HEX |
| `--has-stroke` | 只返回有描边的节点 |
| `--has-radius` | 只返回有圆角的节点 |
| `--min-radius` / `--max-radius` | 圆角范围（仅对统一圆角有效） |
| `--has-padding` | 只返回有 padding 的节点 |
| `--has-gap` | 只返回有 gap 的节点 |
| `--min-gap` / `--max-gap` | gap 范围 |
| `--has-effects` | 只返回有阴影/模糊的节点 |
| `--depth` | 精确层级深度 |
| `--max-depth` | 最大层级深度 |

### 获取单个节点完整属性

```bash
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py node "75066:33875"
```

输出按分组展示：基本信息、尺寸位置、文字样式、布局、盒模型、外观、其他。

### 列出直接子节点

```bash
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py children "75066:33875"
```

### 展开子树

```bash
# 展开 3 层（subtree 输出中每行附带关键样式：fs/填充色/border/radius/gap）
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py \
    subtree "75066:33875" --max-depth 3

# 输出 JSON 供进一步处理
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py \
    --json subtree "75066:33875" --max-depth 2
```

---

## 推荐检索策略

### 核心原则

MasterGo 的 GROUP 节点子节点顺序在 dumpTree 中是随机的，不反映视觉层级，因此 **不要依赖 `subtree` / `children` 来理解区块结构**。正确姿势是两段式：

**第一段：用 tree 命令定位 id**

```bash
# 实时从 SQLite 生成节点树，格式为 [TYPE] 名称 (id) "文字"
python3 mg_query.py --output-dir ./mg_export/20250326_001 tree
```

输出的树形结构完整保留，每行只有类型、名称、id，文字节点附带内容摘要。从中找到目标区块的名称，拿到 `id`。

**第二段：用 id 查精确属性**

```bash
# 查单节点完整属性
python3 mg_query.py --output-dir ./mg_export/20250326_001 node "<id>"

# 跨节点条件查询（不依赖父子关系，可靠）
python3 mg_query.py --output-dir ./mg_export/20250326_001 find --type TEXT --min-font-size 16
python3 mg_query.py --output-dir ./mg_export/20250326_001 find --has-stroke
```

### 各工具适用场景

`tree` — **结构导航首选**。实时从 SQLite 生成，格式为 `[TYPE] 名称 (id) "文字"`，浏览区块层级、定位目标 id。

`node <id>` — 拿到 id 后查该节点的精确数值（尺寸、颜色、布局、padding、圆角等全部字段）。

`find` — 跨节点的条件查询，不依赖父子关系，结果可靠。适合「找所有字号 ≥ 24 的文字」、「找所有有描边的容器」等场景。

`search <关键词>` — 按名称或文字内容快速定位节点，拿到 id。

`subtree <id>` — 仅对根节点是 FRAME/INSTANCE 时可信；若根节点是 GROUP，子节点顺序随机，仅供参考。

`tree` — 查看含样式摘要的缩略节点树，适合快速核对填充色、字号、圆角等样式值。

`stats` — 确认节点总数、类型分布、最大深度。

---

## SQLite Schema

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT | 节点 ID |
| `file_id` / `page_id` / `page_name` | TEXT | 文件/页面标识 |
| `parent_id` / `depth` | TEXT/INT | 树结构 |
| `name` / `type` / `text` | TEXT | 基本信息 |
| `w` / `h` / `x` / `y` | REAL | 尺寸与坐标 |
| `font_size` / `font_weight` / `font_family` | REAL/TEXT | 文字样式 |
| `line_height` / `letter_spacing` / `text_align` | TEXT/REAL | 文字样式 |
| `layout` / `layout_wrap` / `main_align` / `cross_align` | TEXT | 自动布局 |
| `sizing_h` / `sizing_v` | TEXT | 尺寸模式（FIXED/HUG/FILL） |
| `padding_t` / `padding_r` / `padding_b` / `padding_l` | REAL | 内边距（各方向独立列） |
| `gap` / `cross_gap` | REAL | 主轴/交叉轴间距 |
| `radius` | TEXT | 圆角（统一值为数字，四角不同为 JSON） |
| `stroke_weight` / `stroke_align` / `strokes_hex` | REAL/TEXT | 描边 |
| `fills_hex` | TEXT | 主填充色 HEX |
| `opacity` | REAL | 透明度 |
| `constraints` / `clips_content` / `effects` | TEXT/INT | 约束、裁剪、阴影 |
| `props` | TEXT | 其余属性 JSON 兜底 |

全文检索通过 FTS5 虚拟表 `mg_fts` 实现，对 `name` 和 `text` 字段建立倒排索引。
