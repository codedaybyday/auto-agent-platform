# 为什么不统计 spec_use_delete_line 和 spec_total_delete_line

## 背景

在设计 Spec Commit 指标时，曾尝试统计以下两个删除相关指标：

- `spec_total_delete_line`：spec commit diff 中删除的总行数
- `spec_use_delete_line`：spec commit 删除的行中，在最终代码（HEAD）中仍然不存在的行数（即"有效删除"）

经过深入分析，这两个指标均存在根本性的设计缺陷，因此暂不统计。

---

## spec_total_delete_line

从每个 spec commit 的 `git diff commit^..commit` 中，统计 `-` 开头的非空行数，**已正常统计和上报**。

表示 spec commit 在那次提交中替换掉（删除掉）的旧代码行数。

---

## spec_use_delete_line 为什么不统计

### 语义定义

> spec commit 删除的那些行，在最终代码（HEAD）中仍然不存在的行数。
>
> 示例：spec commit 删了文件A 10行、文件B 5行，后续人工 commit 恢复了文件A 10行，
> 则 `spec_use_delete_line = 5`（只有文件B的5行最终有效删除）。

### 根本问题：Git 不记录"删除归属"

Git 的数据模型是**快照**，不是操作历史。`git blame` 只能告诉你"这行现在归属于哪个 commit"，对于**已经被删除的行**，完全无法查询。

要知道"某行是被哪个 commit 删除的"，必须逐 commit 遍历整个历史做 diff 分析，代价极高且在行内容相同时仍有歧义。

### 能否用行内容匹配来计算？

看起来可以类比 `aiDel` 的行内容匹配方案：

- `aiDel`：构建 `aiLineIndex`（AI 写过的行内容），在 diff 删除行里查匹配 → 可行
- `spec_use_delete_line`：构建 `specDeletedIndex`（spec 删掉的行内容），看这些行是否在 HEAD 中重新出现

但两者有本质区别：

| 指标 | 判断方向 | 是否有歧义 |
|------|---------|-----------|
| `aiDel` | "AI 写过这行" + "这行现在被删了" → 两件独立的事，内容匹配合理 | 低（行内容碰撞概率相对低） |
| `spec_use_delete_line` | "spec 删掉的行，有没有被后续恢复" → 本质是查 HEAD 当前状态 | **高（无法解决）** |

以具体场景为例：

```
spec commit 删了 3 行 "return null;"
HEAD 中文件现有 2 行 "return null;"（来源不明）

有效删除 = ?
```

- 可能是原来有 5 行，spec 删了 3 行，HEAD 还剩 2 行 → 有效删除 = 3
- 可能是原来有 3 行，spec 删了 3 行，但后来人工又新增了 2 行 → 有效删除 = 1
- 两种情况行内容完全相同，无法区分

### 结论

`spec_use_delete_line` 在技术上无法精确计算，行内容匹配方案与直接比对 HEAD 文件内容等价，均存在不可解的歧义。暂不统计。

---

## 当前统计的指标

| 指标 | 说明 | 可靠性 |
|------|------|--------|
| `spec_total_add_line` | spec commit diff 中新增的总行数 | ✅ 精确 |
| `spec_total_delete_line` | spec commit diff 中删除的总行数 | ✅ 精确 |
| `spec_use_add_line` | HEAD 中仍然归属于 spec commit 的行数（via git blame） | ✅ 精确 |
| `spec_use_delete_line` | **暂不统计**，原因见上文 | ❌ 无法精确计算 |
