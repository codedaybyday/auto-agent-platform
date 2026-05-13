#!/usr/bin/env python3
"""
mg_import.py — 将 MasterGo dumpTree JSON 导入本地 SQLite 数据库

用法：
    python3 mg_import.py <json_file_or_stdin> [options]

选项：
    --db PATH       数据库路径（默认 ~/.catpaw/mastergo.db）
    --output-dir DIR  输出目录（会创建 images/、data/ 子目录，生成 index.md 索引）
    --file-id ID    MasterGo 文件 ID
    --page-id ID    MasterGo 页面 ID
    --page-name N   页面名称（可选，便于检索）
    --clear         导入前清除同一 file_id + page_id 的旧数据
    --no-tree       跳过缩略节点树生成

示例：
    # 从文件导入（默认数据库）
    python3 mg_import.py dump.json --file-id 137265492322647 --page-id 75389:52441

    # 从 stdin 导入（配合 browser-action 管道）
    echo '<json>' | python3 mg_import.py - --file-id 137265492322647 --page-id 75389:52441

    # 导入到指定目录（推荐：每次执行一个独立目录）
    python3 mg_import.py dump.json --output-dir ./mg_export/20250326_001 \
        --file-id 137265492322647 --page-id 75389:52441 --page-name "首页"
"""

import sys
import json
import sqlite3
import argparse
import os
import re
import shutil
from datetime import datetime
from pathlib import Path


# ── Schema ──────────────────────────────────────────────────────────────────

DDL = """
CREATE TABLE IF NOT EXISTS mg_nodes (
    id              TEXT NOT NULL,      -- 节点 id（MasterGo 原始 id）
    file_id         TEXT NOT NULL,      -- 文件 id
    page_id         TEXT NOT NULL,      -- 页面 id
    page_name       TEXT,               -- 页面名称
    parent_id       TEXT,               -- 父节点 id（根节点为 NULL）
    depth           INTEGER NOT NULL,   -- 树深度（根=0）
    name            TEXT,               -- 节点名称
    type            TEXT,               -- 节点类型（FRAME/TEXT/COMPONENT 等）
    text            TEXT,               -- 文字内容（TEXT 节点）
    w               REAL,               -- 宽度 px
    h               REAL,               -- 高度 px
    x               REAL,               -- 画布 x 坐标
    y               REAL,               -- 画布 y 坐标
    -- 文字样式
    font_size       REAL,               -- 字号
    font_weight     TEXT,               -- 字重
    font_family     TEXT,               -- 字体
    line_height     TEXT,               -- 行高（JSON 序列化）
    letter_spacing  REAL,               -- 字间距
    text_align      TEXT,               -- 水平对齐
    -- 布局
    layout          TEXT,               -- 自动布局方向（HORIZONTAL/VERTICAL）
    layout_wrap     TEXT,               -- 换行（WRAP/NO_WRAP）
    main_align      TEXT,               -- 主轴对齐
    cross_align     TEXT,               -- 交叉轴对齐
    sizing_h        TEXT,               -- 水平尺寸模式（FIXED/HUG/FILL）
    sizing_v        TEXT,               -- 垂直尺寸模式
    -- 盒模型
    padding_t       REAL,               -- padding-top
    padding_r       REAL,               -- padding-right
    padding_b       REAL,               -- padding-bottom
    padding_l       REAL,               -- padding-left
    gap             REAL,               -- 主轴间距（itemSpacing）
    cross_gap       REAL,               -- 交叉轴间距
    -- 圆角
    radius          TEXT,               -- 圆角（统一值为数字，四角不同为 JSON）
    -- 描边
    stroke_weight   REAL,               -- 描边粗细
    stroke_align    TEXT,               -- 描边位置（INSIDE/OUTSIDE/CENTER）
    strokes_hex     TEXT,               -- 描边颜色 HEX（首个）
    -- 填充 & 外观
    fills_hex       TEXT,               -- 主填充色 HEX（首个纯色）
    opacity         REAL,               -- 透明度（1 = 不透明）
    -- 约束 & 其他
    constraints     TEXT,               -- 约束 JSON
    clips_content   INTEGER,            -- 是否裁剪子内容
    effects         TEXT,               -- 阴影/模糊 JSON
    props           TEXT,               -- 其余所有属性 JSON（兜底）
    PRIMARY KEY (file_id, page_id, id)
);

CREATE INDEX IF NOT EXISTS idx_mg_file_page   ON mg_nodes(file_id, page_id);
CREATE INDEX IF NOT EXISTS idx_mg_type        ON mg_nodes(type);
CREATE INDEX IF NOT EXISTS idx_mg_name        ON mg_nodes(name);
CREATE INDEX IF NOT EXISTS idx_mg_text        ON mg_nodes(text);
CREATE INDEX IF NOT EXISTS idx_mg_parent      ON mg_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_mg_font_size   ON mg_nodes(font_size);
CREATE INDEX IF NOT EXISTS idx_mg_fills_hex   ON mg_nodes(fills_hex);
CREATE INDEX IF NOT EXISTS idx_mg_radius      ON mg_nodes(radius);
CREATE INDEX IF NOT EXISTS idx_mg_gap         ON mg_nodes(gap);

CREATE VIRTUAL TABLE IF NOT EXISTS mg_fts USING fts5(
    id UNINDEXED,
    file_id UNINDEXED,
    page_id UNINDEXED,
    name,
    text,
    content='mg_nodes',
    content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS mg_nodes_ai AFTER INSERT ON mg_nodes BEGIN
    INSERT INTO mg_fts(rowid, id, file_id, page_id, name, text)
    VALUES (new.rowid, new.id, new.file_id, new.page_id, new.name, new.text);
END;
CREATE TRIGGER IF NOT EXISTS mg_nodes_ad AFTER DELETE ON mg_nodes BEGIN
    INSERT INTO mg_fts(mg_fts, rowid, id, file_id, page_id, name, text)
    VALUES ('delete', old.rowid, old.id, old.file_id, old.page_id, old.name, old.text);
END;

CREATE TABLE IF NOT EXISTS mg_meta (
    file_id     TEXT NOT NULL,
    page_id     TEXT NOT NULL,
    key         TEXT NOT NULL,
    value       TEXT,
    PRIMARY KEY (file_id, page_id, key)
);
"""


# ── 颜色转换 ─────────────────────────────────────────────────────────────────

def color_to_hex(c):
    """将 {r,g,b} 0-1 浮点转为 #rrggbb"""
    r = round(c.get("r", 0) * 255)
    g = round(c.get("g", 0) * 255)
    b = round(c.get("b", 0) * 255)
    return f"#{r:02x}{g:02x}{b:02x}"


def fills_to_hex(fills):
    """从 fills 数组提取第一个纯色，转为 #RRGGBB"""
    if not fills:
        return None
    for f in fills:
        if f.get("type") == "SOLID" or "color" in f:
            return color_to_hex(f.get("color", {}))
    return None


def strokes_to_hex(strokes):
    """从 strokes 数组提取第一个颜色"""
    if not strokes:
        return None
    for s in strokes:
        if "color" in s:
            return color_to_hex(s["color"])
    return None


# ── 树遍历 ───────────────────────────────────────────────────────────────────

# 所有已提升为独立列的字段，不再放入 props
KNOWN_FIELDS = {
    "id", "name", "type", "text", "w", "h", "x", "y",
    "fontSize", "fontWeight", "fontFamily", "lineHeight", "letterSpacing", "textAlign",
    "layout", "layoutWrap", "mainAlign", "crossAlign", "sizingH", "sizingV",
    "padding", "gap", "crossGap",
    "radius", "topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius",
    "cornerRadius",
    "strokeWeight", "strokeAlign", "strokes",
    "fills", "opacity",
    "constraints", "clipsContent", "effects",
    "children",
    # 以下字段在 dumpTree 中不输出，但也排除掉避免混入 props
    "rotation", "grow", "minW", "maxW", "minH", "maxH",
    "blendMode", "isMask", "textDecoration", "textCase",
    "fontWeight",
}


def parse_radius(node):
    """解析圆角：统一值返回数字字符串，四角不同返回 JSON 字符串"""
    r = node.get("radius")
    if r is not None:
        if isinstance(r, dict):
            return json.dumps(r)
        return str(r)
    return None


def flatten(node, file_id, page_id, page_name, parent_id=None, depth=0):
    """递归展平节点树，返回行列表"""
    rows = []

    padding = node.get("padding") or {}
    radius_val = parse_radius(node)
    strokes = node.get("strokes")

    # 其余未提升的字段存入 props 兜底
    props = {k: v for k, v in node.items() if k not in KNOWN_FIELDS}

    row = {
        "id":             node.get("id", ""),
        "file_id":        file_id,
        "page_id":        page_id,
        "page_name":      page_name,
        "parent_id":      parent_id,
        "depth":          depth,
        "name":           node.get("name"),
        "type":           node.get("type"),
        "text":           node.get("text"),
        "w":              node.get("w"),
        "h":              node.get("h"),
        "x":              node.get("x"),
        "y":              node.get("y"),
        # 文字样式
        "font_size":      node.get("fontSize"),
        "font_weight":    str(node["fontWeight"]) if "fontWeight" in node else None,
        "font_family":    node.get("fontFamily"),
        "line_height":    json.dumps(node["lineHeight"], ensure_ascii=False) if "lineHeight" in node else None,
        "letter_spacing": json.dumps(node["letterSpacing"], ensure_ascii=False) if "letterSpacing" in node else None,
        "text_align":     node.get("textAlign"),
        # 布局
        "layout":         node.get("layout"),
        "layout_wrap":    node.get("layoutWrap"),
        "main_align":     node.get("mainAlign"),
        "cross_align":    node.get("crossAlign"),
        "sizing_h":       node.get("sizingH"),
        "sizing_v":       node.get("sizingV"),
        # 盒模型
        "padding_t":      padding.get("t"),
        "padding_r":      padding.get("r"),
        "padding_b":      padding.get("b"),
        "padding_l":      padding.get("l"),
        "gap":            node.get("gap"),
        "cross_gap":      node.get("crossGap"),
        # 圆角
        "radius":         radius_val,
        # 描边
        "stroke_weight":  node.get("strokeWeight"),
        "stroke_align":   node.get("strokeAlign"),
        "strokes_hex":    strokes_to_hex(strokes),
        # 填充 & 外观
        "fills_hex":      fills_to_hex(node.get("fills")),
        "opacity":        node.get("opacity"),
        # 约束 & 其他
        "constraints":    json.dumps(node["constraints"], ensure_ascii=False) if "constraints" in node else None,
        "clips_content":  1 if node.get("clipsContent") else None,
        "effects":        json.dumps(node["effects"], ensure_ascii=False) if node.get("effects") else None,
        "props":          json.dumps(props, ensure_ascii=False) if props else None,
    }
    rows.append(row)

    for child in node.get("children", []):
        rows.extend(flatten(child, file_id, page_id, page_name, node.get("id"), depth + 1))

    return rows


# ── 缩略节点树生成 ────────────────────────────────────────────────────────────

def build_tree_line(row, root_depth):
    """生成缩略树的单行文字：只保留 id / type / name，用于结构导航"""
    indent = "  " * (row["depth"] - root_depth)
    node_type = row.get("type", "?")
    name = row.get("name") or ""
    node_id = row.get("id") or ""
    # 文字节点附带内容摘要，方便定位
    text = row.get("text") or ""
    text_hint = f'  "{text[:24]}{"…" if len(text) > 24 else ""}"' if text else ""
    return f"{indent}[{node_type}] {name}  ({node_id}){text_hint}"


def generate_tree_md(rows, file_id, page_id, page_name, root_id):
    """生成缩略节点树 Markdown 文本"""
    if not rows:
        return ""

    root_depth = rows[0]["depth"]
    lines = [
        f"# 节点树摘要",
        f"",
        f"- 根节点：`{root_id}`",
        f"- 文件：`{file_id}`  页面：`{page_id}`  {page_name or ''}",
        f"- 节点总数：{len(rows)}",
        f"",
        f"## 格式说明",
        f"",
        f"```",
        f"[类型] 名称  (节点id)  \"文字内容摘要（仅TEXT节点）\"",
        f"```",
        f"",
        f"> 样式属性（尺寸、颜色、padding 等）存储在 SQLite，用 mg_query.py node <id> 按需查询。",
        f"",
        f"## 节点树",
        f"",
        f"```",
    ]

    for row in rows:
        lines.append(build_tree_line(row, root_depth))

    lines.append("```")
    return "\n".join(lines)


# ── 主逻辑 ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="导入 MasterGo dumpTree JSON 到 SQLite")
    parser.add_argument("input", help="JSON 文件路径，或 - 表示 stdin")
    parser.add_argument("--db", default=str(Path.home() / ".catpaw" / "mastergo.db"),
                        help="数据库路径（默认 ~/.catpaw/mastergo.db）")
    parser.add_argument("--file-id", required=True, help="MasterGo 文件 ID")
    parser.add_argument("--page-id", required=True, help="MasterGo 页面 ID")
    parser.add_argument("--page-name", default="", help="页面名称")
    parser.add_argument("--platform", default="", help="设计稿端类型：c=C端手机（750pt设计稿，输出自动转为375pt）；空=保留原始值")
    parser.add_argument("--clear", action="store_true", help="导入前清除同页旧数据")
    parser.add_argument("--no-tree", action="store_true", help="跳过缩略节点树生成")
    parser.add_argument("--tree-out", default="", help="缩略树输出路径（默认与 db 同目录，自动命名）")
    parser.add_argument("--no-dir", action="store_true", help="不使用独立目录，保存到默认位置 ~/.catpaw/mastergo.db")
    parser.add_argument("--output-dir", default="", help="自定义输出目录（会创建 images/、data/ 子目录）")
    args = parser.parse_args()

    # 确定输出目录（默认启用目录模式）
    output_dir = None
    if args.no_dir:
        # 用户明确不使用目录模式
        output_dir = None
    elif args.output_dir:
        # 用户指定了自定义目录
        output_dir = Path(args.output_dir).expanduser().resolve()
    else:
        # 默认：自动生成目录名 mg_export/YYYYMMDD_NNN/
        base_dir = Path("./mg_export")
        today = datetime.now().strftime("%Y%m%d")
        
        # 查找今天的下一个序号
        seq = 1
        while True:
            candidate = base_dir / f"{today}_{seq:03d}"
            if not candidate.exists():
                output_dir = candidate
                break
            seq += 1
    
    # 如果确定了输出目录，创建结构
    if output_dir:
        images_dir = output_dir / "images"
        data_dir = output_dir / "data"
        
        # 创建目录结构
        images_dir.mkdir(parents=True, exist_ok=True)
        data_dir.mkdir(parents=True, exist_ok=True)
        
        # 更新数据库路径到 data 子目录
        db_path = data_dir / "mastergo.db"
        args.db = str(db_path)
        
        # 更新 tree-out 路径到 data 子目录
        safe_page = re.sub(r'[^\w\-]', '_', args.page_id)
        safe_file = args.file_id[:12]
        if not args.tree_out:
            args.tree_out = str(data_dir / f"mg_tree_{safe_file}_{safe_page}.md")
        print(f"📁 输出目录：{output_dir}")
        print(f"   📷 图片目录：{images_dir}")
        print(f"   💾 数据目录：{data_dir}")

    # 读取 JSON
    if args.input == "-":
        raw = sys.stdin.read()
    else:
        with open(args.input, "r", encoding="utf-8") as f:
            raw = f.read()

    # browser-action evaluate 返回的是带引号的字符串，需要二次解析
    data = json.loads(raw)
    if isinstance(data, str):
        data = json.loads(data)

    # 建库
    os.makedirs(os.path.dirname(os.path.abspath(args.db)), exist_ok=True)
    conn = sqlite3.connect(args.db)
    conn.executescript(DDL)

    if args.clear:
        conn.execute(
            "DELETE FROM mg_nodes WHERE file_id=? AND page_id=?",
            (args.file_id, args.page_id)
        )
        conn.execute(
            "DELETE FROM mg_meta WHERE file_id=? AND page_id=?",
            (args.file_id, args.page_id)
        )
        conn.commit()

    # 展平并插入
    rows = flatten(data, args.file_id, args.page_id, args.page_name)

    conn.executemany("""
        INSERT OR REPLACE INTO mg_nodes
            (id, file_id, page_id, page_name, parent_id, depth,
             name, type, text, w, h, x, y,
             font_size, font_weight, font_family, line_height, letter_spacing, text_align,
             layout, layout_wrap, main_align, cross_align, sizing_h, sizing_v,
             padding_t, padding_r, padding_b, padding_l, gap, cross_gap,
             radius, stroke_weight, stroke_align, strokes_hex,
             fills_hex, opacity, constraints, clips_content, effects, props)
        VALUES
            (:id, :file_id, :page_id, :page_name, :parent_id, :depth,
             :name, :type, :text, :w, :h, :x, :y,
             :font_size, :font_weight, :font_family, :line_height, :letter_spacing, :text_align,
             :layout, :layout_wrap, :main_align, :cross_align, :sizing_h, :sizing_v,
             :padding_t, :padding_r, :padding_b, :padding_l, :gap, :cross_gap,
             :radius, :stroke_weight, :stroke_align, :strokes_hex,
             :fills_hex, :opacity, :constraints, :clips_content, :effects, :props)
    """, rows)
    conn.commit()

    total = len(rows)

    # 写入 mg_meta
    platform = args.platform.strip().lower()
    conn.execute(
        "INSERT OR REPLACE INTO mg_meta (file_id, page_id, key, value) VALUES (?, ?, 'platform', ?)",
        (args.file_id, args.page_id, platform)
    )
    conn.commit()

    print(f"✅ 导入完成：{total} 个节点 → {args.db}")
    platform_hint = "（C端，输出将自动转为 375pt）" if platform == "c" else ""
    print(f"   file_id={args.file_id}  page_id={args.page_id}  page_name={args.page_name or '(未设置)'}  platform={platform or '(未指定)'}{platform_hint}")
    
    # 如果使用了目录模式，生成索引文件
    if output_dir:
        index_path = output_dir / "index.md"
        root_id = data.get("id", "unknown")
        
        index_content = f"""# MasterGo 导出索引

## 基本信息

- **导出时间**：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
- **文件 ID**：{args.file_id}
- **页面 ID**：{args.page_id}
- **页面名称**：{args.page_name or "(未设置)"}
- **根节点 ID**：{root_id}
- **节点总数**：{total}

## 目录结构

```
{output_dir.name}/
├── index.md          # 本索引文件
├── images/           # 导出的图片资源
│   └── (将 PNG 截图放在这里)
└── data/             # 数据文件
    ├── mastergo.db   # SQLite 数据库（精确属性查询 + 实时生成节点树）
    └── mg_tree_*.md  # 节点树快照（mg_query tree 实时生成，此文件仅供备份）
```

## 快速查询

```bash
# 查看节点树
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py \\
    --db "{args.db}" tree

# 统计信息
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py \\
    --db "{args.db}" stats

# 全文搜索
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py \\
    --db "{args.db}" search "关键词"

# 查找特定类型节点
python3 ~/.catpaw/skills/skills-market/mastergo-extractor/mg_query.py \\
    --db "{args.db}" find --type TEXT --min-font-size 16
```

## 文件位置

- **数据库**：`{args.db}`
- **节点树**：`{args.tree_out}`（结构导航，或用 mg_query tree 实时生成）
"""
        
        with open(index_path, "w", encoding="utf-8") as f:
            f.write(index_content)
        print(f"📋 索引文件 → {index_path}")

    # 生成缩略节点树
    if not args.no_tree:
        root_id = data.get("id", "unknown")
        tree_md = generate_tree_md(rows, args.file_id, args.page_id, args.page_name, root_id)

        if args.tree_out:
            tree_path = args.tree_out
        else:
            db_dir = os.path.dirname(os.path.abspath(args.db))
            safe_page = re.sub(r'[^\w\-]', '_', args.page_id)
            safe_file = args.file_id[:12]
            tree_path = os.path.join(db_dir, f"mg_tree_{safe_file}_{safe_page}.md")

        with open(tree_path, "w", encoding="utf-8") as f:
            f.write(tree_md)
        print(f"🌲 缩略节点树 → {tree_path}")

    conn.close()


if __name__ == "__main__":
    main()
