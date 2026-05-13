#!/usr/bin/env python3
"""
mg_query.py — 检索本地 MasterGo SQLite 数据库

用法：
    python3 mg_query.py <命令> [选项]

命令：
    search      全文搜索（name + text）
    find        精确/模糊查询（支持多条件组合）
    node        按 id 获取单个节点（含完整属性）
    children    列出某节点的直接子节点
    subtree     展开某节点的完整子树
    tree        输出缩略节点树（读取导入时生成的 .md 文件）
    flat        输出拍平节点列表（按绝对坐标 y/x 排序，忽略原始层级）
    pages       列出已导入的所有页面
    stats       统计数据库概况

全局选项：
    --db PATH       数据库路径（默认 ~/.catpaw/mastergo.db）
    --output-dir DIR  输出目录（优先从 data/mastergo.db 读取）
    --file-id ID    限定文件 ID
    --page-id ID    限定页面 ID
    --json          输出原始 JSON（默认输出可读表格）
    --limit N       最多返回 N 条（默认 50）
    --scale N       坐标/尺寸缩放比例（默认 auto：自动检测根节点宽度，750pt 设计稿输出 375pt，其余原样输出）
                    也可显式传值覆盖，如 --scale 0.5 / --scale 1

快捷用法（配合 --output-dir）：
    # 使用目录方式（自动定位 data/mastergo.db）
    python3 mg_query.py --output-dir ./mg_export/20250326_001 tree
    python3 mg_query.py --output-dir ./mg_export/20250326_001 stats
    python3 mg_query.py --output-dir ./mg_export/20250326_001 search "登录"
    # 强制不缩放（覆盖 auto 检测）
    python3 mg_query.py --scale 1 --output-dir ./mg_export/20250326_001 node "10:14158"
    # 强制 0.5 缩放
    python3 mg_query.py --scale 0.5 --output-dir ./mg_export/20250326_001 node "10:14158"

find 支持的过滤条件：
    --type              节点类型（TEXT/FRAME/COMPONENT 等）
    --name              名称包含（模糊）
    --text              文字内容包含（模糊）
    --min-font-size     最小字号
    --max-font-size     最大字号
    --layout            布局方向（HORIZONTAL/VERTICAL）
    --fills-hex         填充色 HEX（如 #ff5722）
    --strokes-hex       描边颜色 HEX
    --has-stroke        只返回有描边的节点
    --has-radius        只返回有圆角的节点
    --has-padding       只返回有 padding 的节点
    --has-gap           只返回有 gap 的节点
    --has-effects       只返回有阴影/模糊的节点
    --min-gap / --max-gap       gap 范围
    --min-radius / --max-radius 圆角范围（仅对统一圆角有效）
    --depth             精确层级深度
    --max-depth         最大层级深度

示例：
    # 全文搜索"登录"
    python3 mg_query.py search 登录

    # 找所有 TEXT 节点，字号 >= 24
    python3 mg_query.py find --type TEXT --min-font-size 24

    # 找有描边的节点
    python3 mg_query.py find --has-stroke

    # 找圆角 >= 8 的 FRAME
    python3 mg_query.py find --type FRAME --min-radius 8

    # 找有 padding 且水平布局的容器
    python3 mg_query.py find --type FRAME --layout HORIZONTAL --has-padding

    # 获取某节点完整属性
    python3 mg_query.py node 75066:33875

    # 展开子树（深度限制 3 层）
    python3 mg_query.py subtree 75066:33875 --max-depth 3

    # 查看缩略节点树
    python3 mg_query.py tree

    # 拍平节点列表（按坐标排序，适合结合截图推理布局）
    python3 mg_query.py flat
    python3 mg_query.py flat --type FRAME --min-w 100            # 只看宽度 >= 100 的 FRAME
    python3 mg_query.py flat --root 75066:33875                   # 只看某节点下的所有后代
    python3 mg_query.py flat --bbox 0,0,375,812                   # 只看落在坐标范围内的节点（相对坐标，375pt 体系）
    python3 mg_query.py flat --bbox 0,0,375,812 --bbox-mode contains  # 只取完全在范围内的节点
    python3 mg_query.py flat --relative-to 75066:33875            # 相对于指定节点的坐标（默认相对页面根节点）
    python3 mg_query.py flat --absolute                           # 输出画布绝对坐标

    # 列出所有已导入页面
    python3 mg_query.py pages

    # 统计概况
    python3 mg_query.py stats
"""

import sys
import json
import sqlite3
import argparse
import os
import re
from pathlib import Path

# 复用 mg_import 的树生成逻辑
_skill_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _skill_dir)
from mg_import import build_tree_line, generate_tree_md


DEFAULT_DB = str(Path.home() / ".catpaw" / "mastergo.db")


# ── 工具函数 ─────────────────────────────────────────────────────────────────

def get_conn(db_path):
    if not os.path.exists(db_path):
        print(f"❌ 数据库不存在：{db_path}", file=sys.stderr)
        print("   请先用 mg_import.py 导入数据", file=sys.stderr)
        sys.exit(1)
    return sqlite3.connect(db_path)


def row_to_dict(cursor, row):
    return {col[0]: val for col, val in zip(cursor.description, row)}


def print_table(rows, fields=None):
    """简单表格输出"""
    if not rows:
        print("（无结果）")
        return
    if fields is None:
        fields = list(rows[0].keys())
    widths = {f: max(len(f), max((len(str(r.get(f) or "")) for r in rows), default=0)) for f in fields}
    widths = {f: min(w, 60) for f, w in widths.items()}
    header = "  ".join(f.ljust(widths[f]) for f in fields)
    sep    = "  ".join("-" * widths[f] for f in fields)
    print(header)
    print(sep)
    for r in rows:
        line = "  ".join(str(r.get(f) or "").replace("\n", "↵")[:widths[f]].ljust(widths[f]) for f in fields)
        print(line)
    print(f"\n共 {len(rows)} 条")


def build_scope_clause(args):
    """生成 file_id / page_id 过滤子句"""
    clauses, params = [], []
    if getattr(args, "file_id", None):
        clauses.append("file_id = ?")
        params.append(args.file_id)
    if getattr(args, "page_id", None):
        clauses.append("page_id = ?")
        params.append(args.page_id)
    return clauses, params


def fmt_val(v):
    """格式化数值：整数去掉小数点"""
    if v is None:
        return None
    if isinstance(v, float) and v == int(v):
        return int(v)
    return v


def resolve_scale(conn, args, file_id=None, page_id=None):
    """
    解析 --scale 参数：
      - 显式传数值 → 直接使用，跳过自动检测
      - "auto"（默认）→ 读 mg_meta 表的 platform 字段：
          platform = 'c' → 0.5（C端750pt设计稿，输出375pt）
          其他 / 未设置  → 1.0（保留原始值）
    """
    raw = getattr(args, "scale", "auto")
    if raw != "auto":
        return float(raw)

    # auto 模式：读 mg_meta 表
    try:
        clauses = ["key = 'platform'"]
        params = []
        if file_id:
            clauses.append("file_id = ?")
            params.append(file_id)
        if page_id:
            clauses.append("page_id = ?")
            params.append(page_id)
        where = "WHERE " + " AND ".join(clauses)
        cur = conn.execute(
            f"SELECT value FROM mg_meta {where} LIMIT 1",
            params
        )
        row = cur.fetchone()
        if row and row[0] and row[0].strip().lower() == "c":
            return 0.5
    except Exception:
        pass
    return 1.0


def sc(v, scale):
    """对坐标/尺寸数值应用缩放比例，None 或非数值原样返回"""
    if v is None:
        return None
    if not isinstance(v, (int, float)):
        return v  # Symbol(mg.mixed) 等非数值字符串原样返回
    result = v * scale
    if isinstance(result, float) and result == int(result):
        return int(result)
    return round(result, 1)


def scale_row(row, scale, keys):
    """对 row 中指定的 keys 应用缩放，返回新 dict"""
    if scale == 1.0:
        return row
    r = dict(row)
    for k in keys:
        if k in r:
            r[k] = sc(r[k], scale)
    return r


SIZE_KEYS = ("w", "h", "x", "y",
             "font_size", "line_height", "letter_spacing",
             "padding_t", "padding_r", "padding_b", "padding_l",
             "gap", "cross_gap", "stroke_weight", "radius")


# ── 命令实现 ─────────────────────────────────────────────────────────────────

def cmd_pages(conn, args):
    cur = conn.execute("""
        SELECT file_id, page_id, page_name,
               COUNT(*) AS node_count,
               SUM(CASE WHEN type='TEXT' THEN 1 ELSE 0 END) AS text_count
        FROM mg_nodes
        GROUP BY file_id, page_id, page_name
        ORDER BY file_id, page_id
    """)
    rows = [row_to_dict(cur, r) for r in cur.fetchall()]
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    else:
        print_table(rows, ["file_id", "page_id", "page_name", "node_count", "text_count"])


def cmd_stats(conn, args):
    clauses, params = build_scope_clause(args)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    cur = conn.execute(f"""
        SELECT
            COUNT(*) AS total_nodes,
            COUNT(DISTINCT type) AS type_count,
            COUNT(CASE WHEN type='TEXT' THEN 1 END) AS text_nodes,
            COUNT(CASE WHEN text IS NOT NULL THEN 1 END) AS has_text,
            MAX(depth) AS max_depth,
            COUNT(DISTINCT file_id || '|' || page_id) AS pages
        FROM mg_nodes {where}
    """, params)
    row = row_to_dict(cur, cur.fetchone())

    cur2 = conn.execute(f"""
        SELECT type, COUNT(*) AS cnt
        FROM mg_nodes {where}
        GROUP BY type ORDER BY cnt DESC
    """, params)
    types = [row_to_dict(cur2, r) for r in cur2.fetchall()]

    if args.json:
        print(json.dumps({"summary": row, "types": types}, ensure_ascii=False, indent=2))
    else:
        print("=== 概况 ===")
        for k, v in row.items():
            print(f"  {k}: {v}")
        print("\n=== 节点类型分布 ===")
        print_table(types, ["type", "cnt"])


def cmd_search(conn, args):
    """FTS5 全文搜索 name + text"""
    query = args.query
    scale = resolve_scale(conn, args,
                          file_id=getattr(args, "file_id", None),
                          page_id=getattr(args, "page_id", None))
    clauses, params = build_scope_clause(args)

    fts_where = "mg_fts MATCH ?"
    fts_params = [query]

    scope_join = ""
    if clauses:
        scope_join = "AND " + " AND ".join(f"n.{c}" for c in clauses)

    sql = f"""
        SELECT n.id, n.file_id, n.page_id, n.depth, n.type, n.name, n.text,
               n.w, n.h, n.font_size, n.fills_hex
        FROM mg_nodes n
        JOIN mg_fts f ON f.rowid = n.rowid
        WHERE {fts_where}
        {scope_join}
        LIMIT ?
    """
    cur = conn.execute(sql, fts_params + params + [args.limit])
    rows = [scale_row(row_to_dict(cur, r), scale, SIZE_KEYS) for r in cur.fetchall()]

    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    else:
        print(f'🔍 全文搜索："{query}"')
        print_table(rows, ["id", "type", "depth", "name", "text", "w", "h", "font_size", "fills_hex"])


def cmd_find(conn, args):
    """多条件精确/模糊查询"""
    clauses, params = build_scope_clause(args)

    if args.type:
        clauses.append("type = ?")
        params.append(args.type.upper())
    if args.name:
        clauses.append("name LIKE ?")
        params.append(f"%{args.name}%")
    if args.text:
        clauses.append("text LIKE ?")
        params.append(f"%{args.text}%")
    # 文字样式
    if args.min_font_size is not None:
        clauses.append("font_size >= ?")
        params.append(args.min_font_size)
    if args.max_font_size is not None:
        clauses.append("font_size <= ?")
        params.append(args.max_font_size)
    # 布局
    if args.layout:
        clauses.append("layout = ?")
        params.append(args.layout.upper())
    # 填充 & 描边
    if args.fills_hex:
        clauses.append("fills_hex = ?")
        params.append(args.fills_hex.lower())
    if args.strokes_hex:
        clauses.append("strokes_hex = ?")
        params.append(args.strokes_hex.lower())
    if args.has_stroke:
        clauses.append("stroke_weight IS NOT NULL AND stroke_weight > 0")
    # 圆角
    if args.has_radius:
        clauses.append("radius IS NOT NULL")
    if args.min_radius is not None:
        # 只对纯数字圆角有效（四角不同的是 JSON，跳过）
        clauses.append("CAST(radius AS REAL) >= ? AND radius NOT LIKE '{%'")
        params.append(args.min_radius)
    if args.max_radius is not None:
        clauses.append("CAST(radius AS REAL) <= ? AND radius NOT LIKE '{%'")
        params.append(args.max_radius)
    # padding
    if args.has_padding:
        clauses.append("(padding_t IS NOT NULL OR padding_r IS NOT NULL OR padding_b IS NOT NULL OR padding_l IS NOT NULL)")
    # gap
    if args.has_gap:
        clauses.append("gap IS NOT NULL AND gap > 0")
    if args.min_gap is not None:
        clauses.append("gap >= ?")
        params.append(args.min_gap)
    if args.max_gap is not None:
        clauses.append("gap <= ?")
        params.append(args.max_gap)
    # effects
    if args.has_effects:
        clauses.append("effects IS NOT NULL")
    # 深度
    if args.depth is not None:
        clauses.append("depth = ?")
        params.append(args.depth)
    if args.max_depth is not None:
        clauses.append("depth <= ?")
        params.append(args.max_depth)

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    sql = f"""
        SELECT id, type, depth, name, text,
               w, h, font_size, fills_hex, strokes_hex, stroke_weight,
               radius, padding_t, padding_r, padding_b, padding_l, gap, layout
        FROM mg_nodes
        {where}
        ORDER BY depth, y, x
        LIMIT ?
    """
    scale = resolve_scale(conn, args,
                          file_id=getattr(args, "file_id", None),
                          page_id=getattr(args, "page_id", None))
    cur = conn.execute(sql, params + [args.limit])
    rows = [scale_row(row_to_dict(cur, r), scale, SIZE_KEYS) for r in cur.fetchall()]

    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    else:
        print_table(rows, ["id", "type", "depth", "name", "text", "w", "h",
                            "font_size", "fills_hex", "strokes_hex", "stroke_weight",
                            "radius", "gap", "layout"])


def cmd_node(conn, args):
    """获取单个节点完整属性"""
    scale = resolve_scale(conn, args,
                          file_id=getattr(args, "file_id", None),
                          page_id=getattr(args, "page_id", None))
    clauses = ["id = ?"]
    params  = [args.node_id]
    scope_clauses, scope_params = build_scope_clause(args)
    clauses.extend(scope_clauses)
    params.extend(scope_params)

    where = "WHERE " + " AND ".join(clauses)
    cur = conn.execute(f"SELECT * FROM mg_nodes {where} LIMIT 1", params)
    row = cur.fetchone()
    if not row:
        print(f"❌ 节点不存在：{args.node_id}")
        return
    d = scale_row(row_to_dict(cur, row), scale, SIZE_KEYS)

    # 展开 JSON 字段
    for field in ("props", "constraints", "effects"):
        if d.get(field):
            try:
                d[field] = json.loads(d[field])
            except Exception:
                pass

    pt_label = "pt" if scale != 1.0 else "px(原始)"
    if args.json:
        print(json.dumps(d, ensure_ascii=False, indent=2))
    else:
        print(f"=== 节点：{d['id']} （坐标/尺寸单位：{pt_label}，scale={scale}）===")
        # 分组输出，更易读
        groups = [
            ("基本", ["id", "file_id", "page_id", "page_name", "parent_id", "depth", "name", "type"]),
            ("尺寸位置", ["w", "h", "x", "y"]),
            ("文字样式", ["text", "font_size", "font_weight", "font_family", "line_height", "letter_spacing", "text_align"]),
            ("布局", ["layout", "layout_wrap", "main_align", "cross_align", "sizing_h", "sizing_v"]),
            ("盒模型", ["padding_t", "padding_r", "padding_b", "padding_l", "gap", "cross_gap"]),
            ("外观", ["fills_hex", "radius", "stroke_weight", "stroke_align", "strokes_hex", "opacity", "clips_content"]),
            ("其他", ["constraints", "effects", "props"]),
        ]
        for group_name, keys in groups:
            group_vals = {k: d[k] for k in keys if k in d and d[k] is not None and d[k] != ""}
            if group_vals:
                print(f"\n  [{group_name}]")
                for k, v in group_vals.items():
                    if isinstance(v, dict):
                        print(f"    {k}:")
                        for kk, vv in v.items():
                            print(f"      {kk}: {vv}")
                    else:
                        print(f"    {k}: {v}")


def cmd_children(conn, args):
    """列出某节点的直接子节点"""
    scale = resolve_scale(conn, args,
                          file_id=getattr(args, "file_id", None),
                          page_id=getattr(args, "page_id", None))
    clauses = ["parent_id = ?"]
    params  = [args.node_id]
    scope_clauses, scope_params = build_scope_clause(args)
    clauses.extend(scope_clauses)
    params.extend(scope_params)

    where = "WHERE " + " AND ".join(clauses)
    # GROUP 的子节点 x/y 是相对坐标，不能用坐标排序；改用 rowid 保留原始插入顺序
    parent_type = None
    if args.node_id:
        pt_cur = conn.execute("SELECT type FROM mg_nodes WHERE id = ? LIMIT 1", [args.node_id])
        pt_row = pt_cur.fetchone()
        if pt_row:
            parent_type = pt_row[0]
    order_by = "rowid" if parent_type == "GROUP" else "y, x"

    cur = conn.execute(f"""
        SELECT id, depth, type, name, text, w, h, x, y,
               font_size, fills_hex, strokes_hex, stroke_weight,
               radius, padding_t, padding_r, padding_b, padding_l, gap, layout
        FROM mg_nodes {where}
        ORDER BY {order_by}
        LIMIT ?
    """, params + [args.limit])
    rows = [scale_row(row_to_dict(cur, r), scale, SIZE_KEYS) for r in cur.fetchall()]

    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    else:
        print(f"📂 {args.node_id} 的直接子节点（{len(rows)} 个）")
        print_table(rows, ["id", "type", "name", "text", "w", "h", "x", "y",
                            "font_size", "fills_hex", "stroke_weight", "radius", "gap"])


def cmd_subtree(conn, args):
    """展开某节点的完整子树（WITH RECURSIVE）"""
    scope_clauses, scope_params = build_scope_clause(args)
    scope_where = (" AND " + " AND ".join(scope_clauses)) if scope_clauses else ""

    root_cur = conn.execute(
        f"SELECT depth FROM mg_nodes WHERE id = ? {scope_where} LIMIT 1",
        [args.node_id] + scope_params
    )
    root_row = root_cur.fetchone()
    if not root_row:
        print(f"❌ 节点不存在：{args.node_id}")
        return
    root_depth = root_row[0]

    max_depth_clause = f"AND n.depth <= {root_depth + args.max_depth}" if args.max_depth is not None else ""

    sql = f"""
        WITH RECURSIVE tree AS (
            SELECT id, file_id, page_id, parent_id, depth, type, name, text,
                   w, h, x, y, font_size, fills_hex, strokes_hex, stroke_weight,
                   radius, padding_t, padding_r, padding_b, padding_l, gap, layout
            FROM mg_nodes
            WHERE id = ? {scope_where}
            UNION ALL
            SELECT n.id, n.file_id, n.page_id, n.parent_id, n.depth, n.type, n.name, n.text,
                   n.w, n.h, n.x, n.y, n.font_size, n.fills_hex, n.strokes_hex, n.stroke_weight,
                   n.radius, n.padding_t, n.padding_r, n.padding_b, n.padding_l, n.gap, n.layout
            FROM mg_nodes n
            JOIN tree t ON n.parent_id = t.id AND n.file_id = t.file_id AND n.page_id = t.page_id
            {max_depth_clause}
        )
        SELECT * FROM tree ORDER BY depth, rowid
        LIMIT ?
    """
    scale = resolve_scale(conn, args,
                          file_id=getattr(args, "file_id", None),
                          page_id=getattr(args, "page_id", None))
    cur = conn.execute(sql, [args.node_id] + scope_params + [args.limit])
    rows = [scale_row(row_to_dict(cur, r), scale, SIZE_KEYS) for r in cur.fetchall()]

    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    else:
        depth_label = f"（最多 {args.max_depth} 层）" if args.max_depth is not None else ""
        print(f"🌲 {args.node_id} 的子树{depth_label}（{len(rows)} 个节点）")
        for r in rows:
            indent = "  " * (r["depth"] - rows[0]["depth"])
            text_hint = f'  "{r["text"][:30]}"' if r.get("text") else ""
            size_hint = f"  {fmt_val(r['w'])}×{fmt_val(r['h'])}" if r.get("w") else ""
            # 追加关键样式
            style_hints = []
            if r.get("font_size"):
                style_hints.append(f"fs:{fmt_val(r['font_size'])}")
            if r.get("fills_hex"):
                style_hints.append(r["fills_hex"])
            if r.get("stroke_weight"):
                style_hints.append(f"border:{fmt_val(r['stroke_weight'])}")
            if r.get("radius"):
                style_hints.append(f"r:{r['radius']}")
            if r.get("gap"):
                style_hints.append(f"gap:{fmt_val(r['gap'])}")
            style_str = "  " + " ".join(style_hints) if style_hints else ""
            print(f"{indent}[{r['type']}] {r['name']}{text_hint}{size_hint}{style_str}")


def _build_abs_coords(conn, file_id, page_id):
    """
    计算页面内所有节点的画布绝对坐标。
    数据库存的 x/y 是相对父节点的偏移，需递归累加得到绝对坐标。
    返回 dict: id -> (abs_x, abs_y)
    """
    cur = conn.execute(
        "SELECT id, parent_id, x, y FROM mg_nodes WHERE file_id=? AND page_id=? ORDER BY depth, rowid",
        [file_id, page_id]
    )
    rows = cur.fetchall()
    abs_map = {}  # id -> (abs_x, abs_y)
    for node_id, parent_id, x, y in rows:
        px, py = abs_map.get(parent_id, (0.0, 0.0))
        abs_map[node_id] = ((x or 0.0) + px, (y or 0.0) + py)
    return abs_map


def cmd_flat(conn, args):
    """拍平节点列表：按画布绝对坐标 y/x 排序，忽略原始层级，适合结合截图推理布局关系"""
    scope_clauses, scope_params = build_scope_clause(args)

    # 若未指定 file_id/page_id，自动取最近一次导入的页面
    if not scope_clauses:
        cur = conn.execute("""
            SELECT file_id, page_id FROM mg_nodes
            GROUP BY file_id, page_id ORDER BY rowid DESC LIMIT 1
        """)
        row = cur.fetchone()
        if not row:
            print("❌ 数据库为空，请先用 mg_import.py 导入数据")
            return
        scope_clauses = ["file_id = ?", "page_id = ?"]
        scope_params = list(row)

    # 取实际的 file_id/page_id
    meta_cur = conn.execute(
        f"SELECT file_id, page_id FROM mg_nodes WHERE {' AND '.join(scope_clauses)} LIMIT 1",
        scope_params
    )
    meta = meta_cur.fetchone()
    if not meta:
        print("❌ 未找到匹配节点")
        return
    file_id, page_id = meta

    # 计算所有节点的画布绝对坐标
    abs_map = _build_abs_coords(conn, file_id, page_id)

    # 取所有节点基础数据
    base_clauses = ["file_id = ?", "page_id = ?"]
    base_params  = [file_id, page_id]

    # --root：只取某节点的所有后代（含自身）
    if getattr(args, "root", None):
        subtree_sql = """
            WITH RECURSIVE sub AS (
                SELECT id FROM mg_nodes WHERE id = ?
                UNION ALL
                SELECT n.id FROM mg_nodes n JOIN sub s ON n.parent_id = s.id
            )
            SELECT id FROM sub
        """
        sub_ids = [r[0] for r in conn.execute(subtree_sql, [args.root]).fetchall()]
        if not sub_ids:
            print("（无后代节点）")
            return
        placeholders = ",".join("?" * len(sub_ids))
        base_clauses.append(f"id IN ({placeholders})")
        base_params.extend(sub_ids)

    # 类型过滤
    if getattr(args, "type", None):
        base_clauses.append("type = ?")
        base_params.append(args.type.upper())

    # 尺寸过滤（按节点自身 w/h，不受坐标影响）
    if getattr(args, "min_w", None) is not None:
        base_clauses.append("w >= ?")
        base_params.append(args.min_w)
    if getattr(args, "max_w", None) is not None:
        base_clauses.append("w <= ?")
        base_params.append(args.max_w)
    if getattr(args, "min_h", None) is not None:
        base_clauses.append("h >= ?")
        base_params.append(args.min_h)
    if getattr(args, "max_h", None) is not None:
        base_clauses.append("h <= ?")
        base_params.append(args.max_h)

    where = "WHERE " + " AND ".join(base_clauses)
    sql = f"""
        SELECT id, type, name, text,
               ROUND(w,1) AS w, ROUND(h,1) AS h,
               depth, parent_id,
               font_size, fills_hex, radius, gap, layout,
               padding_t, padding_r, padding_b, padding_l
        FROM mg_nodes
        {where}
        LIMIT ?
    """
    cur = conn.execute(sql, base_params + [args.limit * 10])  # 先多取，bbox 过滤后再截断
    rows = [row_to_dict(cur, r) for r in cur.fetchall()]

    # file_id/page_id 在 cmd_flat 中已确定，先取 meta 后再用
    scale = resolve_scale(conn, args,
                          file_id=file_id,
                          page_id=page_id)

    # 注入画布绝对坐标
    for r in rows:
        ax, ay = abs_map.get(r["id"], (0.0, 0.0))
        r["abs_x"] = ax
        r["abs_y"] = ay

    # 确定参考原点（用于相对坐标换算 & bbox 过滤）
    use_absolute = getattr(args, "absolute", False)
    ref_x, ref_y = 0.0, 0.0
    ref_label = "画布绝对坐标"

    if not use_absolute:
        relative_to = getattr(args, "relative_to", None)
        if relative_to:
            ref_abs = abs_map.get(relative_to)
            if ref_abs is None:
                print(f"❌ --relative-to 节点不存在：{relative_to}")
                return
            ref_x, ref_y = ref_abs
            name_cur = conn.execute("SELECT name FROM mg_nodes WHERE id=? LIMIT 1", [relative_to])
            ref_name = (name_cur.fetchone() or ["?"])[0]
            ref_label = f"相对于 {relative_to}({ref_name}) 的坐标"
        else:
            # 默认：相对于 depth 最小的节点（根节点）
            root_cur = conn.execute(
                "SELECT id, name FROM mg_nodes WHERE file_id=? AND page_id=? AND depth=(SELECT MIN(depth) FROM mg_nodes WHERE file_id=? AND page_id=?) ORDER BY rowid LIMIT 1",
                [file_id, page_id, file_id, page_id]
            )
            root_row = root_cur.fetchone()
            if root_row:
                ref_x, ref_y = abs_map.get(root_row[0], (0.0, 0.0))
                ref_label = f"相对于根节点 {root_row[0]}({root_row[1]}) 的坐标"

    # --bbox 过滤：用相对坐标（绝对坐标 - ref）过滤
    # bbox 参数始终以 scale 后的坐标体系输入（即 375pt 体系）
    bbox_filter = None
    if getattr(args, "bbox", None):
        try:
            bx, by, bw, bh = [float(v) for v in args.bbox.split(",")]
        except ValueError:
            print("❌ --bbox 格式错误，应为 x,y,w,h（如 0,0,375,812）")
            return
        bbox_filter = (bx, by, bw, bh, getattr(args, "bbox_mode", "intersects") or "intersects")

    # 计算相对坐标，应用 bbox 过滤，排序
    result = []
    for r in rows:
        # 先在原始坐标系做相对换算，再统一 scale
        rx = round((r["abs_x"] - ref_x) * scale, 1)
        ry = round((r["abs_y"] - ref_y) * scale, 1)
        rw = round((r["w"] or 0.0) * scale, 1)
        rh = round((r["h"] or 0.0) * scale, 1)

        if bbox_filter:
            bx, by, bw, bh, mode = bbox_filter
            if mode == "contains":
                if not (rx >= bx and ry >= by and rx + rw <= bx + bw and ry + rh <= by + bh):
                    continue
            else:  # intersects
                if not (rx + rw > bx and rx < bx + bw and ry + rh > by and ry < by + bh):
                    continue

        r["x"] = rx
        r["y"] = ry
        r["w"] = rw
        r["h"] = rh
        # 其余尺寸字段也 scale
        for k in ("font_size", "line_height", "letter_spacing",
                  "padding_t", "padding_r", "padding_b", "padding_l",
                  "gap", "cross_gap", "stroke_weight", "radius"):
            if r.get(k) is not None:
                r[k] = sc(r[k], scale)
        result.append(r)

    # 按相对坐标 y/x 排序，截断到 limit
    result.sort(key=lambda r: (r["y"], r["x"]))
    result = result[:args.limit]

    if args.json:
        out = [{k: v for k, v in r.items() if k not in ("abs_x", "abs_y")} for r in result]
        print(json.dumps(out, ensure_ascii=False, indent=2))
    else:
        pt_label = "pt" if scale != 1.0 else "px(原始)"
        print(f"📋 拍平节点列表（按 y/x 排序，共 {len(result)} 个节点，{ref_label}，单位：{pt_label}，scale={scale}）")
        print("  格式：[TYPE] id  x,y  w×h  (depth=N)  名称  文字  样式")
        print()
        for r in result:
            pos  = f"{fmt_val(r['x'])},{fmt_val(r['y'])}"
            size = f"{fmt_val(r['w'])}×{fmt_val(r['h'])}"
            text_hint = f'  "{r["text"][:25]}"' if r.get("text") else ""
            style_parts = []
            if r.get("fills_hex"):  style_parts.append(r["fills_hex"])
            if r.get("font_size"): style_parts.append(f"fs:{fmt_val(r['font_size'])}")
            if r.get("radius"):    style_parts.append(f"r:{r['radius']}")
            if r.get("gap"):       style_parts.append(f"gap:{fmt_val(r['gap'])}")
            if r.get("layout"):    style_parts.append(r["layout"])
            pad_parts = []
            for side, key in [("T","padding_t"),("R","padding_r"),("B","padding_b"),("L","padding_l")]:
                if r.get(key): pad_parts.append(f"{side}:{fmt_val(r[key])}")
            if pad_parts: style_parts.append("pad(" + " ".join(pad_parts) + ")")
            style_str = "  " + " ".join(style_parts) if style_parts else ""
            depth_str = f"(d={r['depth']})"
            print(f"  [{r['type']:10}] {r['id']:20}  {pos:12}  {size:10}  {depth_str:6}  {r['name'][:30]}{text_hint}{style_str}")
        print(f"\n共 {len(result)} 个节点")


def cmd_tree(conn, args):
    """实时从 SQLite 生成缩略节点树（不依赖磁盘 .md 文件）"""
    clauses, params = build_scope_clause(args)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

    # 若未指定 file_id/page_id，自动取最近一次导入的页面
    if not clauses:
        cur = conn.execute("""
            SELECT file_id, page_id, page_name
            FROM mg_nodes
            GROUP BY file_id, page_id
            ORDER BY rowid DESC
            LIMIT 1
        """)
        row = cur.fetchone()
        if not row:
            print("❌ 数据库为空，请先用 mg_import.py 导入数据")
            return
        file_id, page_id, page_name = row
        clauses = ["file_id = ?", "page_id = ?"]
        params = [file_id, page_id]
        where = "WHERE " + " AND ".join(clauses)
    else:
        # 补全 page_name
        cur = conn.execute(
            f"SELECT file_id, page_id, page_name FROM mg_nodes {where} LIMIT 1", params
        )
        row = cur.fetchone()
        if not row:
            print("❌ 未找到匹配节点，请检查 --file-id / --page-id 参数")
            return
        file_id, page_id, page_name = row

    cur = conn.execute(
        f"SELECT * FROM mg_nodes {where} ORDER BY depth, rowid", params
    )
    rows = [dict(zip([c[0] for c in cur.description], r)) for r in cur.fetchall()]

    if not rows:
        print("❌ 无节点数据")
        return

    root_id = rows[0]["id"]
    md = generate_tree_md(rows, file_id, page_id, page_name or "", root_id)
    print(md)


# ── 入口 ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="检索 MasterGo 本地 SQLite 数据库")
    parser.add_argument("--db", default=DEFAULT_DB, help="数据库路径")
    parser.add_argument("--output-dir", help="输出目录（优先从 data/mastergo.db 读取）")
    parser.add_argument("--file-id", help="限定文件 ID")
    parser.add_argument("--page-id", help="限定页面 ID")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    parser.add_argument("--limit", type=int, default=50, help="最多返回条数")
    parser.add_argument("--scale", default="auto",
                        help="坐标/尺寸缩放比例（默认 auto：自动检测根节点宽度；也可显式传 0.5 / 1 覆盖）")

    sub = parser.add_subparsers(dest="cmd", required=True)

    # pages
    sub.add_parser("pages", help="列出已导入的所有页面")

    # stats
    sub.add_parser("stats", help="统计数据库概况")

    # search
    p_search = sub.add_parser("search", help="全文搜索 name + text")
    p_search.add_argument("query", help="搜索关键词")

    # find
    p_find = sub.add_parser("find", help="多条件查询")
    p_find.add_argument("--type", help="节点类型（TEXT/FRAME/COMPONENT 等）")
    p_find.add_argument("--name", help="名称包含（模糊）")
    p_find.add_argument("--text", help="文字内容包含（模糊）")
    p_find.add_argument("--min-font-size", type=float, help="最小字号")
    p_find.add_argument("--max-font-size", type=float, help="最大字号")
    p_find.add_argument("--layout", help="布局方向（HORIZONTAL/VERTICAL）")
    p_find.add_argument("--fills-hex", help="填充色 HEX（如 #ff5722）")
    p_find.add_argument("--strokes-hex", help="描边颜色 HEX")
    p_find.add_argument("--has-stroke", action="store_true", help="只返回有描边的节点")
    p_find.add_argument("--has-radius", action="store_true", help="只返回有圆角的节点")
    p_find.add_argument("--min-radius", type=float, help="最小圆角值")
    p_find.add_argument("--max-radius", type=float, help="最大圆角值")
    p_find.add_argument("--has-padding", action="store_true", help="只返回有 padding 的节点")
    p_find.add_argument("--has-gap", action="store_true", help="只返回有 gap 的节点")
    p_find.add_argument("--min-gap", type=float, help="最小 gap 值")
    p_find.add_argument("--max-gap", type=float, help="最大 gap 值")
    p_find.add_argument("--has-effects", action="store_true", help="只返回有阴影/模糊的节点")
    p_find.add_argument("--depth", type=int, help="精确层级深度")
    p_find.add_argument("--max-depth", type=int, help="最大层级深度")

    # node
    p_node = sub.add_parser("node", help="获取单个节点完整属性")
    p_node.add_argument("node_id", help="节点 ID")

    # children
    p_children = sub.add_parser("children", help="列出直接子节点")
    p_children.add_argument("node_id", help="父节点 ID")

    # subtree
    p_subtree = sub.add_parser("subtree", help="展开完整子树")
    p_subtree.add_argument("node_id", help="根节点 ID")
    p_subtree.add_argument("--max-depth", type=int, help="最大展开层数")

    # flat
    p_flat = sub.add_parser("flat", help="拍平节点列表（按绝对坐标 y/x 排序，忽略原始层级）")
    p_flat.add_argument("--root", help="只取某节点的所有后代（含自身）")
    p_flat.add_argument("--bbox", help="坐标范围过滤，格式 x,y,w,h（相对坐标，如 0,0,375,812）")
    p_flat.add_argument("--bbox-mode", choices=["intersects", "contains"], default="intersects",
                        help="intersects=与范围有重叠（默认），contains=完全在范围内")
    p_flat.add_argument("--relative-to", help="坐标相对于指定节点 id（默认相对页面根节点）")
    p_flat.add_argument("--absolute", action="store_true", help="输出画布绝对坐标（默认输出相对坐标）")
    p_flat.add_argument("--type", help="节点类型过滤（TEXT/FRAME/COMPONENT 等）")
    p_flat.add_argument("--min-w", type=float, help="最小宽度")
    p_flat.add_argument("--max-w", type=float, help="最大宽度")
    p_flat.add_argument("--min-h", type=float, help="最小高度")
    p_flat.add_argument("--max-h", type=float, help="最大高度")

    # tree
    p_tree = sub.add_parser("tree", help="输出缩略节点树（导入时自动生成的 .md）")
    p_tree  # 无额外参数，用全局 --file-id / --page-id 过滤

    args = parser.parse_args()
    
    # 如果指定了 output-dir，优先使用目录中的数据库
    if args.output_dir:
        output_dir = Path(args.output_dir).expanduser().resolve()
        db_in_dir = output_dir / "data" / "mastergo.db"
        if db_in_dir.exists():
            args.db = str(db_in_dir)
        else:
            print(f"⚠️ 警告：目录中未找到数据库 {db_in_dir}，使用默认路径")
    
    conn = get_conn(args.db)

    dispatch = {
        "pages":    cmd_pages,
        "stats":    cmd_stats,
        "search":   cmd_search,
        "find":     cmd_find,
        "node":     cmd_node,
        "children": cmd_children,
        "subtree":  cmd_subtree,
        "tree":     cmd_tree,
        "flat":     cmd_flat,
    }
    dispatch[args.cmd](conn, args)
    conn.close()


if __name__ == "__main__":
    main()
