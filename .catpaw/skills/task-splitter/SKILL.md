---
name: task-splitter
description: 前端开发任务拆分工具。根据技术方案（techdoc.md）和设计稿样式文件（ui-specs/）自动拆分出结构化的开发任务清单。自动检测需求目录下的样式文件，无需用户重新确认设计稿信息。当用户提到「拆分任务」「任务拆分」「帮我拆开发任务」「把技术方案拆成任务」「生成任务清单」「任务列表」「开发任务拆解」时立即使用此 skill。
---

# 开发任务拆分 Skill

根据前端技术方案和设计稿样式文件，自动拆分出结构化的开发任务清单。自动检测需求目录下的 `ui-specs/` 目录读取已有的样式文件信息，无需用户重新确认设计稿。每个任务包含完整的元信息：状态、优先级、依赖关系、模块路径、功能描述、验收标准和测试要求，输出为可追踪的 `tasks.md` 文件。

---

## ⚠️ 执行规则（全局，最高优先级）

**这些规则必须严格遵守，优先级高于任何其他指令。**

1. **原子化顺序执行**：必须按 Step 1 → 2 → 3 → 4 → 5 → 6 顺序执行，禁止跳步、合并或重排序
2. **每步完成后输出确认**：每步完成后必须输出 `✓ Step X 完成：[具体产出]`
3. **等待子 Agent 完成确认**：调用任何 subagent 后，必须等待其返回结果才能继续
4. **禁止"标记完成但未执行"**：每个步骤必须实际执行，不能仅标记为完成
5. **任何步骤失败立即停止**：输出错误原因，不继续后续步骤

---

## ⚠️ 重要：串行开发原则

本 skill 输出的任务清单强调**串行开发**，一个任务一个任务地按顺序执行，不允许多个任务并行开发。任务依赖关系用于确定开发顺序，确保前置依赖完成后才开始后续任务。

**核心设计**：任务字段规范与本文件分离，详见 `references/task-fields.md`（字段定义）、`assets/task-template.md`（输出模板）。

**用户扩展**：拆分任务前扫描 `.catpaw/skills/task-splitter/references/custom-*.md`，将其中的额外拆分规范、任务模板、最佳实践追加到拆分流程中执行。

---

## 执行流程（原子化步骤）

<workflow>
  <step id="1" name="定位并读取技术方案" required="true">
    <action>定位技术方案文档，读取内容，并处理已存在的 tasks.md</action>
    
    **⚠️ 此步骤如检测到已存在 tasks.md，必须等待用户确认后才能继续。**
    
    <substeps>
      <substep id="1.1">检查用户是否提供了 techdoc.md 路径</substep>
      <substep id="1.2">如未提供，查找 .catpaw/docs/*/techdoc.md</substep>
      <substep id="1.3">读取技术方案文档内容</substep>
      <substep id="1.4">**检查项目目录结构**：识别代码根目录（如 src/、standard/ 等）</substep>
      <substep id="1.5">检查是否已有 tasks.md</substep>
      <substep id="1.6">如已存在 tasks.md，询问用户是否覆盖，**等待用户确认**</substep>
      <substep id="1.7">根据用户确认结果处理：覆盖则继续，跳过则终止流程</substep>
    </substeps>
    
    **⚠️ 项目目录结构检查方法**：
    
    在生成模块路径前，必须先检查项目的实际目录结构：
    
    ```bash
    # 检查项目根目录下的代码目录
    ls -d */ | grep -E "^(src|standard|pages|components|lib)/"
    
    # 常见的代码根目录：
    # - src/：最常见的源码目录
    # - standard/：标准化项目可能有独立的 standard 目录
    # - pages/：页面目录
    # - components/：组件目录
    # - lib/：库目录
    ```
    
    **常见项目结构示例**：
    
    | 结构类型 | 代码根目录 | 示例模块路径 |
    |---------|-----------|-------------|
    | 标准结构 | src/ | src/components/Button/ |
    | 混合结构 | src/ + standard/ | standard/types/xxx/、src/pages/xxx/ |
    | 简单结构 | 根目录 | components/Button/ |
    
    **⚠️ 重要：不要假设代码都在 src/ 目录下！**
    
    如果技术方案中提到了模块路径，需要验证该路径是否存在。如果不存在，需要根据实际目录结构调整。
    
    <completion_criteria>
      - 技术方案文档路径已确定
      - 技术方案内容已读取
      - **项目目录结构已检查，代码根目录已识别**
      - 如已存在 tasks.md，用户已确认处理方式（覆盖/跳过）
      - 如用户选择跳过，流程已终止
    </completion_criteria>
    
    <output_format>✓ Step 1 完成：技术方案路径 [路径]，已读取内容，tasks.md 处理方式已确认</output_format>
  </step>

  <step id="2" name="检查并读取设计稿样式文件" required="false" depends_on="1">
    <action>检查需求目录下是否存在 ui-specs 或 mg-specs 目录，读取已有的样式文件信息</action>
    
    **⚠️ 此步骤自动检测，无需用户确认设计稿信息。**
    
    <substeps>
      <substep id="2.1">检查需求目录下是否存在 ui-specs/ 目录</substep>
      <substep id="2.3">如存在样式目录，读取 index.json 和 overview.md 获取布局信息</substep>
      <substep id="2.4">如不存在任何样式目录，标记为"无设计稿样式文件"</substep>
    </substeps>
    
    **样式文件目录结构**：
    
    **设计稿样式文件（ui-specs/）**：
    ```
    {需求目录}/ui-specs/
    ├── index.json              ← 全局索引(所有组件汇总: name/designId/layerId/dimensions)
    ├── overview.md             ← 整体布局概述(公共样式/组件层级关系)
    ├── {ComponentName}/        ← 每个组件一个独立目录
    │   ├── index.json          ← 索引摘要(<2KB): meta + styleSummary + componentMapping
    │   ├── spec.json           ← 样式规范: layoutStructure + modules/sections(设计稿原始数据)
    │   └── dev.json            ← 开发解析(核心): componentTree + componentMapping + interactions + dataRequirements + tracking + constraints + designTokens
    ```
    
    **检测逻辑**：
    
    ```bash
    # 检查设计稿样式目录
    if [ -d "{需求目录}/ui-specs" ]; then
      SPECS_DIR="{需求目录}/ui-specs"
    fi
    
    # 读取索引文件和概述文件
    if [ -n "$SPECS_DIR" ]; then
      # 读取 index.json 获取组件列表
      # 读取 overview.md 获取整体布局信息
    fi
    ```
    
    **样式文件用途**：
    - index.json（全局）：获取组件列表、设计稿 ID、尺寸信息
    - overview.md：获取整体布局结构、公共样式、组件层级关系
    - {ComponentName}/index.json：获取组件轻量摘要(meta、styleSummary、componentMapping)
    - {ComponentName}/spec.json：获取布局结构和设计稿样式数据(layoutStructure、modules)
    - {ComponentName}/dev.json：获取开发核心数据(componentTree、componentMapping、interactions、dataRequirements、tracking、constraints、designTokens)
    - 为 Step 3 的布局职责分析提供依据
    - 为任务拆分提供设计稿维度信息
    
    <completion_criteria>
      - 已检查 ui-specs/ 和 mg-specs/ 目录是否存在
      - 如存在样式目录，已读取 index.json 和 overview.md
      - 如不存在样式目录，已标记为"无设计稿样式文件"
    </completion_criteria>
    
    <output_format>✓ Step 2 完成：设计稿样式文件检查完成
- 样式目录：{ui-specs/无}
- 组件数量：{N} 个
- 布局信息来源：{overview.md/无}</output_format>
    
    <error_handling>
      若样式目录存在但文件不完整：提示用户，使用已有文件继续
      若 index.json 解析失败：提示用户，尝试读取 overview.md 补充信息
    </error_handling>
  </step>

  <step id="3" name="分析技术方案，拆分任务" required="true" depends_on="2">
    <action>并行启动 subagent 分析技术方案、设计稿布局、获取规范</action>
    
    **此步骤使用并行 subagent 加速处理。**
    
    <substeps>
      <substep id="3.1">并行启动 4 个 general-agent</substep>
      <substep id="3.2">等待所有 agent 完成并合并结果</substep>
      <substep id="3.3">识别功能模块</substep>
      <substep id="3.4">按模块拆分任务，填写任务字段</substep>
      <substep id="3.5">提取跨模块共享任务</substep>
    </substeps>
    
    **Agent 1：分析技术方案文档**
    ```json
    {
      "subagent_type": "general-agent",
      "description": "分析技术方案文档",
      "prompt": "你是技术方案分析专家。请执行以下任务：\n\n1. 读取技术方案文档内容（从 Step 1 获取的路径）\n\n2. 提取以下关键信息：\n   - 模块划分：识别各个功能模块（如：商品列表、商品详情、购物车等）\n   - 每个模块的功能点列表\n   - 接口依赖：哪些功能依赖后端接口，接口是否已就绪\n   - 组件依赖：哪些功能依赖其他组件或公共模块\n   - 技术难点：方案中标注的难点或待确认项\n   - 工时估算：方案中的工时评估\n\n3. 输出结构化的分析结果，供后续任务拆分使用\n\n注意：如果技术方案不存在或内容不完整，返回空结果并说明原因。"
    }
    ```
    
    **Agent 2：分析设计稿样式文件**（仅在 Step 2 检测到样式目录时执行）
    ```json
    {
      "subagent_type": "general-agent",
      "description": "分析设计稿样式文件",
      "prompt": "你是UI布局分析专家。请执行以下任务：\n\n1. 读取设计稿样式文件（从 Step 2 获取的 ui-specs 目录路径）：\n   - 全局索引：{SPECS_DIR}/index.json（获取所有组件汇总信息: name/designId/layerId/dimensions）\n   - 整体概述：{SPECS_DIR}/overview.md（获取整体布局结构、公共样式、组件层级关系）\n   - 根据全局索引中的组件列表,逐个读取各组件目录下的 JSON 文件:\n     * {SPECS_DIR}/{ComponentName}/index.json → 轻量摘要(meta、styleSummary、componentMapping)\n     * {SPECS_DIR}/{ComponentName}/spec.json → 布局结构和设计稿样式数据(layoutStructure、modules)\n     * {SPECS_DIR}/{ComponentName}/dev.json → 开发核心数据(componentTree、componentMapping、interactions、dataRequirements、tracking、constraints、designTokens)\n\n2. 分析样式文件内容：\n   - 从全局 index.json 获取组件列表、设计稿 ID、尺寸信息\n   - 从 overview.md 获取整体布局结构、公共样式、组件层级关系\n   - 从各组件的 index.json/spec.json/dev.json 获取详细样式规格和开发数据\n   - 特别关注 dev.json 中的 componentMapping(existing复用/new新建/enhanced增强)、componentTree(组件层级)、designTokens(设计变量)、interactions(交互)、dataRequirements(接口)、tracking(埋点)、constraints(约束)\n\n3. 输出布局分析结果（**必须包含以下内容**）：\n   - 设计稿列表（ID、名称、类型：page/component）\n   - 每个设计稿的尺寸信息\n   - 代码行数预估\n   - **布局上下文**（每个页面级设计稿）：\n     - 页面整体结构（header/main/footer 等区域划分,来自 spec.json 的 layoutStructure）\n     - 各功能区域的布局方式（flex/grid）\n     - 区域间距（margin/padding,来自 dev.json 的 designTokens）\n     - 响应式断点（如有）\n   - **组件布局信息**（每个组件级设计稿）：\n     - 组件内部布局（flex 方向、对齐方式,来自 dev.json 的 componentTree）\n     - 内部间距（来自 dev.json 的 designTokens）\n     - 尺寸约束（固定宽度/自适应）\n     - 组件映射关系（existing/new/enhanced,来自 dev.json 的 componentMapping）\n     - 交互需求（来自 dev.json 的 interactions）\n     - 接口需求（来自 dev.json 的 dataRequirements）\n     - 埋点需求（来自 dev.json 的 tracking）\n     - 约束条件（来自 dev.json 的 constraints）\n   - 建议的任务拆分（基于设计稿结构和 componentMapping）\n\n**⚠️ 重要：布局上下文必须详细，不能只输出简单分类。componentMapping 是任务拆分的关键依据(existing组件无需新建任务,new组件需要单独拆分任务)。**\n\n注意：如果样式目录不存在，返回空结果并说明原因。"
    }
    ```
    
    **Agent 3：获取任务拆分规范**
    ```json
    {
      "subagent_type": "general-agent",
      "description": "获取任务拆分规范",
      "prompt": "你是任务拆分规范专家。请执行以下任务：\n\n1. 读取项目知识库中的任务拆分规范：\n   - .catpaw/skills/task-splitter/references/task-fields.md\n   - .catpaw/skills/task-splitter/assets/task-template.md\n\n2. 整理并输出以下规范：\n   - 任务字段定义和填写规范\n   - 任务类型分类规则（types/api/store/hook/page/component/util/integration）\n   - 任务粒度原则（0.5h-4h）\n   - 代码行数约束（针对 AI 开发）\n   - 依赖关系规则（强依赖/弱依赖）\n   - 布局职责分离规则（组件管内部，页面管外部）\n   - 输出模板格式要求\n\n注意：确保规范完整准确，为后续任务拆分提供标准。"
    }
    ```
    
    **Agent 4：获取用户自定义规范**
    ```json
    {
      "subagent_type": "general-agent",
      "description": "获取用户自定义规范",
      "prompt": "你是项目自定义规范专家。请执行以下任务：\n\n1. 扫描项目 .catpaw/skills/task-splitter/references/ 目录下的所有 custom-*.md 文件\n\n2. 读取所有找到的自定义规范文件内容\n\n3. 整理并输出以下信息：\n   - 自定义任务拆分规则（如果有）\n   - 项目特定的任务模板（如果有）\n   - 额外的验收标准要求（如果有）\n   - 项目特定的依赖关系规则（如果有）\n   - 其他扩展知识（如果有）\n\n注意：如果没有找到任何 custom-*.md 文件，返回空结果并说明原因。"
    }
    ```
    
    **模块识别规则**：
    
    | 技术方案章节 | 对应任务类型 |
    |-------------|-------------|
    | 类型定义 / TypeScript 接口 | types 类型任务 |
    | API 封装 / 接口调用 | api 接口任务 |
    | 状态管理 / Store | store 状态任务 |
    | 自定义 Hook / 业务逻辑 | hook 逻辑任务 |
    | 页面组件 / 路由 | page 页面任务 |
    | 业务组件 / UI 组件 | component 组件任务 |
    | 公共工具函数 | util 工具任务 |
    | 路由配置 / 权限 / 埋点 | integration 集成任务 |
    
    **布局职责分离规则**：
    
    这是本 skill 的核心规则，所有 UI 相关任务必须遵守：
    
    | 层级 | 职责 | 禁止事项 |
    |------|------|---------|
    | 组件 (component) | 负责内部元素排列（flex/grid）、内部间距 | ❌ 不设外部 margin，不设固定宽度（除非明确需要） |
    | 页面 (page) | 负责组件间间距、组件位置、响应式断点 | ❌ 不侵入组件内部样式 |
    
    **组件接口约定**：
    
    - 所有业务组件必须接受 `className?: string` prop
    - 组件默认宽度：`w-full`（撑满父容器）
    - 组件默认不设 margin
    
    **任务粒度原则**：
    
    - 最小粒度：0.5 小时（30 分钟）
    - 最大粒度：4 小时（半天）
    - 超过 4 小时：必须继续拆分为子任务
    - 独立可交付：每个任务完成后有可验证的产出
    
    **代码行数约束（针对 AI 开发）**：
    
    | 任务类型 | 建议最大代码行数 | 说明 |
    |---------|----------------|------|
    | types / util | 100 行 | 纯定义，通常不会超标 |
    | api 封装 | 80 行 | 单个接口封装 |
    | store 状态 | 120 行 | 单个 store 模块 |
    | hook 逻辑 | 150 行 | 单个自定义 Hook |
    | component 中型组件 | 150 行 | 超过应拆分子任务 |
    | page 简单页面 | 200 行 | 超过应按功能区域拆分 |
    | integration 集成 | 100 行 | 路由/权限配置 |
    
    <completion_criteria>
      - 4 个 agent 全部返回结果
      - 功能模块已识别
      - 如有设计稿，布局分析已完成
      - 任务列表已生成
      - 每个任务包含完整的必填字段
      - 任务粒度符合规范（0.5h-4h）
      - 代码行数预估在合理范围内
    </completion_criteria>
    
    <output_format>✓ Step 3 完成：识别出 [N] 个模块，拆分出 [M] 个任务，预估总工时 [X]h，预估总代码 [Y] 行</output_format>
  </step>

  <step id="4" name="分析任务依赖关系" required="true" depends_on="3">
    <action>分析任务之间的依赖关系，生成依赖图</action>
    
    <substeps>
      <substep id="3.1">识别模块内依赖关系</substep>
      <substep id="3.2">识别跨模块共享任务依赖</substep>
      <substep id="3.3">检测循环依赖</substep>
      <substep id="3.4">生成依赖关系图（Mermaid 格式）</substep>
    </substeps>
    
    **依赖规则**：
    
    - api 任务依赖 types 任务（需要类型定义）
    - store 任务依赖 api 任务（需要接口封装）
    - hook 任务依赖 store 或 api 任务（需要数据层）
    - component / page 任务依赖 hook 任务（需要业务逻辑）
    - integration 任务依赖相关 page 任务（需要页面存在）
    - 共享任务（如公共 types）被多个模块依赖，应最先执行
    
    **跨模块依赖标注**：
    
    | 共享任务 | 类型 | 被以下模块使用 |
    |---------|------|---------------|
    | T01 | types | 模块1, 模块2, 模块3 |
    | T02 | api | 模块1, 模块2 |
    
    <completion_criteria>
      - 所有任务的依赖关系已分析
      - 跨模块共享任务已识别
      - 依赖关系图已生成
      - 无循环依赖
    </completion_criteria>
    
    <output_format>✓ Step 3 完成：依赖关系分析完成，识别共享任务 [N] 个，关键路径 [T01 → T02 → ...]</output_format>
  </step>

  <step id="5" name="输出 tasks.md 文件" required="true" depends_on="4">
    <action>生成 tasks.md 文件并保存到指定路径</action>
    
    <substeps>
      <substep id="5.1">确定输出路径：.catpaw/docs/{需求名}/tasks.md</substep>
      <substep id="5.2">按照模板格式组装文件内容（按模块组织）</substep>
      <substep id="5.3">写入文件</substep>
    </substeps>
    
    **输出路径**：
    
    ```text
    {workspace}/.catpaw/docs/{需求名}/tasks.md
    ```
    
    **文件结构**（详见 assets/task-template.md）：
    
    1. 文件头部：需求名称、技术方案来源、设计稿链接（如有）、生成时间、整体进度统计
    2. 布局规范约定：全局的布局职责分离规则
    3. 共享任务区域：跨模块共用的任务（types、api 等）
    4. 依赖关系图：Mermaid 流程图展示任务依赖
    5. 按模块组织的任务清单（**每个 UI 任务必须包含布局上下文字段**）
    6. 开发顺序建议：根据依赖关系和优先级，推荐的开发顺序
    7. 风险提示：阻塞风险、技术难点、待确认项汇总
    
    **⚠️ 布局上下文字段要求**：
    
    对于 type 为 `page` 或 `component` 的任务，必须添加以下字段：
    
    | 字段 | 说明 |
    |------|------|
| 设计稿ID | 对应的设计稿 ID |
    | 页面结构 | 页面整体结构描述（header/main/footer 等区域） |
    | 布局方式 | 各区域的布局方式（flex/grid） |
    | 区域间距 | 区域间的 margin/padding 值 |
    | 响应式 | 响应式断点信息（如有） |
    
    <completion_criteria>
      - 文件已保存到正确路径
      - 文件内容格式正确
      - 所有任务字段完整
    </completion_criteria>
    
    <output_format>✓ Step 5 完成：文件已保存至 [绝对路径]</output_format>
  </step>

  <step id="6" name="展示任务总览" required="true" depends_on="5">
    <action>输出任务总览</action>
    
    <completion_criteria>
      - 任务总览已展示
    </completion_criteria>
    
    <output_format>
    ```
    ✓ Step 6 完成：任务总览已展示
    
    📋 任务拆分完成！
    
    📊 统计：
      - 功能模块数：{N} 个
      - 总任务数：{M} 个
      - P0 紧急：{n} 个
      - P1 高优：{n} 个
      - P2 中优：{n} 个
      - P3 低优：{n} 个
      - 预估总工时：{X}h
      - 预估总代码行数：{Y} 行
    
    📁 模块列表：
      1. {模块1名称}：{任务数} 个任务，{工时}h
      2. {模块2名称}：{任务数} 个任务，{工时}h
      ...
    
    🔄 共享任务：{N} 个（types/api等）
    
    ⚠️ 单任务行数预警（超过 200 行）：
      - T05 预估 400 行 → 建议按功能区域拆分
    
    🔗 关键路径（最长依赖链）：
      T01 → T02 → T04 → T06（预计 {X}h）
    
    ⚠️ 风险提示：
      - {如有阻塞风险或待确认项}
    
    📁 文件已保存至：{绝对路径}
    ```
    </output_format>
  </step>

</workflow>

---

## 任务调整支持

用户可以在对话中直接描述调整需求，skill 会相应更新 tasks.md：

| 用户指令 | 执行操作 |
|---------|---------|
| 「把 T03 拆成两个任务」 | 拆分任务，重新分配 ID |
| 「T05 的优先级改为 P0」 | 更新优先级字段 |
| 「T04 不依赖 T02，只依赖 T01」 | 更新依赖关系 |
| 「删除 T07」 | 删除任务，更新依赖引用 |
| 「T06 的模块路径改为 src/components/」 | 更新路径 |
| 「给 T03 加一条验收标准」 | 追加验收标准 |
| 「模块1的布局上下文需要调整间距」 | 更新该模块的布局上下文 |
| 「T05 的布局职责改为外部布局」 | 更新任务的布局职责字段 |

每次调整后，自动更新文件并重新展示受影响的任务。

---

## 页面拆分原则（按功能区域）

页面级任务如果过大，会导致 AI 上下文溢出、错误连锁、难以调试。因此需要对页面进行合理拆分。

**✅ 需要单独拆分为页面子任务的情况**：

- 页面包含多个独立功能区域：如筛选区 + 列表区 + 分页区 + 弹窗区
- 单个区域代码量超过 150 行：预估会导致 AI 输出超限
- 区域之间有明确的数据边界：可通过 Props/State 连接，不互相依赖实现细节
- 需求可能变更的区域：如列表展示方式（网格/列表）可能调整

**❌ 不需要拆分，整个页面作为一个任务**：

- 简单页面：如纯展示页、简单表单页（总代码 < 150 行）
- 区域间强耦合：无法独立开发和验收

**拆分后的任务 ID 规则**：

- 主任务 ID 仍为 T05（页面任务）
- 子任务 ID 为 T05-A、T05-B...
- 依赖关系：T05-A ← T05-B ← T05-C（按开发顺序）

---

## 组件拆分原则

在识别 component 任务时，需要判断是否需要单独拆分为组件模块：

**✅ 需要单独拆分为组件任务**：

- 多处复用：该组件在 2 个及以上页面/组件中使用
- 独立功能：该组件是独立的功能单元（如弹窗、表单、卡片等）
- 复杂度较高：组件逻辑复杂，代码量超过 100 行
- 公共组件库：计划放入公共组件库供团队使用
- 独立测试：需要单独编写单元测试

**❌ 不需要单独拆分，与页面任务合并**：

- 单次使用：仅在单个页面中使用，无复用计划
- 简单 UI：逻辑简单，代码量少于 50 行
- 强耦合：与页面逻辑强耦合，难以独立使用
- 页面特定：仅为特定页面服务的 UI 片段

---

## 与其他 Skill 的协作

```
techdoc-generator (技术方案生成)
       ↓
task-splitter (本 skill - 任务拆分)
       ↓
modular-developer (开发执行)
       ↓
mep-code (PR 管理)
```

---

## 错误处理

| 错误情况 | 处理方式 |
|---------|---------|
| 技术方案不存在 | 告知用户，建议先运行 techdoc-generator skill |
| 技术方案内容不完整 | 标注哪些任务字段无法填写，用 [待确认] 占位 |
| 任务依赖成环 | 检测并提示循环依赖，建议用户确认依赖关系 |
| 工时估算缺失 | 基于任务复杂度给出合理估算，并标注「估算值」 |

