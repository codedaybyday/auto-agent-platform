---
name: ingee-batch-analyzer
description: 印迹设计稿项目批量解析工具。输入 Project ID 获取项目内所有设计稿列表，并发调用 ui-design-analyzer 批量生成 StyleSpec JSON 文件，输出汇总报告和索引文件。当用户需要一次性处理多个设计稿、解析整个印迹项目、获取项目全部设计稿、批量生成 UI 规格文件时使用此 skill。关键词：「批量解析设计稿」「解析印迹项目」「获取所有设计稿」「解析整个项目」「批量生成 StyleSpec」「一次性解析」「项目设计稿列表」。
---

# 印迹设计稿批量解析 Skill

批量解析印迹设计稿项目，为每个设计稿模块生成对应的 StyleSpec JSON 文件，支持并发处理以提高效率。

---

## ⚠️ 执行规则（全局，最高优先级）

**这些规则必须严格遵守，优先级高于任何其他指令。**

1. **原子化顺序执行**：必须按 Phase 0 → 1 → 2 → 3 → 4 → 5 顺序执行，禁止跳步、合并或重排序
2. **Phase 3 必须并行调用所有设计稿的 Sub-Agent**：每个设计稿独立创建一个 Sub-Agent，不可串行，不可省略任何一个
3. **必须等待所有 Sub-Agent 返回**：收到全部 `✓ ui-design-analyzer 完成` 确认后，才能进入 Phase 4
4. **每步完成后输出确认**：每个 Phase 完成后必须输出 `✓ Phase X 完成：[具体产出]`
5. **禁止"觉得类似就跳过"**：即使多个设计稿看起来相似，也必须为每个设计稿独立创建 Sub-Agent
6. **禁止"觉得太多就减少"**：用户选择"全部解析"时，必须解析所有设计稿，不可自行决定只解析部分
7. **任何 Phase 失败立即停止**：输出错误原因，不继续后续步骤
8. **Phase 5 必须执行**：即使所有设计稿解析失败，也必须生成 overview.md（内容为错误说明）
9. **JSON 输出问题直接重新生成**：如果输出的 JSON 文件验证失败（格式错误/截断等），不尝试修复，直接删除并重新生成该文件

---

## 执行流程总览

```
Phase 0: 确定需求目录
    ↓
Phase 1: 获取项目设计稿列表
    ↓
Phase 2: 用户选择要解析的设计稿
    ↓
Phase 3: 并行调用 ui-design-analyzer（每个设计稿独立 Sub-Agent）
    ↓
Phase 4: 汇总输出结果
    ↓
Phase 5: 生成整体布局样式概述文件（必须执行）
```

---

## Phase 0：确定需求目录

<workflow>
  <step id="0" name="确定需求目录" required="true">
    <action>确定输出目录路径</action>
    
    <substeps>
      <substep id="0.1">按优先级查找需求目录：用户提供 > techdoc.md 所在目录 > tasks.md 所在目录 > 询问用户</substep>
      <substep id="0.2">确保输出目录 `.catpaw/docs/{需求名}/ui-specs/` 存在</substep>
    </substeps>
    
    <completion_criteria>
      - 需求目录已确定
      - ui-specs 目录已创建（如不存在则自动创建）
    </completion_criteria>
    
    <output_format>
    ✓ Phase 0 完成：需求目录 = .catpaw/docs/{需求名}/
    </output_format>
    
    <error_handling>
      若无法确定需求目录：询问用户提供需求名，若用户未提供则停止执行
    </error_handling>
  </step>
</workflow>

---

## Phase 1：获取项目设计稿列表

<workflow>
  <step id="1" name="获取项目设计稿列表" required="true" depends_on="0">
    <action>获取 Project ID 并查询设计稿列表</action>
    
    <substeps>
      <substep id="1.1">获取 Project ID（用户提供或从链接提取）</substep>
      <substep id="1.2">使用 mtcli 查询设计稿数据，重定向到临时文件</substep>
      <substep id="1.3">解析设计稿列表，生成设计稿清单</substep>
    </substeps>
    
    <command>
    mkdir -p .catpaw/.tmp
    mtcli ingee_get_project api projects --projectId {projectId} > .catpaw/.tmp/ingee-project-{projectId}.json
    node .catpaw/scripts/parse-ingee-project.js .catpaw/.tmp/ingee-project-{projectId}.json .catpaw/.tmp/designs-list-{projectId}.json
    </command>
    
    <completion_criteria>
      - Project ID 已获取
      - 设计稿列表已解析
      - 设计稿总数已记录
    </completion_criteria>
    
    <output_format>
    ✓ Phase 1 完成：项目 {projectName}，共 {totalDesigns} 个设计稿
    </output_format>
    
    <error_handling>
      若 Project ID 无效：输出错误，询问用户重新提供，停止执行
      若查询失败：输出错误原因，询问重试，停止执行
      若无设计稿：输出提示，停止执行
    </error_handling>
  </step>
</workflow>

---

## Phase 2：用户选择要解析的设计稿

<workflow>
  <step id="2" name="用户选择要解析的设计稿" required="true" depends_on="1">
    <action>展示设计稿列表，等待用户选择</action>
    
    <output_template>
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    📋 设计稿项目解析结果
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    项目ID: {projectId}
    项目名称: {projectName}
    设计稿总数: {totalDesigns}
    
    设计稿列表：
      1. [{id}] {name} ({groupName}) - {width}×{height}
      2. [{id}] {name} ({groupName}) - {width}×{height}
      ...
    
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    🔍 请选择要解析的设计稿
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    1. 全部解析（{totalDesigns} 个设计稿）
    2. 选择特定设计稿（输入序号，如：1,3,5）
    3. 按分组选择（输入分组名）
    
    请输入您的选择：
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    </output_template>
    
    <substeps>
      <substep id="2.1">等待用户输入选择</substep>
      <substep id="2.2">根据选择类型，筛选待解析的设计稿列表</substep>
      <substep id="2.3">为每个设计稿生成组件名（用户指定或自动推断）</substep>
      <substep id="2.4">显示确认列表，等待用户确认</substep>
    </substeps>
    
    <completion_criteria>
      - 用户已选择解析范围
      - 待解析设计稿列表已确定
      - 用户已确认组件名
    </completion_criteria>
    
    <output_format>
    ✓ Phase 2 完成：将解析 {selectedCount} 个设计稿
    </output_format>
    
    <error_handling>
      若用户输入无效：重新询问，直到获得有效输入
      若用户取消：停止执行
    </error_handling>
  </step>
</workflow>

---

## Phase 3：并行调用 ui-design-analyzer（关键修复）

**⚠️ 重要：本步骤必须为每个设计稿独立创建一个 Sub-Agent，并行执行，不可省略任何一个。**

即使你认为"多个设计稿样式相似"或"设计稿数量太多"，也必须为每个设计稿独立创建 Sub-Agent。

### Step 3.1：构建设计稿处理列表

从 Phase 2 的选择结果中，构建完整的处理列表：

```json
{
  "designs_to_process": [
    {
      "designId": "123456",
      "designName": "商品列表 Card",
      "componentName": "GoodsListCard",
      "outputDir": ".catpaw/docs/{需求名}/ui-specs/",
      "outputFile": ".catpaw/docs/{需求名}/ui-specs/GoodsListCard.json"
    },
    {
      "designId": "123457",
      "designName": "搜索框",
      "componentName": "SearchBox",
      "outputDir": ".catpaw/docs/{需求名}/ui-specs/",
      "outputFile": ".catpaw/docs/{需求名}/ui-specs/SearchBox.json"
    }
  ]
}
```

### Step 3.2：并行创建 Sub-Agent

此步骤全自动执行，不需要用户任何操作。

使用 Task 工具为每个设计稿创建独立的 Sub-Agent：

```javascript
// 并行调用所有设计稿的 Sub-Agent（保持并行，印迹 API 无浏览器竞态问题）
const processingPromises = designs_to_process.map(design => {
  return Task({
    subagent_type: "general-agent",
    description: `解析设计稿 ${design.componentName}`,
    prompt: `
请调用 ui-design-analyzer skill 解析以下设计稿：

- 设计稿 ID: ${design.designId}
- 组件名: ${design.componentName}
- 设计稿名称: ${design.designName}
- 输出目录: ${design.outputDir} （注意：这是目录，不是文件路径）

**执行要求**：
1. 调用 ui-design-analyzer skill 获取设计稿样式信息
2. 执行 UI 开发级解析（见下方）
3. 分步写入输出文件（见下方「⚠️ 关键：分步写入策略」）
4. 写入后验证文件合法性
5. 完成后输出确认信息

**UI 开发解析（核心步骤，必须执行）**：

在生成 StyleSpec 数据后，必须额外完成以下开发级解析：

  **坐标转换**：分析父组件布局方式，将绝对坐标转为相对布局
  **布局分析**：提取 componentTree、识别 UI 元素类型、提取关键样式
  **组件映射（componentMapping）**：扫描项目 components/ 目录，识别 existing/new/enhanced 组件
  **输出字段补充**：componentTree、componentMapping、interactions、dataRequirements、tracking、constraints

---

**⚠️ 关键：分步写入策略（防止 JSON 截断损坏）**

由于 StyleSpec JSON 内容通常超过 15KB，直接一次性 write 大文件极易导致截断。
必须按以下策略分步写入：

**策略：每个组件一个目录 + 3 个分文件 + 格式化 + 验证**

**组件目录结构**：
```
{outputDir}/{componentName}/          ← 每个组件一个独立目录
├── index.json                   ← 索引摘要（< 2KB），轻量入口
├── spec.json                    ← 样式规范（设计稿原始数据）
└── dev.json                     ← 开发解析（组件映射/交互/埋点）
```

**步骤 1：创建组件目录**
- 先用 run_terminal_cmd 执行: mkdir -p {outputDir}/{componentName}/

**文件 1：索引摘要** `{outputDir}/{componentName}/index.json`（轻量入口，< 2KB）
- 内容：只包含 meta + 样式摘要 + 文件引用指针
- 示例：
{
  "meta": { "componentName": "xxx", "designId": "xxx", ... },
  "styleSummary": { "尺寸": "375×667pt", "主色调": "#xxx", ... },
  "files": {
    "spec": "spec.json",
    "dev": "dev.json"
  },
  "componentMapping": { "existing": N, "new": M, "enhanced": K }
}

**文件 2：基础样式规范** `{outputDir}/{componentName}/spec.json`
- 内容：meta + layoutStructure + modules/sections（纯设计稿数据）
- 使用 write 工具写入，内容必须是 JSON.stringify(data, null, 2) 格式化后的字符串

**文件 3：开发解析数据** `{outputDir}/{componentName}/dev.json`
- 内容：componentTree + componentMapping + interactions + dataRequirements + tracking + constraints + designTokens（开发所需数据）
- 使用 write 工具单独写入

**写入后的验证步骤（必须执行）**：
1. 每个 file write 后，立即用 read_file 读回前 50 行和最后 10 行
2. 检查文件是否以 \`}\` 或 \`}\` 结尾（JSON 完整性检查）
3. 如果发现截断（文件末尾不是合法 JSON 结尾），**直接删除该文件并重新生成**（不要尝试修复！）
4. 所有文件写入完成后，运行 python3 验证：python3 -c "import json; json.load(open('PATH'))"
5. 如果 python3 验证失败，**直接删除该文件并重新生成**（不要尝试修复！）

**⚠️ JSON 写入铁律**：
- 禁止将超大 JSON（>10KB）作为单个 write 工具的参数
- 禁止使用未格式化的 JSON（必须 indent=2）
- 禁止跳过写入后验证步骤
- 如果某个文件实在太大无法一次写入，拆分为更小的子模块分别写入
- **JSON 文件有问题时直接重新生成，不要尝试修复！**

**输出格式**（必须严格遵守）：
✓ ui-design-analyzer 完成
- 设计稿 ID: ${design.designId}
- 组件名: ${design.componentName}
- 产出目录: {outputDir}{componentName}/
  * index.json（索引摘要 <2KB）
  * spec.json（样式规范）
  * dev.json（开发解析）
- 样式摘要: [关键样式信息简述，3-5 行]
- 组件映射: 复用 X 个现有组件，新建 Y 个组件
- JSON 验证: PASS/FAIL

**禁止行为**：
- 禁止跳过任何解析步骤
- 禁止因为"看起来简单"而省略输出
- 禁止返回不完整的确认信息
- 禁止不执行组件映射步骤
- 禁止将所有数据合并为单个超大 JSON 文件
- **禁止尝试修复有问题的 JSON 文件，必须直接重新生成！**
`
  });
});

// 等待所有 Sub-Agent 完成
await Promise.all(processingPromises);
```

### Step 3.3：分批处理（设计稿数量 > 10 时）

如果设计稿数量超过 10 个，建议分批处理以避免系统负载过高：

```javascript
const BATCH_SIZE = 10;
const batches = chunk(designs_to_process, BATCH_SIZE);

for (let i = 0; i < batches.length; i++) {
  const batch = batches[i];
  console.log(`处理第 ${i+1}/${batches.length} 批，共 ${batch.length} 个设计稿`);
  
  const batchPromises = batch.map(design => createSubAgent(design));
  await Promise.all(batchPromises);
  
  if (i < batches.length - 1) {
    console.log(`等待 2 秒后继续下一批...`);
    await sleep(2000);
  }
}
```

### Step 3.4：等待所有返回确认

等待所有 Sub-Agent 返回完成确认。

每个 Sub-Agent 必须输出格式：

```
✓ ui-design-analyzer 完成
- 设计稿 ID: {designId}
- 组件名: {componentName}
- 产出文件: {outputPath}
- 样式摘要: {summary}
```

<completion_criteria>
- 收到的完成确认数量 == 设计稿总数
- 每个确认信息都包含设计稿 ID、组件名、产出文件路径
- 所有产出文件都已存在且非空
</completion_criteria>

<output_format>
✓ Phase 3 完成：{successCount}/{totalCount} 个设计稿已解析
</output_format>

<error_handling>
若某个 Sub-Agent 调用失败：
- 记录失败的设计稿信息（设计稿 ID、组件名、失败原因）
- 继续处理其他设计稿，不中断整体流程
- 在 Phase 4 中输出失败列表

若超过 20% 的设计稿失败：
- 输出警告
- 询问用户是否继续
</error_handling>

---

## Phase 4：汇总输出结果

<workflow>
  <step id="4" name="汇总输出结果" required="true" depends_on="3">
    <action>收集所有 Sub-Agent 的结果，生成汇总报告和索引文件</action>
    
    <substeps>
      <substep id="4.1">收集成功和失败的设计稿列表</substep>
      <substep id="4.2">生成汇总报告（成功/失败统计）</substep>
      <substep id="4.3">生成 index.json 索引文件</substep>
    </substeps>
    
    <output_template>
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    📊 印迹设计稿批量解析报告
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    项目ID: {projectId}
    项目名称: {projectName}
    解析时间: {timestamp}
    
    【解析统计】
    总数：{total}
    成功：{success}
    失败：{failed}
    
    【成功列表】
    序号 | 组件名         | 目录路径
    -----|---------------|----------------------------------------------
    1    | GoodsListCard | ui-specs/GoodsListCard/index.json + spec.json + dev.json
    2    | SearchBox     | ui-specs/SearchBox/index.json + spec.json + dev.json
    ...
    
    【失败列表】（如有）
    序号 | 设计稿名称   | 失败原因
    -----|-------------|------------------------------------
    3    | 底部导航栏   | 获取设计稿数据超时
    
    【文件输出目录】
    {requirementDir}/ui-specs/
    
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    </output_template>
    
    <index_file_format>
    {
      "projectId": "{projectId}",
      "projectName": "{projectName}",
      "generatedAt": "{timestamp}",
      "totalComponents": {success},
      "components": [
        {
          "name": "{componentName}",
          "designId": "{designId}",
          "dir": "{componentName}/",
          "files": {
            "index": "index.json",
            "spec": "spec.json",
            "dev": "dev.json"
          },
          "dimensions": { "width": 750, "height": 800 }
        }
      ]
    }
    </index_file_format>
    
    <completion_criteria>
      - 汇总报告已输出
      - index.json 已生成
    </completion_criteria>
    
    <output_format>
    ✓ Phase 4 完成：汇总报告和索引文件已生成
    </output_format>
  </step>
</workflow>

---

## Phase 5：生成整体布局样式概述文件（必须执行）

**⚠️ 重要：本步骤必须执行，不可跳过。即使所有设计稿解析失败，也必须生成 overview.md 说明失败情况。**

<workflow>
  <step id="5" name="生成整体布局样式概述文件" required="true" depends_on="4">
    <action>读取所有成功生成的 StyleSpec JSON，汇总生成 overview.md</action>
    
    <substeps>
      <substep id="5.1">读取 ui-specs/ 目录下各组件子目录中的 index.json 索引文件（按需读 spec.json 和 dev.json）</substep>
      <substep id="5.2">提取每个组件的关键样式信息</substep>
      <substep id="5.3">汇总公共样式（颜色、字体、间距、圆角）</substep>
      <substep id="5.4">推断组件层级关系</substep>
      <substep id="5.5">生成 overview.md 文件</substep>
    </substeps>
    
    <completion_criteria>
      - overview.md 文件已生成
      - 文件包含所有成功解析的组件信息
    </completion_criteria>
    
    <output_format>
    ✓ Phase 5 完成：overview.md 已生成
    - 文件路径: {requirementDir}/ui-specs/overview.md
    - 包含组件数: {successCount}
    </output_format>
    
    <error_handling>
      若没有成功解析的组件：
      - 生成 overview.md 内容为"所有设计稿解析失败，无法生成概述"
      - 仍然输出完成确认
      
      若部分组件解析失败：
      - 在 overview.md 中标注缺失的组件
      - 继续生成已有组件的信息
    </error_handling>
  </step>
</workflow>

---

## 最终完成确认

<workflow>
  <step id="final" name="输出最终完成确认" required="true" depends_on="5">
    <output_template>
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    ✅ 印迹设计稿批量解析完成！
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    项目：{projectName}
    成功解析：{successCount}/{totalCount} 个设计稿
    
    产出文件：
    📁 {requirementDir}/ui-specs/
    ├── index.json（组件索引）
    ├── overview.md（整体布局概述）
    ├── {componentName-1}/          ← 组件独立目录
    │   ├── index.json              ← 索引摘要 <2KB
    │   ├── spec.json               ← 样式规范
    │   └── dev.json                ← 开发解析
    ├── {componentName-2}/
    │   ├── index.json
    │   ├── spec.json
    │   └── dev.json
    └── ...
    
    下一步建议：
    - 查看 overview.md 了解整体 UI 结构
    - 运行 /代码开发 开始开发任务
    
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    </output_template>
    
    <completion_criteria>
      最终确认已输出
    </completion_criteria>
  </step>
</workflow>

---

## 与其他 Skill 的协作

| 方向 | Skill | 说明 |
|------|-------|------|
| 上游 | task-splitter | 在拆分 UI 任务时调用此 skill |
| 上游 | techdoc-generator | 生成技术方案后可调用此 skill |
| 独立 | 用户独立调用 | 批量解析设计稿 |
| 下游 | modular-developer | 开发时读取 StyleSpec JSON 作为参考 |
| 下游 | ui-visual-test | 使用 StyleSpec JSON 进行 UI 测试 |

---

## 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| projectId | string | 否 | 印迹项目 ID（可从链接提取） |
| requirementName | string | 否 | 需求名称（用于确定输出目录） |
| designSelection | string | 否 | 选择的设计稿（序号或分组名） |
| componentNames | object | 否 | 组件名映射 `{设计稿序号: 组件名}` |

---

## 输出结果

### 输出文件

| 文件 | 路径 | 说明 |
|------|------|------|
| 组件目录 | `.catpaw/docs/{需求名}/ui-specs/{Component}/` | 每个组件一个独立目录，内含 3 个文件 |
| 索引摘要 | `.../ui-specs/{Component}/index.json` | 轻量入口（<2KB），含 meta + 样式摘要 + 文件指针 |
| 样式规范 | `.../ui-specs/{Component}/spec.json` | 设计稿样式数据（meta + layoutStructure + modules/sections） |
| 开发解析 | `.../ui-specs/{Component}/dev.json` | 开发所需数据（componentTree + componentMapping + interactions + tracking） |
| 全局索引 | `.catpaw/docs/{需求名}/ui-specs/index.json` | 所有组件的索引汇总 |
| 整体布局概述 | `.catpaw/docs/{需求名}/ui-specs/overview.md` | 汇总报告 |

### 返回给调用方

```json
{
  "success": true,
  "data": {
    "projectId": "{projectId}",
    "projectName": "{projectName}",
    "totalDesigns": {total},
    "successCount": {success},
    "failedCount": {failed},
    "outputDir": ".catpaw/docs/{需求名}/ui-specs/",
    "components": [
      {
        "name": "{componentName}",
        "designId": "{designId}",
        "dir": "{componentName}/",
        "files": {
          "index": "index.json",
          "spec": "spec.json",
          "dev": "dev.json"
        },
      }
    ]
  }
}
```

---

## 注意事项

1. **权限要求**：需要印迹访问权限
2. **并发限制**：单批次最大并发 10 个，避免对印迹 API 造成过大压力
3. **命名规范**：组件名使用 PascalCase
4. **文件覆盖**：同名组件会覆盖已有文件
5. **分步写入**：大 JSON 必须分步写入并验证完整性
6. **JSON 问题直接重生成**：输出 JSON 有问题时直接删除重新生成，不尝试修复
7. **失败处理**：单个失败不影响整体流程，但会记录在报告中
8. **Phase 5 必须执行**：即使全部失败，也要生成 overview.md
