---
name: ui-design-analyzer
description: UI设计稿获取与解析专家。负责从印迹设计稿获取UI信息，分析布局结构，转换坐标系统，输出 StyleSpec JSON 和用户可读摘要。当用户提到「获取设计稿」「解析设计稿」「分析UI」「设计稿确认」「印迹设计稿」「UI布局分析」时立即使用此 skill。
---

# UI 设计稿分析 Skill

聚焦 **UI 设计稿的获取与解析**，提供从设计稿到可实现布局方案的完整转换流程，输出 StyleSpec JSON 文件和用户可读摘要。

---

## 执行流程

```
Phase 0: 确定需求目录
Phase 1: 设计稿获取
Phase 2: UI 信息解析
Phase 3: 输出 StyleSpec JSON 文件
Phase 4: 输出用户可读摘要
```

---

## Phase 0：确定需求目录

### 0.1 查找需求目录

按以下优先级确定输出目录：

1. **用户提供需求名**：使用 `.catpaw/docs/{需求名}/`
2. **已存在 techdoc.md**：使用 `.catpaw/docs/*/techdoc.md` 所在目录
3. **已存在 tasks.md**：使用 `.catpaw/docs/*/tasks.md` 所在目录
4. **未找到目录**：询问用户提供需求名

### 0.2 确定输出路径

```
{需求目录}/
  ├── techdoc.md
  ├── tasks.md
  └── ui-specs/              ← StyleSpec JSON 输出目录
      ├── {componentName}.json
      └── {componentName}.json
```

---

## Phase 1：设计稿获取

### 1.1 识别设计稿来源

按以下优先级确定设计稿信息：

1. **用户提供印迹节点 ID**：直接调用 `mcp_tool_ingee_ingee_get_file_data` 获取
2. **用户提供印迹链接**：从链接中提取节点 ID 后获取
3. **用户提供技术方案 UI 描述**：使用描述作为 UI 信息来源
4. **任务对象中包含设计稿信息**：从任务字段中提取
5. **无设计稿信息**：询问用户

### 1.2 获取设计稿数据

**调用印迹工具获取设计稿**：

```json
{
  "tool": "mcp_tool_ingee_ingee_get_file_data",
  "params": {
    "imageId": "{设计稿ID}",
    "layerId": "{节点ID}"
  }
}
```

**获取失败处理**：

| 失败原因 | 处理方式 |
|---------|---------|
| 节点 ID 不存在 | 提示用户检查节点 ID 是否正确 |
| 权限不足 | 提示用户检查印迹权限 |
| 网络错误 | 提供重试选项 |
| 设计稿已删除 | 询问是否有新的设计稿链接 |

**无设计稿处理**：

询问用户选择：
1. 提供设计稿链接/节点 ID
2. 使用技术方案中的 UI 样式描述
3. 提供文字描述的 UI 需求

---

## Phase 2：UI 信息解析（使用 subagent）

### 2.1 调用 general-agent 进行布局分析

**调用 subagent**：

```json
{
  "subagent_type": "general-agent",
  "description": "UI 信息处理与布局分析",
  "prompt": "你是 UI 信息处理专家，负责将设计稿或 UI 描述转换为 StyleSpec JSON 格式。\n\n请执行以下任务：\n\n**输入信息**：\n- UI 来源：{设计稿节点 ID / 技术方案 UI 描述}\n- 技术方案模块路径：{模块路径}\n- 组件名称：{componentName}\n\n**处理步骤**：\n\n1. **分析 UI 信息**\n   - 如有设计稿：获取设计稿中各元素的 x, y, width, height\n   - 如有 UI 描述：提取描述中的尺寸、布局、样式信息\n   - 识别元素的层级关系和嵌套结构\n\n2. **检测项目代码中的父容器/相邻元素**\n   - 根据技术方案中的模块路径，读取目标文件的父组件代码\n   - 分析父容器的布局方式（flex/grid/absolute）\n   - 识别相邻元素的位置关系\n\n3. **转换为相对布局**\n   - 将绝对坐标 (x, y) 或固定尺寸转换为相对定位：\n     - `absolute` → 检测是否需要脱离文档流\n     - `flex` → 转换为 flex item 属性（flex-grow, flex-shrink, margin）\n     - `grid` → 转换为 grid item 属性（grid-column, grid-row）\n   - 处理父子关系：\n     - 父容器尺寸 → 子元素百分比/flex 布局\n     - 兄弟元素 → margin 间距、对齐方式\n   - 特殊处理：\n     - 居中布局 → flex center / absolute + transform\n     - 固定尺寸 → width/height 或 max-width/max-height\n     - 响应式 → 百分比 / vw/vh / media query\n\n4. **提取关键样式**\n   - 尺寸、背景、文字样式、间距、圆角等\n\n5. **制定实现策略**\n   - 布局方案选择\n   - 组件复用建议\n   - 颜色变量映射\n\n**输出格式（StyleSpec JSON）**：\n```json\n{\n  \"metadata\": {\n    \"componentName\": \"组件名\",\n    \"version\": \"1.0.0\",\n    \"createdAt\": \"2024-01-01T00:00:00Z\",\n    \"source\": {\n      \"type\": \"ingee\",\n      \"imageId\": \"设计稿ID\",\n      \"layerId\": \"节点ID\",\n      \"url\": \"https://ingee.meituan.com/#/artboard/{imageId}?layerId={layerId}\"\n    }\n  },\n  \"layout\": {\n    \"type\": \"flex | grid | absolute | static\",\n    \"direction\": \"row | column\",\n    \"wrap\": \"wrap | nowrap\",\n    \"justify\": \"flex-start | center | flex-end | space-between | space-around\",\n    \"align\": \"flex-start | center | flex-end | stretch | baseline\",\n    \"gap\": \"8px\",\n    \"parent\": {\n      \"name\": \"父组件名\",\n      \"layoutType\": \"flex | grid | absolute\",\n      \"position\": \"relative | absolute | fixed | sticky\"\n    },\n    \"adjacent\": {\n      \"left\": \"相邻元素名\",\n      \"right\": \"相邻元素名\",\n      \"top\": \"相邻元素名\",\n      \"bottom\": \"相邻元素名\"\n    }\n  },\n  \"dimensions\": {\n    \"width\": \"100% | 300px | auto\",\n    \"height\": \"auto | 200px | 100%\",\n    \"minWidth\": \"unset | 200px\",\n    \"maxWidth\": \"unset | 100%\",\n    \"minHeight\": \"unset | 100px\",\n    \"maxHeight\": \"unset | 80vh\"\n  },\n  \"spacing\": {\n    \"padding\": {\n      \"top\": \"16px\",\n      \"right\": \"16px\",\n      \"bottom\": \"16px\",\n      \"left\": \"16px\"\n    },\n    \"margin\": {\n      \"top\": \"8px\",\n      \"right\": \"0\",\n      \"bottom\": \"8px\",\n      \"left\": \"0\"\n    }\n  },\n  \"typography\": {\n    \"fontFamily\": \"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif\",\n    \"fontSize\": \"14px\",\n    \"fontWeight\": \"400 | 500 | 600 | 700\",\n    \"lineHeight\": \"20px\",\n    \"textAlign\": \"left | center | right | justify\",\n    \"color\": \"#333333 | var(--text-color)\"\n  },\n  \"background\": {\n    \"color\": \"#ffffff | var(--bg-color)\",\n    \"image\": \"none | url('...')\",\n    \"size\": \"cover | contain | 100% 100%\",\n    \"position\": \"center | top left | ...\",\n    \"repeat\": \"no-repeat | repeat | repeat-x | repeat-y\"\n  },\n  \"border\": {\n    \"width\": \"1px\",\n    \"style\": \"solid | dashed | dotted | none\",\n    \"color\": \"#e0e0e0 | var(--border-color)\",\n    \"radius\": {\n      \"topLeft\": \"8px\",\n      \"topRight\": \"8px\",\n      \"bottomRight\": \"8px\",\n      \"bottomLeft\": \"8px\"\n    }\n  },\n  \"effects\": {\n    \"boxShadow\": \"none | 0 2px 8px rgba(0, 0, 0, 0.1)\",\n    \"opacity\": \"1\",\n    \"transform\": \"none | translateY(-2px)\"\n  },\n  \"responsive\": [\n    {\n      \"breakpoint\": \"768px\",\n      \"changes\": {\n        \"layout\": {\n          \"direction\": \"column\"\n        },\n        \"dimensions\": {\n          \"width\": \"100%\"\n        }\n      }\n    }\n  ],\n  \"states\": {\n    \"hover\": {\n      \"background\": {\n        \"color\": \"#f5f5f5\"\n      },\n      \"effects\": {\n        \"boxShadow\": \"0 4px 12px rgba(0, 0, 0, 0.15)\"\n      }\n    },\n    \"active\": {\n      \"transform\": \"scale(0.98)\"\n    },\n    \"disabled\": {\n      \"opacity\": \"0.5\",\n      \"cursor\": \"not-allowed\"\n    }\n  },\n  \"implementation\": {\n    \"layoutStrategy\": \"flex column 布局，垂直居中对齐\",\n    \"reusableComponents\": [\n      {\n        \"name\": \"Card\",\n        \"path\": \"src/components/Card/\",\n        \"usage\": \"可复用现有 Card 组件，调整 padding 和 border\"\n      }\n    ],\n    \"colorVariables\": [\n      {\n        \"designColor\": \"#333333\",\n        \"cssVariable\": \"--text-color\",\n        \"usage\": \"主文本颜色\"\n      }\n    ],\n    \"notes\": [\n      \"使用 flex 布局，兼容性好\",\n      \"注意处理文本溢出情况\"\n    ]\n  }\n}\n```\n\n**注意**：\n- 所有颜色值优先使用 CSS 变量（如 `var(--text-color)`）\n- 尺寸值使用 `px`、`%`、`rem`、`vw/vh` 等标准单位\n- 布局类型明确标注（flex/grid/absolute）\n- 响应式断点参考项目现有配置\n- 提供可复用组件建议\n"
}
```

### 2.2 分析内容

subagent 会返回 StyleSpec JSON，包含：

1. **metadata**：组件元信息（名称、版本、来源）
2. **layout**：布局信息（类型、方向、对齐、父容器、相邻元素）
3. **dimensions**：尺寸信息（宽、高、最小/最大值）
4. **spacing**：间距信息（padding、margin）
5. **typography**：文字样式（字体、字号、颜色）
6. **background**：背景信息（颜色、图片）
7. **border**：边框信息（宽度、样式、圆角）
8. **effects**：效果（阴影、透明度、变换）
9. **responsive**：响应式配置（断点、变化）
10. **states**：状态样式（hover、active、disabled）
11. **implementation**：实现建议（布局策略、复用组件、颜色变量）

---

## Phase 3：输出 StyleSpec JSON 文件

### 3.1 创建输出目录

```bash
mkdir -p .catpaw/docs/{需求名}/ui-specs/
```

### 3.2 写入 JSON 文件

**文件路径**：`.catpaw/docs/{需求名}/ui-specs/{componentName}.json`

**使用 write 工具写入文件**：

```json
{
  "file_path": ".catpaw/docs/{需求名}/ui-specs/{componentName}.json",
  "contents": "{StyleSpec JSON 内容}"
}
```

### 3.3 输出确认

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ StyleSpec JSON 已生成
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
组件：{componentName}
文件：.catpaw/docs/{需求名}/ui-specs/{componentName}.json
大小：{N} KB
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Phase 4：输出用户可读摘要

### 4.1 摘要格式

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 UI 设计稿分析摘要
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
组件：{componentName}
来源：{印迹设计稿 / 技术方案 UI 描述}
{如有印迹}设计稿链接：{url}

【布局方案】
类型：{flex/grid/absolute} {direction: row/column}
对齐：{justify} | {align}
父容器：{父组件名}（{布局方式}）
相邻元素：左侧 {name} | 右侧 {name}

【尺寸与间距】
尺寸：{width} × {height}
内边距：{padding}
外边距：{margin}

【视觉样式】
背景：{background color}
文字：{fontSize} / {lineHeight} / {color}
边框：{border width} {border style} {border color}
圆角：{border radius}
{如有阴影}阴影：{box shadow}

【响应式】
{遍历 responsive 数组}
断点 {breakpoint}：
  - {布局/尺寸变化描述}

【交互状态】
{如有 hover}悬停：{hover 效果描述}
{如有 active}激活：{active 效果描述}
{如有 disabled}禁用：{disabled 效果描述}

【实现建议】
布局策略：{layoutStrategy}
{如有复用组件}可复用组件：
  - {component name}：{usage}
{如有颜色变量}颜色变量：
  - {design color} → {css variable}（{usage}）

【注意事项】
{遍历 notes 数组}
- {note}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📁 StyleSpec 文件：{绝对路径}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 4.2 等待用户确认

**⚠️ 停止执行，等待用户确认。未经用户确认，不得进入实现阶段。**

---

## 调用方式

### 方式 1：直接调用

当用户明确要求「获取设计稿」「解析设计稿」时，直接调用此 skill。

### 方式 2：被其他 skill 调用

其他 skill（如 `task-splitter`）可以在需要 UI 分析时调用此 skill。

**调用示例**：

```
用户在 task-splitter 中需要分析设计稿：

task-splitter 输出：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
正在调用 ui-design-analyzer skill 分析设计稿...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

→ 调用 ui-design-analyzer skill
→ ui-design-analyzer 执行 Phase 0-4
→ 输出 StyleSpec JSON 文件
→ 输出用户可读摘要
→ 返回文件路径给 task-splitter
```

---

## 输入参数

当被其他 skill 调用时，接收以下参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `uiSource` | string | 是 | 设计稿节点 ID / 印迹链接 / UI 描述 |
| `modulePath` | string | 否 | 技术方案中的模块路径 |
| `componentName` | string | 是 | 组件名称 |
| `requirementName` | string | 否 | 需求名称（用于确定输出目录） |

---

## 输出结果

### 输出文件

**StyleSpec JSON 文件**：`.catpaw/docs/{需求名}/ui-specs/{componentName}.json`

### 返回给调用方

```json
{
  "success": true,
  "data": {
    "componentName": "组件名",
    "filePath": ".catpaw/docs/{需求名}/ui-specs/{componentName}.json",
    "absolutePath": "/absolute/path/to/ui-specs/{componentName}.json",
    "source": {
      "type": "ingee",
      "url": "https://ingee.meituan.com/#/artboard/{imageId}?layerId={layerId}"
    }
  }
}
```

---

## 常见问题处理

### 1. 设计稿获取失败

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ 设计稿获取失败
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
失败原因：{具体原因}

解决方案：
1. 检查节点 ID 是否正确
2. 检查印迹权限
3. 提供新的设计稿链接
4. 使用技术方案中的 UI 描述

请选择处理方式：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 2. 无设计稿信息

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ 未找到设计稿信息
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
请选择：
1. 提供设计稿链接/节点 ID
2. 使用技术方案中的 UI 样式描述
3. 提供文字描述的 UI 需求

请告诉我您的选择。
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 3. 无法确定需求目录

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ 无法确定输出目录
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
未找到 techdoc.md 或 tasks.md 文件。

请提供需求名称（用于创建输出目录）：
例如：「fake-dish-min-order」
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## StyleSpec JSON 规范

### 完整字段说明

#### metadata（元信息）
- `componentName`：组件名称
- `version`：StyleSpec 版本（默认 "1.0.0"）
- `createdAt`：创建时间（ISO 8601 格式）
- `source`：设计稿来源信息

#### layout（布局）
- `type`：布局类型（flex/grid/absolute/static）
- `direction`：主轴方向（row/column）
- `wrap`：是否换行（wrap/nowrap）
- `justify`：主轴对齐
- `align`：交叉轴对齐
- `gap`：子元素间距
- `parent`：父容器信息
- `adjacent`：相邻元素信息

#### dimensions（尺寸）
- `width`/`height`：宽/高
- `minWidth`/`maxWidth`：最小/最大宽度
- `minHeight`/`maxHeight`：最小/最大高度

#### spacing（间距）
- `padding`：内边距（top/right/bottom/left）
- `margin`：外边距（top/right/bottom/left）

#### typography（文字）
- `fontFamily`：字体族
- `fontSize`：字号
- `fontWeight`：字重
- `lineHeight`：行高
- `textAlign`：对齐方式
- `color`：颜色

#### background（背景）
- `color`：背景色
- `image`：背景图
- `size`：背景尺寸
- `position`：背景位置
- `repeat`：重复方式

#### border（边框）
- `width`：边框宽度
- `style`：边框样式
- `color`：边框颜色
- `radius`：圆角（topLeft/topRight/bottomRight/bottomLeft）

#### effects（效果）
- `boxShadow`：阴影
- `opacity`：透明度
- `transform`：变换

#### responsive（响应式）
- `breakpoint`：断点
- `changes`：变化内容（layout/dimensions/spacing 等）

#### states（状态）
- `hover`：悬停状态样式
- `active`：激活状态样式
- `disabled`：禁用状态样式

#### implementation（实现建议）
- `layoutStrategy`：布局策略描述
- `reusableComponents`：可复用组件列表
- `colorVariables`：颜色变量映射
- `notes`：注意事项

---

## 与其他 Skill 的协作

- **上游**：`task-splitter` 在拆分 UI 任务时调用此 skill
- **上游**：`techdoc-generator` 生成技术方案后可调用此 skill
- **独立**：用户可独立调用此 skill 分析设计稿
- **下游**：`modular-developer` 开发时读取 StyleSpec JSON 作为参考
