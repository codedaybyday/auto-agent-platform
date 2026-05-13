#!/usr/bin/env python3
"""
generate_diff.py — 生成 skill SKILL.md 的格式化 diff

用法：
    python generate_diff.py <backup_file> <current_file> [--output <output_file>]

示例：
    python generate_diff.py SKILL.md.bak.20260411_100000 SKILL.md
    python generate_diff.py SKILL.md.bak.20260411_100000 SKILL.md --output diff.txt

输出：
    - 标准 unified diff 格式
    - 统计信息：新增行数、删除行数、修改的章节
"""

import argparse
import difflib
import os
import re
import sys
from datetime import datetime


def read_file(path: str) -> list[str]:
    """读取文件内容，返回行列表"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.readlines()
    except FileNotFoundError:
        print(f"错误：文件不存在：{path}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"错误：无法读取文件 {path}：{e}", file=sys.stderr)
        sys.exit(1)


def generate_unified_diff(
    old_lines: list[str],
    new_lines: list[str],
    old_label: str,
    new_label: str,
    context: int = 3,
) -> list[str]:
    """生成 unified diff"""
    return list(
        difflib.unified_diff(
            old_lines,
            new_lines,
            fromfile=old_label,
            tofile=new_label,
            n=context,
        )
    )


def extract_changed_sections(
    old_lines: list[str], new_lines: list[str]
) -> list[str]:
    """提取发生变化的章节名称（Markdown 标题）"""
    changed_sections = set()
    current_section = "（文件开头）"

    # 找出所有变化的行号
    matcher = difflib.SequenceMatcher(None, old_lines, new_lines)
    changed_old_lines = set()
    changed_new_lines = set()

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag != "equal":
            for i in range(i1, i2):
                changed_old_lines.add(i)
            for j in range(j1, j2):
                changed_new_lines.add(j)

    # 在新文件中找到变化行所在的章节
    for line_num, line in enumerate(new_lines):
        if re.match(r"^#{1,3}\s+", line):
            current_section = line.strip().lstrip("#").strip()
        if line_num in changed_new_lines:
            changed_sections.add(current_section)

    return sorted(changed_sections)


def compute_stats(diff_lines: list[str]) -> dict:
    """统计 diff 的基本信息"""
    added = sum(1 for line in diff_lines if line.startswith("+") and not line.startswith("+++"))
    removed = sum(1 for line in diff_lines if line.startswith("-") and not line.startswith("---"))
    return {
        "added_lines": added,
        "removed_lines": removed,
        "net_change": added - removed,
    }


def format_output(
    diff_lines: list[str],
    stats: dict,
    changed_sections: list[str],
    old_file: str,
    new_file: str,
) -> str:
    """格式化最终输出"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    header = f"""# Skill Diff Report
生成时间: {timestamp}
原始文件: {old_file}
修改文件: {new_file}

## 统计信息
- 新增行数: {stats['added_lines']}
- 删除行数: {stats['removed_lines']}
- 净变化: {'+' if stats['net_change'] >= 0 else ''}{stats['net_change']} 行

## 修改的章节
{chr(10).join(f'- {s}' for s in changed_sections) if changed_sections else '- （无法识别章节）'}

## 完整 Diff

```diff
"""
    footer = "```\n"

    diff_content = "".join(diff_lines)
    if not diff_content:
        diff_content = "（无差异）\n"

    return header + diff_content + footer


def main():
    parser = argparse.ArgumentParser(
        description="生成 skill SKILL.md 的格式化 diff"
    )
    parser.add_argument("backup_file", help="备份文件路径（修改前）")
    parser.add_argument("current_file", help="当前文件路径（修改后）")
    parser.add_argument("--output", "-o", help="输出文件路径（默认输出到 stdout）")
    parser.add_argument(
        "--context", "-c", type=int, default=3, help="diff 上下文行数（默认 3）"
    )
    args = parser.parse_args()

    # 读取文件
    old_lines = read_file(args.backup_file)
    new_lines = read_file(args.current_file)

    # 生成 diff
    diff_lines = generate_unified_diff(
        old_lines,
        new_lines,
        old_label=f"a/{os.path.basename(args.backup_file)}",
        new_label=f"b/{os.path.basename(args.current_file)}",
        context=args.context,
    )

    # 统计信息
    stats = compute_stats(diff_lines)
    changed_sections = extract_changed_sections(old_lines, new_lines)

    # 格式化输出
    output = format_output(
        diff_lines,
        stats,
        changed_sections,
        args.backup_file,
        args.current_file,
    )

    # 写入输出
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output)
        print(f"Diff 已保存到：{args.output}")
        print(f"统计：新增 {stats['added_lines']} 行，删除 {stats['removed_lines']} 行")
        if changed_sections:
            print(f"修改的章节：{', '.join(changed_sections)}")
    else:
        print(output)


if __name__ == "__main__":
    main()