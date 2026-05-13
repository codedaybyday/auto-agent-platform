# 失败案例 JSON Schema

## 单个案例结构

```json
{
  "case_id": "case-001",
  "source_type": "prd_review",
  "description": "PRD 缺少竞品分析章节",
  "context": "AI 被要求生成一份新功能的 PRD 文档",
  "actual_output": "生成了包含背景、需求、验收标准的 PRD，但没有竞品分析",
  "expected_output": "PRD 应包含竞品分析章节，分析至少 3 个竞品的相关功能",
  "reviewer_comment": "这份 PRD 缺少竞品分析，我们公司的 PRD 规范要求必须有这个章节",
  "related_skill": "prd-generator",
  "severity": "major",
  "timestamp": "2026-04-11T10:00:00Z",
  "tags": ["prd", "missing-section", "company-standard"]
}
```

## 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| case_id | string | 是 | 唯一标识，格式：case-NNN |
| source_type | enum | 是 | 见下方枚举值 |
| description | string | 是 | 失败的一句话描述 |
| context | string | 是 | AI 被要求做什么 |
| actual_output | string | 是 | AI 实际产出了什么 |
| expected_output | string | 否 | 应该产出什么（如果已知） |
| reviewer_comment | string | 否 | 评审人/用户的原话 |
| related_skill | string | 否 | 涉及的 skill 名称，null 表示未知 |
| severity | enum | 是 | critical / major / minor |
| timestamp | string | 否 | ISO 8601 格式 |
| tags | array | 否 | 自由标签，便于聚类 |

## source_type 枚举值

| 值 | 说明 |
|----|------|
| prd_review | PRD 评审意见 |
| tech_review | 技术方案评审意见 |
| code_review | 代码评审意见 |
| test_report | 测试报告（自动化或手动） |
| error_log | 运行时错误日志 |
| manual_feedback | 用户直接描述的问题 |

## severity 枚举值

| 值 | 说明 |
|----|------|
| critical | 严重问题，导致产出物完全不可用 |
| major | 重要问题，需要显著修改才能使用 |
| minor | 轻微问题，小改动即可修复 |

## 案例集合结构

```json
{
  "session_id": "evolver-session-20260411",
  "created_at": "2026-04-11T10:00:00Z",
  "cases": [
    { ... },
    { ... }
  ],
  "clusters": [
    {
      "cluster_id": "cluster-001",
      "root_cause_type": "A",
      "description": "PRD 缺少公司规范要求的章节",
      "case_ids": ["case-001", "case-003"]
    }
  ]
}
```

## 根因类型枚举

| 类型 | 名称 | 说明 |
|------|------|------|
| A | Knowledge Gap | 知识缺失：AI 不知道某个领域知识、规范或约束 |
| B | Process Error | 流程错误：AI 执行了错误的步骤顺序，或跳过了必要步骤 |
| C | Tool Usage Error | 工具使用问题：AI 调用了错误的工具，或工具参数不正确 |
| D | Format/Convention Error | 格式/规范问题：输出格式不符合预期，但内容本身是正确的 |