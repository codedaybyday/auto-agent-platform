---
name: mastergo-batch-analyzer
description: MasterGo 设计稿批量解析工具。输入 MasterGo 文件 URL，获取整体设计稿布局信息，提取顶层 layerId 列表，并行调用 subagent 为每个模块生成 StyleSpec JSON 文件和总结文档。当用户需要批量解析 MasterGo 设计稿、获取整个文件的设计稿列表、批量生成 UI 规格文件时使用此 skill。关键词：「批量解析 MasterGo」「解析 MasterGo 项目」「获取所有设计稿」「解析整个 MasterGo 文件」「批量生成 StyleSpec」。
---

# MasterGo 设计稿批量解析 Skill

批量解析 MasterGo 设计稿文件，获取整体布局信息，提取顶层模块列表，为每个模块生成对应的 StyleSpec JSON 文件和总结文档。

---

## ⚠️ 执行规则（全局，最高优先级）

**这些规则必须严格遵守，优先级高于任何其他指令。**

1. **原子化顺序执行**：必须按 Phase 0 → 1 → 2 → 3 → 4 → 5 顺序执行，禁止跳步、合并或重排序
2. **Phase 3 必须并行调用所有模块的 Sub-Agent**：每个模块独立创建一个 Sub-Agent，并行执行以提高效率
3. **必须等待所有 Sub-Agent 返回**：收到全部 `✓ mastergo-extractor 完成` 确认后，才能进入 Phase 4
4. **每步完成后输出确认**：每个 Phase 完成后必须输出 `✓ Phase X 完成：[具体产出]`
5. **禁止"觉得类似就跳过"**：即使多个模块看起来相似，也必须为每个模块独立创建 Sub-Agent
6. **Phase 5 必须执行**：即使所有模块解析失败，也必须生成 overview.md（内容为错误说明）
7. **JSON 输出问题直接重新生成**：如果输出的 JSON 文件验证失败（格式错误/截断等），不尝试修复，直接删除并重新生成该文件

---

## 执行流程总览

```
Phase 0: 确定需求目录
    ↓
Phase 1: 解析 MasterGo URL 并获取整体布局信息
    ↓
Phase 2: 获取顶层 layerId 列表，用户选择要解析的模块
    ↓
Phase 3: 并行调用 mastergo-extractor（每个模块独立 Sub-Agent）
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

## Phase 1：解析 MasterGo URL 并获取整体布局信息

<workflow>
  <step id="1" name="解析 MasterGo URL 并获取整体布局信息" required="true" depends_on="0">
    <action>解析 MasterGo 文件 URL，导航到页面，获取整体布局信息</action>

    <substeps>
      <substep id="1.1">识别链接类型（goto 短链接 / file 完整链接）</substep>
      <substep id="1.2">导航到 MasterGo 页面，确保 devMode=true</substep>
      <substep id="1.3">等待 window.mg 就绪</substep>
      <substep id="1.4">获取文件整体信息（fileId、页面列表等）</substep>
    </substeps>

    <command>
    # goto 短链接：导航后从 data.url 读取真实 URL
    ~/.catpaw/bin/catdesk browser-action '{"action":"navigate","url":"https://imd.sankuai.com/goto/XXXXXXXX","waitUntil":"networkidle"}'

    # 完整链接：直接导航（确保 devMode=true）
    ~/.catpaw/bin/catdesk browser-action '{"action":"navigate","url":"https://imd.sankuai.com/file/FILE_ID?devMode=true","waitUntil":"networkidle"}'

    # 等待 window.mg 就绪
    ~/.catpaw/bin/catdesk browser-action '{"action":"evaluate","script":"JSON.stringify(window.mg && window.mg.document ? \"ready\" : \"mg not ready\")"}'
    </command>

    <completion_criteria>
      - URL 已解析，提取 fileId
      - 页面已加载，window.mg 就绪
      - 文件整体信息已获取
    </completion_criteria>

    <output_format>
    ✓ Phase 1 完成：文件ID = {fileId}，页面数 = {pageCount}
    </output_format>

    <error_handling>
      若 URL 无效：输出错误，询问用户重新提供，停止执行
      若 window.mg 未就绪：等待 3 秒后重试，最多 3 次，仍未就绪则提示用户手动刷新
      若需要登录：提示用户登录后重试
    </error_handling>
  </step>
</workflow>

---

## Phase 2：获取顶层 layerId 列表，用户选择要解析的模块

<workflow>
  <step id="2" name="获取顶层 layerId 列表" required="true" depends_on="1">
    <action>获取页面下的顶层节点列表，等待用户选择</action>

    <substeps>
      <substep id="2.1">列出所有页面，用户选择目标页面</substep>
      <substep id="2.2">获取目标页面的顶层节点列表</substep>
      <substep id="2.3">展示节点列表，等待用户选择解析范围</substep>
      <substep id="2.4">为每个选中的节点生成组件名</substep>
    </substeps>

    <command>
    # 列出所有页面
    ~/.catpaw/bin/catdesk browser-action '{"action":"evaluate","script":"JSON.stringify(window.mg.document.children.map(p=>({id:p.id,name:p.name})))"}'

    # 获取指定页面的顶层节点（替换 PAGE_ID）
    ~/.catpaw/bin/catdesk browser-action '{"action":"evaluate","script":"(function(){var page=window.mg.getNodeById(\"PAGE_ID\");if(!page)return\"page not found\";return JSON.stringify(page.children.map(function(c){return{id:c.id,name:c.name,type:c.type,w:c.width,h:c.height,y:c.y};}));})()"}'
    </command>

    <output_template>
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    📋 MasterGo 设计稿列表
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    文件ID: {fileId}
    页面: {pageName}

    顶层模块列表：
      1. [{id}] {name} ({type}) - {width}×{height}
      2. [{id}] {name} ({type}) - {width}×{height}
      ...

    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    🔍 请选择要解析的模块
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    1. 全部解析（{total} 个模块）
    2. 选择特定模块（输入序号，如：1,3,5）

    请输入您的选择：
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    </output_template>

    <completion_criteria>
      - 用户已选择解析范围
      - 待解析模块列表已确定
      - 用户已确认组件名
    </completion_criteria>

    <output_format>
    ✓ Phase 2 完成：将解析 {selectedCount} 个模块
    </output_format>

    <error_handling>
      若用户输入无效：重新询问，直到获得有效输入
      若用户取消：停止执行
    </error_handling>
  </step>
</workflow>

---

## Phase 3：串行调用 mastergo-extractor（关键步骤）

**⚠️ 重要：本步骤必须为每个模块独立创建一个 Sub-Agent，并行执行，不可省略任何一个。**

即使你认为"多个模块样式相似"或"模块数量太多"，也必须为每个模块独立创建 Sub-Agent。

**⚠️ 采用并行执行提高效率！** 每个模块的 Sub-Agent 独立运行，互不干扰。

### Step 3.1：构建模块处理列表

从 Phase 2 的选择结果中，构建完整的处理列表：

```json
{
  "modules_to_process": [
    {
      "layerId": "10:1234",
      "moduleName": "Header",
      "componentName": "Header",
      "fileId": "abc123",
      "pageId": "10:5678",
      "outputDir": ".catpaw/docs/{需求名}/ui-specs/",
      "outputFile": ".catpaw/docs/{需求名}/ui-specs/Header.json"
    },
    {
      "layerId": "10:2345",
      "moduleName": "ProductList",
      "componentName": "ProductList",
      "fileId": "abc123",
      "pageId": "10:5678",
      "outputDir": ".catpaw/docs/{需求名}/ui-specs/",
      "outputFile": ".catpaw/docs/{需求名}/ui-specs/ProductList.json"
    }
  ]
}
```

### Step 3.2：并行创建 Sub-Agent（⚠️ 并行执行）

**⚠️ 重要变更：采用并行执行提高效率！**

每个模块的 Sub-Agent 独立运行，同时处理不同模块的设计稿解析任务。

**使用 Promise.all 并行执行**：

```javascript
// ⚠️ 并行执行！所有模块同时启动
const results = await Promise.all(
  modules_to_process.map(async (module) => {
    console.log(`开始解析模块 ${module.componentName} (${module.layerId})...`);

    const result = await Task({
    subagent_type: "general-agent",
    description: `解析 MasterGo 模块 ${module.componentName}`,
    prompt: `
请调用 mastergo-extractor skill 解析以下 MasterGo 设计稿模块：

- 文件 ID: ${module.fileId}
- 页面 ID: ${module.pageId}
- 层级 ID (layerId): ${module.layerId}
- 模块名称: ${module.moduleName}
- 组件名: ${module.componentName}
- 输出目录: ${module.outputDir} （注意：这是目录，不是文件路径）

**执行要求**：
1. 先读取 mastergo-extractor skill 文件：.catpaw/skills/mastergo-extractor/SKILL.md
2. 按照 skill 流程执行：导航到设计稿页面 → exportAsync → dumpTree → 入库（使用 mg_import.py）→ 切片 → 生成规范
3. 使用 CatPaw Desk 浏览器工具（~/.catpaw/bin/catdesk browser-action）进行操作
4. 执行 UI 开发级解析（见下方）
5. 分步写入输出文件（见下方「⚠️ 关键：分步写入策略」）
6. 写入后验证文件合法性
7. 完成后输出确认信息

**🚨 关键：中间产物目录规范（必须遵守）**
- 所有临时文件（PNG 截图、dumpTree JSON、切片脚本、分析脚本、中间数据等）**必须**输出到 `.tmp/` 目录下
- **绝对禁止**在项目根目录生成任何文件（包括 .png、.py、.json 等非产出文件）
- 最终产出文件（index.json / spec.json / dev.json）按 outputDir 输出
- **执行完毕后必须清理 .tmp/ 目录中的所有临时文件**：rm -rf .tmp/*

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
  "meta": { "componentName": "xxx", "layerId": "xxx", ... },
  "styleSummary": { "尺寸": "375×1170pt", "主色调": "#xxx", ... },
  "files": {
    "spec": "spec.json",
    "dev": "dev.json"
  },
  "componentMapping": { "existing": N, "new": M, "enhanced": K }
}

**文件 2：基础样式规范** `{outputDir}/{componentName}/spec.json`
- 内容：meta + layoutStructure + modules/rootContainer/sections（纯设计稿数据）
- 使用 write 工具写入，内容必须是 JSON.stringify(data, null, 2) 格式化后的字符串

**文件 3：开发解析数据** `{outputDir}/{componentName}/dev.json`
- 内容：componentTree + componentMapping + interactions + dataRequirements + tracking + constraints + designTokens（开发所需数据）
- 使用 write 工具单独写入

**写入后的验证步骤（必须执行）**：
1. 每个文件 write 后，立即用 read_file 读回前 50 行和最后 10 行
2. 检查文件是否以 `}` 或 `}` 结尾（JSON 完整性检查）
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
✓ mastergo-extractor 完成
- 层级 ID: ${module.layerId}
- 组件名: ${module.componentName}
- 产出目录: {outputDir}/{componentName}/
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

    return result;
  })
);

console.log(results); // 记录所有结果
```

### Step 3.3：并行完成等待

所有 Sub-Agent 并行执行，等待全部完成：

```javascript
// Promise.all 会自动等待所有并行任务完成
// 结果已在上面的 Promise.all 中收集
```

> 注意：由于采用并行执行，各模块同时处理，无需手动间隔。

### Step 3.4：等待所有返回确认 + 验证产出文件

等待所有 Sub-Agent 返回完成确认。

每个 Sub-Agent 必须输出格式：

```
✓ mastergo-extractor 完成
- 层级 ID: {layerId}
- 组件名: {componentName}
- 产出文件: {outputPath}
- 样式摘要: {summary}
```

**⚠️ 产出文件存在性验证（必须执行，防止 Sub-Agent 提前中断导致空目录）**：

所有 Sub-Agent 返回后，必须逐一检查每个模块的产出文件是否存在且非空：

```bash
# 对每个模块检查 3 个核心文件是否存在
for dir in {outputDir}/*/; do
  name=$(basename "$dir")
  if [ ! -f "$dir/index.json" ] || [ ! -f "$dir/spec.json" ] || [ ! -f "$dir/dev.json" ]; then
    echo "⚠️ $name: 文件不完整或缺失"
    # 标记为失败
  else
    # 检查文件是否非空（>100 bytes）
    size=$(wc -c < "$dir/index.json")
    if [ "$size" -lt 100 ]; then
      echo "⚠️ $name: index.json 异常小 ($size bytes)"
    fi
  fi
done
```

**清理 .tmp/ 临时目录**：

```bash
# 清理所有 Sub-Agent 产生的临时文件
rm -rf .tmp/*
echo "✅ .tmp/ 目录已清理"
```

同时检查项目根目录是否被污染：

```bash
# 检查根目录是否有非预期文件（排除已有文件）
# 如果发现 .png、临时 .py、中间 .json 等文件，立即删除并记录警告
```

<completion_criteria>
- 收到的完成确认数量 == 模块总数
- 每个确认信息都包含 layerId、组件名、产出文件路径
- 所有产出文件都已存在且非空
</completion_criteria>

<output_format>
✓ Phase 3 完成：{successCount}/{totalCount} 个模块已解析
</output_format>

<error_handling>
若某个 Sub-Agent 调用失败：
- 记录失败的模块信息（layerId、组件名、失败原因）
- 继续处理其他模块，不中断整体流程
- 在 Phase 4 中输出失败列表

若超过 20% 的模块失败：
- 输出警告
- 询问用户是否继续
</error_handling>

---

## Phase 4：汇总输出结果

<workflow>
  <step id="4" name="汇总输出结果" required="true" depends_on="3">
    <action>收集所有 Sub-Agent 的结果，生成汇总报告和索引文件</action>

    <substeps>
      <substep id="4.1">收集成功和失败的模块列表</substep>
      <substep id="4.2">生成汇总报告（成功/失败统计）</substep>
      <substep id="4.3">生成 index.json 索引文件</substep>
    </substeps>

    <output_template>
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    📊 MasterGo 设计稿批量解析报告
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    文件ID: {fileId}
    页面: {pageName}
    解析时间: {timestamp}

    【解析统计】
    总数：{total}
    成功：{success}
    失败：{failed}

    【成功列表】
    序号 | 组件名      | 目录路径
    -----|-------------|----------------------------------------------
    1    | Header      | ui-specs/Header/index.json + spec.json + dev.json
    2    | ProductList | ui-specs/ProductList/index.json + spec.json + dev.json
    ...

    【失败列表】（如有）
    序号 | 模块名称    | 失败原因
    -----|-------------|------------------------------------
    3    | Footer      | 获取节点数据超时

    【文件输出目录】
    {requirementDir}/ui-specs/

    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    </output_template>

    <index_file_format>
    {
      "fileId": "{fileId}",
      "pageName": "{pageName}",
      "generatedAt": "{timestamp}",
      "totalComponents": {success},
      "components": [
        {
          "name": "{componentName}",
          "layerId": "{layerId}",
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

**⚠️ 重要：本步骤必须执行，不可跳过。即使所有模块解析失败，也必须生成 overview.md 说明失败情况。**

<workflow>
  <step id="5" name="生成整体布局样式概述文件" required="true" depends_on="4">
    <action>读取所有成功生成的 StyleSpec JSON，汇总生成 overview.md</action>

    <substeps>
      <substep id="5.1">读取 ui-specs/ 目录下所有 *.json 索引文件（优先读轻量的 *.json，按需读 *.spec.json 和 *.dev.json）</substep>
      <substep id="5.2">提取每个组件的关键样式信息</substep>
      <substep id="5.3">汇总公共样式（颜色、字体、间距、圆角）</substep>
      <substep id="5.4">推断组件层级关系</substep>
      <substep id="5.5">生成 overview.md 文件</substep>
    </substeps>

    <overview_template>
    # MasterGo 设计稿整体布局概述

    > 生成时间：{timestamp}
    > 文件ID：{fileId}
    > 页面：{pageName}
    > 组件数量：{total}

    ---

    ## 一、项目概览

    ### 1.1 设计稿尺寸分布

    | 尺寸规格 | 组件数量 | 组件列表 |
    |----------|----------|----------|
    | 750×1334 | 3 | HomePage, ProductList, DetailPage |
    | 750×60   | 2 | SearchBox, FilterBar |

    ### 1.2 布局类型分布

    | 布局类型 | 组件数量 | 组件列表 |
    |----------|----------|----------|
    | VERTICAL | 4 | HomePage, ProductList, DetailPage, Footer |
    | HORIZONTAL | 2 | SearchBox, FilterBar |

    ---

    ## 二、组件详情

    ### 2.1 {componentName-1}

    **基本信息**
    - 层级 ID：{layerId}
    - 尺寸：{width}×{height}
    - 布局类型：{layoutType}

    **布局结构**
    - 方向：{direction}
    - 内边距：{padding}
    - 间距：{gap}

    **视觉样式**
    - 背景：{background}
    - 文字：{typography}
    - 圆角：{radius}

    ---

    ## 三、公共样式提取

    ### 3.1 通用颜色变量

    | 设计颜色 | CSS 变量 | 使用组件 |
    |----------|----------|----------|
    | #333333 | --text-primary | Header, ProductList |
    | #FF6B00 | --brand-color | Button, TabBar |

    ---

    ## 四、组件层级关系

    ```
    Page
    ├── Header (750×60)
    ├── Content
    │   ├── FilterBar (750×60)
    │   └── ProductList (750×1000)
    └── Footer (750×100)
    ```

    ---

    ## 附录：文件索引

    | 组件名 | JSON 文件 |
    |--------|-----------|
    | Header | [Header.json](./Header.json) |
    | ProductList | [ProductList.json](./ProductList.json) |
    </overview_template>

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
      - 生成 overview.md 内容为"所有模块解析失败，无法生成概述"
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
    ✅ MasterGo 设计稿批量解析完成！
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    文件ID：{fileId}
    成功解析：{successCount}/{totalCount} 个模块

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
    - 查看 *.json 索引摘要快速了解各组件
    - 查看 *.spec.json 了解详细设计稿样式
    - 查看 *.dev.json 了解组件映射和开发所需信息

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
| 调用 | mastergo-extractor | 解析单个 MasterGo 模块 |
| 上游 | task-splitter | 在拆分 UI 任务时调用此 skill |
| 独立 | 用户独立调用 | 批量解析 MasterGo 设计稿 |
| 下游 | modular-developer | 开发时读取 StyleSpec JSON 作为参考 |
| 下游 | ui-visual-test | 使用 StyleSpec JSON 进行 UI 测试 |

---

## 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| mastergoUrl | string | 是 | MasterGo 文件 URL（goto 短链接或 file 完整链接） |
| requirementName | string | 否 | 需求名称（用于确定输出目录） |
| moduleSelection | string | 否 | 选择的模块（序号） |
| componentNames | object | 否 | 组件名映射 `{模块序号: 组件名}` |

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
| 布局概述 | `.catpaw/docs/{需求名}/ui-specs/overview.md` | 整体布局、公共样式、组件层级关系 |

### 返回给调用方

```json
{
  "success": true,
  "data": {
    "fileId": "{fileId}",
    "pageName": "{pageName}",
    "totalModules": {total},
    "successCount": {success},
    "failedCount": {failed},
    "outputDir": ".catpaw/docs/{需求名}/ui-specs/",
    "components": [
      {
        "name": "{componentName}",
        "layerId": "{layerId}",
        "file": "{componentName}.json"
      }
    ]
  }
}
```

---

## 注意事项

1. **权限要求**：需要已登录 imd.sankuai.com
2. **devMode**：导航时必须确保 URL 含 `devMode=true`
3. **window.mg 就绪**：执行任何操作前必须确认 `window.mg` 已就绪
4. **并行执行**：采用并行调用 Sub-Agent 提高效率
5. **分步写入**：大 JSON 必须分步写入并验证完整性
6. **JSON 问题直接重生成**：输出 JSON 有问题时直接删除重新生成，不尝试修复
7. **失败处理**：单个失败不影响整体流程，但会记录在报告中
8. **Phase 5 必须执行**：即使全部失败，也要生成 overview.md
