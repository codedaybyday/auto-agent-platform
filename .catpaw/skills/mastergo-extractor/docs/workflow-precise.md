# 精确节点模式（URL 含 layer_id）

URL 中存在 `layer_id` 参数时走此流程。

---

## 3A-1：导出节点高清 PNG（exportAsync）

`exportAsync` 直接从节点数据渲染，与画布视口位置无关，在只读分享模式下完全可用。触发后文件落到 `~/Downloads/`，再移动到工作区。

> ✅ **使用 `getNodeById` 直接获取节点，无需 PAGE_ID，避免递归遍历超时。**

```bash
# 触发导出（LAYER_ID 替换为实际值，无需 PAGE_ID）
~/.catpaw/bin/catdesk browser-action '{"action":"evaluate","script":"(function(){var n=window.mg.getNodeById(\"LAYER_ID\");if(!n)return \"node not found\";var fname=(n.name||\"node\").replace(/[/\\\\:*?\"<>|]/g,\"_\")+\".png\";n.exportAsync({format:\"PNG\",constraint:{type:\"SCALE\",value:2}}).then(function(bytes){var blob=new Blob([bytes],{type:\"image/png\"});var url=URL.createObjectURL(blob);var a=document.createElement(\"a\");a.href=url;a.download=fname;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);});return \"exporting: \"+fname;})()"}'

# 等待落盘后移动到 .tmp/ 目录（禁止写入项目根目录）
sleep 3 && mkdir -p .tmp && mv ~/Downloads/FILENAME.png .tmp/FILENAME.png
```

移动完成后用 `mcp_tool_sdk-image-reader_image_read` 读取整图做**初步视觉确认**（确认导出成功、内容正确），然后**必须进入 3A-2 切片流程**。

> ⚠️ **铁律：整图仅用于初步确认，不得直接基于整图分析规范。凡页面高度 > 600pt（即原始 PNG 高度 > 1200px），必须执行 3A-2 切片，再逐模块分析。**

## 3A-2：裁剪切片（必须执行）

切片分两个阶段：**先用节点坐标精确切割**（主方案），再用 `image_read` 逐张读取让 AI 做语义命名。

> **为什么不用 AI 视觉估算坐标？** `image_read` 会将整图缩放到最大 1568px，长页面压缩后每个模块只有几十像素高，AI 估算误差大，容易截断 status_bar / nav_bar / tab_bar 等边界模块。节点坐标是精确 pt 值，换算后误差为零。

### 执行顺序说明

切片依赖 SQLite 中的节点坐标数据，因此**正确执行顺序为**：

```
3A-1  exportAsync 导出整图 → image_read 初步确认
3A-3  dumpTree 下载 JSON
3A-4  mg_import.py 入库 SQLite（立即执行，不可延迟）
3A-2  flat 获取坐标 → 语义映射 → 脚本切片 → image_read 逐张验证
3A-5  逐模块精确属性查询 → 生成规范
```

> ⚠️ **禁止在 3A-4 入库完成前执行 3A-2，也禁止跳过 3A-2 直接进入 3A-5。**

### 3A-2-1：用 flat 命令获取顶层子节点坐标

3A-4 入库完成后，用 `flat` 命令列出根节点的直接子节点，按 y 坐标排序：

```bash
# 列出根节点下所有子节点（绝对坐标，按 y 排序）
python3 .catpaw/skills/mastergo-extractor/mg_query.py \
    --output-dir ./mg_export/YYYYMMDD_NNN flat --root LAYER_ID --absolute
```

输出示例：
```
y=0pt    h=176pt  [FRAME] 顶bar
y=0pt    h=468pt  [GROUP] 头图（比例16:9）
y=383pt  h=289pt  [FRAME] 基本信息
y=672pt  h=88pt   [INSTANCE] 居左型
y=760pt  h=1013pt [FRAME] 好店
...
```

### 3A-2-2：AI 对照整图做语义映射，输出切片定义

用 `mcp_tool_sdk-image-reader_image_read` 读取整图，结合 flat 输出的节点列表，AI 将节点映射为语义模块名称，输出切片定义（坐标用节点精确 dp 值，名称用语义名）：

```python
blocks = [
    # name,              y_pt,  h_pt,  说明
    ("01_status_nav",    0,     176,   "状态栏+导航栏"),
    ("02_hero_image",    0,     468,   "头图区（含轮播）"),
    ("03_poi_info",      383,   289,   "POI基本信息"),
    ("04_tab_bar",       672,   88,    "频道导航Tab"),
    ("05_product_list",  760,   1013,  "好店商品列表"),
    # ... 继续列出所有模块
]
```

映射原则：
- 多个小节点可合并为一个语义模块（取 `min(y)` ~ `max(y+h)`）
- 节点名称无语义（如「容器 34302」）时，对照截图位置推断语义名
- 超高模块（h > 1500pt）可在明显间隙处细分为多个切片

### 3A-2-3：脚本按节点坐标裁剪（含 buffer）

> ⚠️ **坐标换算说明（重要）**
>
> `mg_query` 输出的坐标已经过 `scale` 缩放（C 端 `--platform c` 时 scale=0.5，即原始 750pt → 输出 375pt）。
> 而 `exportAsync` 导出的 PNG 是基于**原始坐标系**渲染的（750pt × export_scale=2 → 1500px）。
>
> 因此切片时必须先将 mg_query 输出的坐标**还原到原始坐标系**，再乘以 export_scale：
>
> ```
> # C 端（platform c，scale=0.5）：
> db_scale = 0.5          # mg_query 输出坐标的缩放比
> db_scale_inv = 1 / db_scale  # = 2.0，还原到原始坐标系
> export_scale = 2        # exportAsync 的 value
> total_scale = db_scale_inv * export_scale  # = 4.0
>
> # B 端（无 platform，scale=1.0）：
> total_scale = 1.0 * 2 = 2.0
> ```
>
> **blocks 中填写 mg_query 输出的 pt 值（375pt 体系），脚本内部自动换算。**

```python
from PIL import Image
import os, re

img = Image.open("INPUT.png")       # 替换为实际路径
orig_w, orig_h = img.size
export_scale = 2   # 与 exportAsync 调用时的 value 一致
db_scale = 0.5     # C 端 platform c 时为 0.5；B 端为 1.0
# total_scale = (1/db_scale) * export_scale
# C 端：(1/0.5)*2 = 4.0；B 端：(1/1.0)*2 = 2.0
total_scale = (1.0 / db_scale) * export_scale
buffer = 20        # 向上下各扩展 20px，容错 buffer

os.makedirs(".tmp/slices", exist_ok=True)  # 切片输出到 .tmp/ 目录，禁止写入项目根目录

# 粘贴 3A-2-2 中 AI 输出的 blocks 列表
# y_pt / h_pt 使用 mg_query 输出的值（已 scale，C 端为 375pt 体系）
blocks = [
    # (name, y_pt, h_pt, desc)
]

for name, y_pt, h_pt, desc in blocks:
    # mg_query 输出的 pt → 原始图片像素坐标（含 buffer）
    py0 = max(0,      int(y_pt * total_scale) - buffer)
    py1 = min(orig_h, int((y_pt + h_pt) * total_scale) + buffer)
    safe = re.sub(r'[\/\\:*?"<>|（）【】\s]+', '_', name).strip('_')
    out_path = f".tmp/slices/{safe}.png"
    img.crop((0, py0, orig_w, py1)).save(out_path)
    print(f"  {out_path}  y={y_pt}~{y_pt+h_pt}pt → px({py0}~{py1})  [{desc}]")
```

切片后采用**抽样 + AI 批量验证**策略，无需逐张等待用户确认：

**验证规则：**

- 切片数 ≤ 4 张：全部一次性 `image_read`
- 切片数 5~10 张：抽取首张、中间张、末张（共 3 张）批量 `image_read`
- 切片数 > 10 张：抽取首、1/4、1/2、3/4、末共 5 张

所有抽样切片在**同一轮**调用 `image_read`，AI 自行判断内容是否正确（无空白、无截断、语义与 desc 匹配）。

**只有以下情况才打断用户：**
- 某张切片内容为纯空白
- 某张切片明显截断了关键内容（如只有半行文字）
- 抽样切片与预期语义完全不符

验证通过后，直接输出交接摘要进入 3A-5，**不需要用户逐张回复确认**：

```
✅ 切片验证完成（抽样 M/N 张，全部通过）
• 切片总数：N 张
• 输出目录：./mg_export/YYYYMMDD_NNN/images/
• 抽样验证：
  01_xxx.png  [模块语义名]  ✓ 内容符合预期
  0X_xxx.png  [模块语义名]  ✓ 内容符合预期
  0N_xxx.png  [模块语义名]  ✓ 内容符合预期
• 未抽样切片（依赖坐标精度，视为通过）：
  02_xxx.png / 03_xxx.png / ...
→ 进入 3A-5 逐模块精确属性查询...
```

> ⚠️ 若抽样切片发现问题，必须重新调整 y_pt/h_pt 后重新切片，不得带着问题切片进入 3A-5。

---

### 备选：AI 视觉估算坐标方案

> 仅当节点数据不可用（未入库）且整图压缩后仍能清晰识别各模块时使用。精度低于节点坐标方案，长页面容易截断边界模块。

用 `mcp_tool_sdk-image-reader_image_read` 读取整图，AI 根据视觉内容直接估算像素坐标（`x/y/w/h`，单位 px，相对于 image_read 缩放后图片）：

```python
blocks = [
    {"name": "header",    "x": 0,   "y": 0,    "w": 750, "h": 96},
    {"name": "hero",      "x": 0,   "y": 96,   "w": 750, "h": 560},
    {"name": "card_list", "x": 0,   "y": 656,  "w": 750, "h": 1200},
    {"name": "footer",    "x": 0,   "y": 1856, "w": 750, "h": 196},
]
```

> ⚠️ `image_read` 会将图片缩放到最大 1568px，AI 输出的坐标是**缩放后图片的坐标**，裁剪前必须换算回原始图片坐标。`image_read` 返回的 metadata 中有 `width`/`height` 字段，即 AI 实际看到的缩放后尺寸。

```python
from PIL import Image
import os, re

img = Image.open("INPUT.png")
orig_w, orig_h = img.size
export_scale = 2
root_canvas_x = 0    # 从 mg_query node LAYER_ID 读取
root_canvas_y = 0
scaled_w = 784       # 从 image_read 返回的 width
scaled_h = 3136      # 从 image_read 返回的 height
view_scale_x = orig_w / scaled_w
view_scale_y = orig_h / scaled_h
padding = 20

os.makedirs(".tmp/slices", exist_ok=True)

blocks = []  # 粘贴 AI 输出的 blocks 列表

for i, b in enumerate(blocks):
    px0 = max(0,      int(b["x"]            * view_scale_x) - padding)
    py0 = max(0,      int(b["y"]            * view_scale_y) - padding)
    px1 = min(orig_w, int((b["x"]+b["w"])   * view_scale_x) + padding)
    py1 = min(orig_h, int((b["y"]+b["h"])   * view_scale_y) + padding)
    # 画布绝对坐标（供 flat --bbox 使用）
    cx = px0 / export_scale + root_canvas_x
    cy = py0 / export_scale + root_canvas_y
    cw = (px1 - px0) / export_scale
    ch = (py1 - py0) / export_scale
    safe = re.sub(r'[\/\\:*?"<>|（）【】\s]+', '_', b["name"]).strip('_')
    out_path = f".tmp/slices/{i+1:02d}_{safe}.png"
    img.crop((px0, py0, px1, py1)).save(out_path)
    print(f"  {out_path}")
    print(f"    图片坐标: ({px0},{py0})→({px1},{py1})")
    print(f"    flat --bbox {cx:.0f},{cy:.0f},{cw:.0f},{ch:.0f}")
```

---

## 3A-3：提取节点完整规范数据（dumpTree）

由于 dumpTree 返回的 JSON 可能很大（数十万字符），直接通过 browser-action 返回容易截断或转义出错。**推荐使用下载方式保存**。

> ✅ **使用 `getNodeById` 直接获取节点，无需 PAGE_ID，避免递归遍历超时。**

> ⚠️ **必须分两步执行**：节点树较大时，单次 evaluate 同步执行 dumpTree + JSON.stringify + 触发下载会超时。正确做法是：第一步注入函数到 `window.__mgDump`（立即返回），第二步再调用触发下载（异步执行，立即返回）。

> 🔴 **执行前铁律：必须先确认浏览器已打开目标 MasterGo 页面，且 `window.mg` 就绪。** 3A-1（exportAsync）与 3A-3（dumpTree）之间可能间隔多个步骤，浏览器页面可能已跳走。执行 dumpTree 前必须先检查，若未就绪则重新导航：
>
> ```bash
> # 检查 window.mg 是否就绪
> ~/.catpaw/bin/catdesk browser-action '{"action":"evaluate","script":"JSON.stringify(window.mg && window.mg.document ? \"ready\" : \"mg not ready\")"}'
>
> # 若返回 "mg not ready"，重新导航（FILE_ID / PAGE_ID / LAYER_ID 替换为实际值）
> ~/.catpaw/bin/catdesk browser-action '{"action":"navigate","url":"https://imd.sankuai.com/file/FILE_ID?page_id=PAGE_ID&layer_id=LAYER_ID&devMode=true","waitUntil":"networkidle"}'
> # 导航后再次确认 window.mg 就绪，再继续执行下方步骤
> ```

### 方式一：下载保存（推荐，最稳定）

```bash
# 第一步：注入 dumpTree 函数到 window.__mgDump（立即返回，不超时）
~/.catpaw/bin/catdesk browser-action '{"action":"evaluate","script":"window.__mgDump=function(node){if(node.isVisible===false)return null;var info={id:node.id,name:node.name,type:node.type};if(node.width!==undefined)info.w=node.width;if(node.height!==undefined)info.h=node.height;if(node.x!==undefined)info.x=node.x;if(node.y!==undefined)info.y=node.y;if(node.rotation!==undefined&&node.rotation!==0)info.rotation=node.rotation;if(node.characters)info.text=node.characters.trim();if(node.fills&&node.fills.length>0)info.fills=node.fills;if(node.paddingLeft!==undefined)info.padding={l:node.paddingLeft,r:node.paddingRight,t:node.paddingTop,b:node.paddingBottom};if(node.itemSpacing!==undefined)info.gap=node.itemSpacing;if(node.counterAxisSpacing!==undefined&&node.counterAxisSpacing!==0)info.crossGap=node.counterAxisSpacing;if(node.layoutMode&&node.layoutMode!==\"NONE\")info.layout=node.layoutMode;if(node.layoutWrap)info.layoutWrap=node.layoutWrap;if(node.primaryAxisAlignItems)info.mainAlign=node.primaryAxisAlignItems;if(node.counterAxisAlignItems)info.crossAlign=node.counterAxisAlignItems;if(node.layoutSizingHorizontal)info.sizingH=node.layoutSizingHorizontal;if(node.layoutSizingVertical)info.sizingV=node.layoutSizingVertical;if(node.layoutGrow!==undefined&&node.layoutGrow!==0)info.grow=node.layoutGrow;if(node.minWidth!==undefined&&node.minWidth!==0)info.minW=node.minWidth;if(node.maxWidth!==undefined&&node.maxWidth!==0)info.maxW=node.maxWidth;if(node.minHeight!==undefined&&node.minHeight!==0)info.minH=node.minHeight;if(node.maxHeight!==undefined&&node.maxHeight!==0)info.maxH=node.maxHeight;var tl=node.topLeftRadius,tr=node.topRightRadius,bl=node.bottomLeftRadius,br=node.bottomRightRadius;if(tl!==undefined&&tr!==undefined&&bl!==undefined&&br!==undefined){if(tl===tr&&tr===bl&&bl===br){if(tl!==0)info.radius=tl;}else{info.radius={tl:tl,tr:tr,bl:bl,br:br};}}else if(node.cornerRadius!==undefined&&node.cornerRadius!==0){info.radius=node.cornerRadius;}if(node.strokeWeight!==undefined&&node.strokes&&node.strokes.length>0){info.strokeWeight=node.strokeWeight;info.strokeAlign=node.strokeAlign;}if(node.strokes&&node.strokes.length>0)info.strokes=node.strokes;if(node.constraints)info.constraints=node.constraints;if(node.blendMode&&node.blendMode!==\"PASS_THROUGH\"&&node.blendMode!==\"NORMAL\")info.blendMode=node.blendMode;if(node.clipsContent)info.clipsContent=node.clipsContent;if(node.isMask)info.isMask=node.isMask;if(node.type===\"TEXT\"){var ts=(node.textStyles&&node.textStyles.length>0)?node.textStyles[0]:null;var tst=ts?ts.textStyle:null;if(tst){if(tst.fontSize!==undefined)info.fontSize=tst.fontSize;if(tst.fontWeight!==undefined)info.fontWeight=tst.fontWeight;if(tst.fontName&&tst.fontName.family)info.fontFamily=tst.fontName.family;if(tst.fontName&&tst.fontName.style)info.fontStyle=tst.fontName.style;if(tst.lineHeight!==undefined)info.lineHeight=tst.lineHeight;if(tst.letterSpacing!==undefined&&tst.letterSpacing.value!==0)info.letterSpacing=tst.letterSpacing;if(tst.textDecoration&&tst.textDecoration!==\"NONE\")info.textDecoration=tst.textDecoration;if(tst.textCase&&tst.textCase!==\"ORIGINAL\")info.textCase=tst.textCase;}if(node.textAlignHorizontal)info.textAlign=node.textAlignHorizontal;}if(node.opacity!==undefined&&node.opacity!==1)info.opacity=node.opacity;if(node.effects&&node.effects.length>0)info.effects=node.effects;if(node.children&&node.children.length>0){var kids=node.children.map(function(c){return window.__mgDump(c);}).filter(function(c){return c!==null;});if(kids.length>0)info.children=kids;}return info;};\"__mgDump injected\""}'

# 第二步：调用函数、序列化、触发下载（异步执行，立即返回，不超时）
# 将 LAYER_ID 替换为实际值（如 10:10844）
~/.catpaw/bin/catdesk browser-action '{"action":"evaluate","script":"(function(){var node=window.mg.getNodeById(\"LAYER_ID\");if(!node)return\"node not found\";var fname=\"mg_dump_\"+\"LAYER_ID\".replace(/:/g,\"_\")+\".json\";setTimeout(function(){var result=window.__mgDump(node);var jsonStr=JSON.stringify(result);var blob=new Blob([jsonStr],{type:\"application/json\"});var url=URL.createObjectURL(blob);var a=document.createElement(\"a\");a.href=url;a.download=fname;document.body.appendChild(a);a.click();setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(url);},1000);},0);return\"downloading: \"+fname;})()"}'

# 等待下载完成，移动到 .tmp/ 目录（禁止写入项目根目录）
sleep 5
mkdir -p .tmp && mv ~/Downloads/mg_dump_LAYER_ID.json .tmp/mg_dump_LAYER_ID.json
```

> **注意**：将两条命令中的 `LAYER_ID` 均替换为实际值，无需 `PAGE_ID`，`getNodeById` 直接全局查找。

> `fontSize`、`fontWeight` 等属性在 INSTANCE/FRAME 节点上不存在，需深入到 TEXT 子节点才能获取。

---

## 3A-4：dumpTree 完成后立即入库（必须执行）

> **为什么必须在这里入库？** dumpTree 返回的 JSON 可能有数万 token。入库后上下文只保留「已入库」确认，后续所有属性查询通过 `mg_query.py` 按需检索。

入库时同步生成两份辅助文件：

- **`mg_slim_*.json`（精简 JSON）**：只含 `id/name/type/w/h/text`，树形结构完整保留，token 量约为完整 JSON 的 5~10%。**这是查询的起点**——直接 `read_file` 读进上下文，浏览全貌、定位目标区块的 `id`，再按需查精确属性。
- **`mg_tree_*.md`（缩略节点树）**：含样式摘要（填充色、字号、圆角、padding 等），适合快速核对样式。

**典型查询流程**：

```
1. read_file mg_slim_*.json   → 浏览结构，找到目标区块的 id
2. mg_query.py node <id>      → 查该节点的精确属性（尺寸、颜色、布局等）
3. mg_query.py subtree <id>   → 展开子树（若子节点是 FRAME/INSTANCE，结构可信）
   或 mg_query.py find --type TEXT  → 跨节点条件查询
```

> **GROUP 子节点注意**：GROUP 内子节点顺序在 dumpTree 中是随机的，不反映视觉层级。`subtree` 对 GROUP 的子节点改用 `rowid`（插入顺序）排序，但仍不代表视觉顺序。如需确认视觉排列，以截图为准。

### 方式一：使用独立目录（默认）

**导入前必须询问端类型（若上下文中已明确则跳过）：**

```
这是 C 端（手机）设计稿吗？
  Y → 导入时加 --platform c，所有坐标/尺寸输出自动转为 375pt
  N → 不加此参数，保留原始值
```

> 若用户在之前的对话中已明确说明（如"C端"、"手机页面"、"移动端"），直接使用 `--platform c`，无需再问。

```bash
# 1. 导入 SQLite（默认自动生成目录，同时生成缩略节点树 .md 和 index.md）
# C 端手机设计稿加 --platform c，输出将自动转为 375pt；B 端 / M 端不传此参数
python3 .catpaw/skills/mastergo-extractor/mg_import.py \
    ./mg_dump.json \
    --file-id <FILE_ID> \
    --page-id <PAGE_ID> \
    --page-name "页面名称" \
    --platform c \    # C 端加此行；B 端 / M 端删除
    --clear

# 输出示例：
# 📁 输出目录：./mg_export/20250326_001
#    📷 图片目录：./mg_export/20250326_001/images
#    💾 数据目录：./mg_export/20250326_001/data

# 2. 确认入库（使用自动生成的目录）
python3 .catpaw/skills/mastergo-extractor/mg_query.py \
    --output-dir ./mg_export/20250326_001 stats

# 3. 查看缩略节点树
python3 .catpaw/skills/mastergo-extractor/mg_query.py \
    --output-dir ./mg_export/20250326_001 tree
```

生成的目录结构：
```
./mg_export/20250326_001/
├── index.md          # 索引文件
├── images/           # 图片目录（存放 exportAsync 导出的 PNG）
└── data/
    ├── mastergo.db   # SQLite 数据库
    └── mg_tree_*.md  # 缩略节点树
```

### 方式二：使用默认数据库

```bash
# 导入（不使用目录模式）
python3 .catpaw/skills/mastergo-extractor/mg_import.py \
    ./mg_dump.json \
    --no-dir \
    --file-id <FILE_ID> \
    --page-id <PAGE_ID> \
    --page-name "页面名称" \
    --clear

# 确认入库
python3 .catpaw/skills/mastergo-extractor/mg_query.py stats

# 查看缩略节点树
python3 .catpaw/skills/mastergo-extractor/mg_query.py tree
```

入库完成后，上下文中的原始 JSON 可以丢弃。后续查询见 [sqlite-reference.md](./sqlite-reference.md)。

---

## 3A-5：逐模块拍平节点 → 推算布局 → 查精确属性 → 生成规范

这是生成最终规范文档的核心步骤，对每个切片模块依次执行以下子步骤。

> **`--bbox` 参数格式为 `x,y,w,h`（单位 pt）**，相对于根节点坐标系。

### 3A-5-0：生成布局结构描述（必须在规范文档开头输出）

在输出任何属性细节之前，先用 `mg_query tree` 和 `flat --root` 的结果，生成整体布局的结构描述。输出两部分：

**① ASCII 树形图**：用缩进层级表示容器嵌套关系，每行标注尺寸和关键布局属性。

格式规则：
- 每个容器节点写：`容器语义名（W × H pt）[布局方向，pad=T/R/B/L，gap=N]`
- 叶子节点（文字/图片）写：`元素语义名（W × H pt）`
- 用 `├──` / `└──` 表示兄弟关系，`│` 表示延续线
- 同一父容器下的兄弟节点按视觉顺序（y 或 x 坐标）排列

示例：
```
整体容器（718 × 713pt）[VERTICAL，pad=10/10/10/10，gap=10]
├── 标题区（216 × 52pt）
│   └── 「附近热销住宿」（216 × 52pt）
└── 白色卡片容器（718 × 650pt）[圆角 24pt，pad=24/24/24/24]
    └── 卡片列表（670 × 602pt）[VERTICAL，gap=48]
        ├── 卡片 1（670 × 277pt）[HORIZONTAL，pad=10/10/10/10，gap=10]
        │   ├── 图片（200 × 277pt）[圆角 12pt]
        │   └── 右侧信息区（408 × 204pt）[VERTICAL，gap=16]
        │       ├── 名称行（408 × 32pt）[HORIZONTAL，gap=8]
        │       ├── 评分行（364 × 28pt）[HORIZONTAL，gap=8]
        │       ├── 距离行（301 × 24pt）[HORIZONTAL，gap=4]
        │       ├── 地址行（344 × 24pt）[HORIZONTAL，gap=8]
        │       └── 标签行（172 × 32pt）[HORIZONTAL，gap=8]
        │           ├── 「实拍视频」标签（92 × 32pt）[描边，圆角 6pt]
        │           └── 「健身房」标签（72 × 32pt）[圆角 8pt]
        │   ↘ 底部浮动（constraints: END，不参与 Auto Layout 流）
        │       ├── 价格行（163 × 36pt）[HORIZONTAL，gap=4]
        │       └── 操作行（290 × 28pt）[HORIZONTAL，gap=8]
        └── 卡片 2（结构同卡片 1）
```

**② 关键布局说明**：用 2～4 句话点出结构中不直观的地方，例如：
- 哪些节点脱离了 Auto Layout 流（constraints: END / START 固定吸附）
- 哪些容器存在层叠（z 轴遮盖关系）
- 哪些视觉上看起来是一组但实际是兄弟节点而非父子节点

> **输出要求**：ASCII 树和说明文字必须出现在规范文档的最顶部（在所有模块属性细节之前），作为读者理解整体结构的入口。

---

### 3A-5-1：拍平模块内节点

```bash
# 拍平某模块内所有节点（相对根节点坐标，intersects 模式）
python3 mg_query.py --output-dir ./mg_export/YYYYMMDD_NNN \
    flat --root LAYER_ID --bbox 0,Y_PT,750,H_PT

# 若顶层容器干扰，改用 contains 只取完全在区域内的节点
python3 mg_query.py --output-dir ./mg_export/YYYYMMDD_NNN \
    flat --root LAYER_ID --bbox 0,Y_PT,750,H_PT --bbox-mode contains
```

输出格式：`[TYPE] id  x,y  w×h  (depth=N)  名称  文字  样式`，其中样式列已包含 `fills_hex / r(圆角) / gap / pad`。

### 3A-5-2：从坐标差推算布局

拿到节点列表后，按以下规则从坐标数据推算布局属性：

**padding**（容器内边距）：
```
padding_left   = 最左子节点.x − 容器.x
padding_right  = (容器.x + 容器.w) − (最右子节点.x + 最右子节点.w)
padding_top    = 最上子节点.y − 容器.y
padding_bottom = (容器.y + 容器.h) − (最下子节点.y + 最下子节点.h)
```

**gap**（同方向相邻元素间距）：
```
# 纵向排列
gap = 下一个节点.y − (上一个节点.y + 上一个节点.h)

# 横向排列
gap = 右侧节点.x − (左侧节点.x + 左侧节点.w)
```

**margin**（节点到视觉容器边缘）：
```
margin_left = 节点.x − 父容器.x − 父容器.padding_left
```

> 节点的 `pad` / `gap` 字段若已在 flat 输出中显示，直接使用节点自身值；若未显示，则用坐标差推算。坐标差推算结果与节点自身值不一致时，以节点自身值为准。

### 3A-5-3：查精确属性（color / fontSize / radius 等）

flat 输出的样式列只包含部分属性，以下属性需用 `node` 命令补充查询：

```bash
# 查单个节点完整属性（含 fontSize、fontWeight、lineHeight、letterSpacing、fills、strokes、effects 等）
python3 mg_query.py --output-dir ./mg_export/YYYYMMDD_NNN node NODE_ID
```

**必查属性清单**（每个视觉层级至少查一次）：

| 属性 | 说明 |
|------|------|
| `fills_hex` | 背景/文字颜色，`#RRGGBB` |
| `fontSize` | 字号（pt） |
| `fontWeight` | 字重（400=Regular，500=Medium，700=Bold） |
| `lineHeight` | 行高（pt 或百分比） |
| `letterSpacing` | 字间距 |
| `radius` | 圆角（pt，或 `{tl,tr,bl,br}` 分角） |
| `strokeWeight` | 描边宽度 |
| `strokes_hex` | 描边颜色 |
| `effects` | 阴影/模糊（含 offset、radius、color） |
| `opacity` | 透明度（0~1） |
| `gap` | 子元素间距（Auto Layout） |
| `padding_t/r/b/l` | 内边距（Auto Layout） |

颜色若为 0-1 浮点格式，转换公式：`#HEX = hex(r*255) + hex(g*255) + hex(b*255)`

### 3A-5-4：汇总输出规范文档

每个模块按以下结构输出，**所有数值必须来自节点数据，不得估算**：

```markdown
## 模块名（语义名）

**尺寸**：Npt × Npt
**背景**：#XXXXXX
**圆角**：Npt（或 无）

### 布局
- 方向：纵向（VERTICAL）/ 横向（HORIZONTAL）
- padding：top Npt / right Npt / bottom Npt / left Npt
- gap：Npt

### 子元素

#### 元素名
- 尺寸：W × H pt
- 背景：#XXXXXX
- 圆角：Npt
- 描边：Npt，#XXXXXX
- margin：top Npt / right Npt / bottom Npt / left Npt（仅绝对定位或脱离 Auto Layout 流时标注；Auto Layout 子元素省略此项）
- 与相邻元素间距：Npt（或 靠左对齐 / 靠右对齐 等相对描述）

#### 文字元素名
- 内容：「实际文字」
- 字号：Npt
- 字重：N（Bold/Medium/Regular）
- 行高：Npt
- 颜色：#XXXXXX
- margin：top Npt / right Npt / bottom Npt / left Npt（仅绝对定位或脱离 Auto Layout 流时标注；Auto Layout 子元素省略此项）
```

> 规范描述以**模块为维度**：只写相对布局（padding、gap、尺寸、间距、对齐方式），**不写页面级绝对坐标**（x=N, y=N）。属性缺失或无法从节点数据确认时，标注 `⚠️ 待确认`，不得填写估算值。

---

## 辅助：全屏截图（仅需周边上下文时执行）

全屏截图依赖视口位置，需先隐藏面板、定位视口。

**① 隐藏左右面板（⌘\）**

```bash
~/.catpaw/bin/catdesk browser-action '{"action":"evaluate","script":"(function(){function pressKey(opts){var e=new KeyboardEvent(\"keydown\",Object.assign({bubbles:true,cancelable:true,view:window},opts));var p=!document.dispatchEvent(e);document.dispatchEvent(new KeyboardEvent(\"keyup\",Object.assign({bubbles:true,cancelable:true,view:window},opts)));return p;} return pressKey({key:\"\\\\\",code:\"Backslash\",metaKey:true,keyCode:220});})()"}'
```

**② 定位视口到目标节点**

> ✅ **使用 `getNodeById` 直接获取节点，无需 PAGE_ID。**

```bash
~/.catpaw/bin/catdesk browser-action '{"action":"evaluate","script":"(function(){var n=window.mg.getNodeById(\"LAYER_ID\");if(!n)return \"node not found\";window.mg.viewport.scrollAndZoomIntoView([n]);return \"viewport set to: \"+n.name;})()"}'
```

**③ 截图**

```bash
sleep 1 && ~/.catpaw/bin/catdesk browser-action '{"action":"screenshot"}'
```

**④ 恢复面板**：再执行一次步骤①的脚本即可（⌘\ 是开关，再触发一次恢复）。
