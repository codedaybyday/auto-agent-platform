#!/usr/bin/env python3
"""
format_pr.py — 根据诊断数据和 Patch 信息生成格式化的 PR Markdown 文档

用法：
    python format_pr.py <session_json> [--diff <diff_file>] [--output <output_file>]

输入 JSON 格式（session_json）：
    {
      "skill_name": "prd-generator",
      "skill_path": "~/.catpaw/skills/prd-generator/SKILL.md",
      "trigger_reason": "PRD 评审被打回 3 次",
      "cases": [...],          // 见 case-schema.md
      "diagnoses": [...],      // 见下方 diagnosis schema
      "patches": [...]         // 见下方 patch schema
    }

示例：
    python format_pr.py session.json --diff diff.txt --output pr-20260411.md
"""

import argparse
import json
import os
import sys
from datetime import datetime


# ─── Schema helpers ──────────────────────────────────────────────────────────

ROOT_CAUSE_NAMES = {
    "A": "知识缺失（Knowledge Gap）",
    "B": "流程错误（Process Error）",
    "C": "工具使用问题（Tool Usage Error）",
    "D": "格式/规范问题（Format/Convention Error）",
}

SEVERITY_LABELS = {
    "critical": "🔴 critical",
    "major": "🟡 major",
    "minor": "🟢 minor",
}

SOURCE_LABELS = {
    "prd_review": "PRD 评审",
    "tech_review": "技术方案评审",
    "code_review": "代码评审",
    "test_report": "测试报告",
    "error_log": "错误日志",
    "manual_feedback": "人工反馈",
}


# ─── Section generators ───────────────────────────────────────────────────────

def gen_header(data: dict, timestamp: str) -> str:
    skill_name = data.get("skill_name", "unknown-skill")
    trigger_reason = data.get("trigger_reason", "（未指定）")
    patches = data.get("patches", [])
    cases = data.get("cases", [])

    severities = [c.get("severity", "minor") for c in cases]
    impact = "重大" if "critical" in severities else ("中等" if "major" in severities else "轻微")

    return f"""# PR: {skill_name} — 基于失败案例的 Skill 修复

**创建时间**: {timestamp}
**修改的 Skill**: `{skill_name}`
**Skill 路径**: `{data.get('skill_path', f'~/.catpaw/skills/{skill_name}/SKILL.md')}`
**触发原因**: {trigger_reason}
**Patch 数量**: {len(patches)} 个
**影响范围**: {impact}

---
"""


def gen_background(data: dict) -> str:
    background = data.get("background", "")
    if not background:
        skill_name = data.get("skill_name", "该 skill")
        cases = data.get("cases", [])
        trigger_reason = data.get("trigger_reason", "失败案例")
        background = (
            f"收到来自 {trigger_reason} 的 {len(cases)} 个失败案例，"
            f"涉及 `{skill_name}` skill 的输出质量问题。"
            f"以下修改旨在通过精准补丁修复已识别的根因，避免类似问题再次发生。"
        )

    return f"""## 背景

{background}

---
"""


def gen_cases_summary(cases: list) -> str:
    if not cases:
        return ""

    rows = []
    for c in cases:
        case_id = c.get("case_id", "—")
        source = SOURCE_LABELS.get(c.get("source_type", ""), c.get("source_type", "—"))
        root_cause = c.get("root_cause_type", "—")
        root_cause_label = f"{root_cause}（{ROOT_CAUSE_NAMES.get(root_cause, '未知')}）" if root_cause != "—" else "—"
        severity = SEVERITY_LABELS.get(c.get("severity", "minor"), c.get("severity", "—"))
        description = c.get("description", "—")
        rows.append(f"| {case_id} | {source} | {root_cause_label} | {severity} | {description} |")

    table = "\n".join(rows)
    return f"""## 失败案例摘要

| 案例 ID | 来源 | 根因类型 | 严重程度 | 描述 |
|--------|------|---------|---------|------|
{table}

---
"""


def gen_diagnosis(diagnoses: list, cases: list) -> str:
    if not diagnoses:
        return ""

    # 建立 case_id -> case 的映射
    case_map = {c.get("case_id"): c for c in cases}

    sections = []
    for d in diagnoses:
        case_id = d.get("case_id", "—")
        root_cause_type = d.get("root_cause_type", "—")
        root_cause_name = ROOT_CAUSE_NAMES.get(root_cause_type, "未知")
        analysis = d.get("analysis", "（未提供分析）")
        fix_direction = d.get("fix_direction", "（未提供修复方向）")

        # 从 case 中获取评审意见
        case = case_map.get(case_id, {})
        reviewer_comment = case.get("reviewer_comment", "")
        evidence_section = f'\n**证据**: 评审意见原话："{reviewer_comment}"\n' if reviewer_comment else ""

        description = case.get("description", d.get("description", "—"))

        sections.append(f"""### {case_id}：{description}

**根因类型**: {root_cause_type} — {root_cause_name}

**分析**: {analysis}
{evidence_section}
**修复方向**: {fix_direction}
""")

    return "## 根因分析\n\n" + "\n".join(sections) + "---\n"


def gen_patches(patches: list) -> str:
    if not patches:
        return ""

    sections = []
    for i, p in enumerate(patches, 1):
        patch_id = p.get("patch_id", f"patch-{i:03d}")
        title = p.get("title", "（未命名）")
        case_id = p.get("case_id", "—")
        root_cause_type = p.get("root_cause_type", "—")
        root_cause_name = ROOT_CAUSE_NAMES.get(root_cause_type, "未知")
        location = p.get("location", "（未指定）")
        change_type = p.get("change_type", "修改内容")
        before = p.get("before", "（未提供）")
        after = p.get("after", "（未提供）")
        reason = p.get("reason", "（未提供）")

        sections.append(f"""### Patch {i}: {patch_id} — {title}

**修复的根因**: {case_id} — 类型 {root_cause_type}（{root_cause_name}）
**修改位置**: {location}
**修改类型**: {change_type}

**修改前**:
```
{before}
```

**修改后**:
```
{after}
```

**修改原因**: {reason}

---
""")

    return "## 修改内容\n\n" + "\n".join(sections)


def gen_expected_effects(data: dict) -> str:
    effects = data.get("expected_effects", [])
    if not effects:
        return ""

    items = "\n".join(f"{i+1}. {e}" for i, e in enumerate(effects))
    return f"""## 预期效果

修改后，AI 在类似场景下应该：

{items}

---
"""


def gen_validation(data: dict) -> str:
    suggestions = data.get("validation_suggestions", [])
    if not suggestions:
        return ""

    items = "\n".join(f"{i+1}. {s}" for i, s in enumerate(suggestions))
    return f"""## 验证建议

建议用以下测试用例验证修改效果：

{items}

---
"""


def gen_risk(data: dict) -> str:
    risk = data.get("risk_assessment", "低风险。本次修改为精准补丁，未删除或修改原有核心逻辑。")
    return f"""## 风险评估

{risk}

---
"""


def gen_diff_section(diff_content: str) -> str:
    if not diff_content:
        return ""

    return f"""## 完整 Diff

```diff
{diff_content.strip()}
```
"""


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="根据诊断数据生成格式化的 PR Markdown 文档"
    )
    parser.add_argument("session_json", help="包含诊断和 Patch 信息的 JSON 文件")
    parser.add_argument("--diff", "-d", help="diff 文件路径（可选）")
    parser.add_argument("--output", "-o", help="输出文件路径（默认输出到 stdout）")
    args = parser.parse_args()

    # 读取 session JSON
    try:
        with open(args.session_json, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"错误：文件不存在：{args.session_json}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"错误：JSON 解析失败：{e}", file=sys.stderr)
        sys.exit(1)

    # 读取 diff（可选）
    diff_content = ""
    if args.diff:
        try:
            with open(args.diff, "r", encoding="utf-8") as f:
                diff_content = f.read()
        except FileNotFoundError:
            print(f"警告：diff 文件不存在：{args.diff}，将跳过 diff 章节", file=sys.stderr)

    # 生成时间戳
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")

    # 组装 PR 文档
    cases = data.get("cases", [])
    diagnoses = data.get("diagnoses", [])
    patches = data.get("patches", [])

    pr_content = (
        gen_header(data, timestamp)
        + gen_background(data)
        + gen_cases_summary(cases)
        + gen_diagnosis(diagnoses, cases)
        + gen_patches(patches)
        + gen_expected_effects(data)
        + gen_validation(data)
        + gen_risk(data)
        + gen_diff_section(diff_content)
    )

    # 输出
    if args.output:
        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(pr_content)
        print(f"PR 文档已保存到：{args.output}")
    else:
        print(pr_content)


if __name__ == "__main__":
    main()
