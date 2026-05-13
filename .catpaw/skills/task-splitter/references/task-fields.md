# 任务字段规范

本文档定义了 tasks.md 中每个任务必须包含的字段及其填写规范。

---

## 字段总览

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `id` | ✅ | string | 任务唯一标识 |
| `title` | ✅ | string | 任务标题 |
| `type` | ✅ | enum | 任务类型 |
| `status` | ✅ | enum | 任务状态 |
| `priority` | ✅ | enum | 优先级 |
| `module` | ✅ | string | 所属模块名称 |
| `layout_responsibility` | ✅ (UI任务) | string | 布局职责 |
| `parent_control` | ✅ (组件任务) | string | 父页面需控制的布局 |
| `exposed_api` | ✅ (组件任务) | string | 暴露的布局控制接口 |
| `module_path` | ✅ | string | 模块路径 |
| `description` | ✅ | string | 功能描述 |
| `acceptance` | ✅ | array | 验收标准列表 |
| `test_requirements` | ✅ | string | 测试要求 |
| `depends_on` | ❌ | array | 依赖的任务 ID 列表 |
| `estimated_hours` | ❌ | string | 预估工时 |
| `estimated_lines` | ❌ | number | 预估代码行数 |
| `development_advice` | ❌ | string | 开发建议 |
| `notes` | ❌ | string | 备注 |

---

## 字段详细说明

### id

- **格式**：`T{序号}` 或 `T{序号}-{子序号}`
- **示例**：`T01`、`T02`、`T05-A`、`T05-B`
- **规则**：
  - 序号从 01 开始，两位数
  - 子任务使用字母 A-Z 或数字 1-9
  - 全文件唯一

### title

- **格式**：简洁的动作描述
- **示例**：
  - 「封装商品信息查询 API」
  - 「实现 FilterBar 筛选组件」
  - 「完成商品列表页布局」

### type

| 类型 | 说明 | 典型产出 |
|------|------|---------|
| `types` | 类型定义 | TypeScript interface/type |
| `api` | API 封装 | 接口请求函数 |
| `store` | 状态管理 | Zustand/Redux store |
| `hook` | 业务逻辑 | 自定义 Hook |
| `page` | 页面组件 | 页面级组件 |
| `component` | 业务组件 | 可复用 UI 组件 |
| `util` | 工具函数 | 公共工具方法 |
| `integration` | 集成任务 | 路由、权限、埋点 |
| `test` | 测试任务 | 单元测试、集成测试 |

### status

| 状态 | 符号 | 说明 |
|------|------|------|
| 待开始 | `[ ]` | 任务未开始 |
| 进行中 | `[~]` | 任务正在执行 |
| 已完成 | `[x]` | 任务已完成 |
| 阻塞 | `[!]` | 任务被阻塞 |
| 已跳过 | `[-]` | 任务已跳过 |

### priority

| 优先级 | 说明 |
|--------|------|
| `P0` | 紧急，阻塞其他任务 |
| `P1` | 高，核心功能 |
| `P2` | 中，重要但非核心 |
| `P3` | 低，可延后 |

### module

- **格式**：模块名称
- **示例**：「商品列表页」「商品详情页」「购物车」
- **特殊值**：`shared` 表示跨模块共享任务

### layout_responsibility

| 值 | 说明 | 适用任务类型 |
|----|------|-------------|
| `内部布局` | 组件负责内部元素排列 | component |
| `外部布局` | 页面负责组件间间距和位置 | page |
| `无` | 无布局职责 | types, api, store, hook, util |

### parent_control

- **说明**：父页面需要控制的布局属性
- **示例**：「margin-bottom: 24px」「宽度控制」「响应式断点覆盖」

### exposed_api

- **说明**：组件暴露给父页面的布局控制接口
- **示例**：「className?: string」「style?: React.CSSProperties」「columns?: number」

### module_path

- **格式**：相对于项目根目录的路径
- **示例**：
  - `src/types/`
  - `src/api/`
  - `src/components/FilterBar/`
  - `src/pages/ProductList/`

### description

- **内容**：功能描述 + 关键实现思路
- **示例**：

```text
实现商品筛选组件，包含：
- 分类下拉选择
- 价格区间输入
- 排序选项

使用 useState 管理筛选值，通过 onChange 回调向上传递
```

### acceptance

- **格式**：Markdown 任务列表
- **要求**：至少 2 条，可验证
- **示例**：

```markdown
- [ ] 筛选条件变化时正确触发 onChange 回调
- [ ] 组件不包含 margin，宽度默认 100%
- [ ] 支持 className prop 覆盖样式
```

### test_requirements

- **内容**：测试场景覆盖要求
- **示例**：

```text
- 组件在无外部 className 时，宽度为 100%
- 父容器传入 className="mb-4" 后，margin-bottom 生效
- 筛选条件变化时回调参数正确
```

### depends_on

- **格式**：任务 ID 数组
- **示例**：`[T01, T02]`
- **空值**：`[]`

### estimated_hours

- **格式**：数字 + h
- **示例**：`2h`、`0.5h`、`3.5h`

### estimated_lines

- **格式**：数字
- **示例**：`120`、`80`

### development_advice

- **内容**：开发建议、预警、提醒
- **示例**：
  - 「⚠️ 开始前需确认：接口字段是否已定」
  - 「💡 建议：如果实现过程中发现超过 200 行，按功能区域拆分为子任务」
  - 「⚡ 可并行：本任务与 T03、T04 无依赖，可同时开发」

### notes

- **内容**：技术难点、待确认项、风险
- **示例**：
  - 「后端接口尚未就绪，先用 mock 数据」
  - 「设计稿中响应式行为未明确，待确认」
