---
name: unit-test-generator
description: 前端单元测试自动生成工具。根据技术方案（techdoc.md）和源代码，自动分析被测模块、识别测试场景，生成覆盖主流程、边界条件和异常处理的 Jest 单测文件，输出到项目 __tests__/ 目录。当用户提到「生成单测」「写单元测试」「帮我写测试」「生成 test 文件」「根据技术方案写单测」「单测覆盖」「jest 测试」「unit test」「帮我补充测试用例」「测试用例生成」时立即使用此 skill。即使用户只是说「帮我把这个模块测一下」「这个功能需要单测」，也应触发此 skill。
---

# 前端单元测试生成 Skill

根据技术方案文档和项目源代码，自动分析需要测试的模块，生成结构完整、覆盖全面的 Jest 单元测试文件，输出到 `__tests__/` 目录。

> 测试场景设计规范详见 `references/test-scenarios.md`，各框架测试模板详见 `assets/test-templates.md`。

---

## 执行流程

```
Step 1: 读取技术方案，提取被测模块清单
Step 2: 分析源代码，理解实现细节
Step 3: 识别框架类型，确定测试策略
Step 4: 并行规范读取（2个subagent）
Step 5: 设计测试场景（主流程 + 边界 + 异常 + 自定义）
Step 6: 生成测试文件并写入 __tests__/ 目录
Step 7: 输出测试覆盖摘要
```

---

## Step 1：读取技术方案，提取被测模块清单

**技术方案来源（优先级顺序）**：
1. 用户提供了 `techdoc.md` 路径 → 直接读取
2. 当前目录下存在 `.catpaw/docs/*/techdoc.md` → 自动查找最近修改的一份
3. 用户直接描述了要测试的模块 → 跳过此步骤

从技术方案中提取：
- **新增/修改的组件列表**（React 组件 / Vue 组件）
- **新增/修改的工具函数、hooks、composables**
- **涉及的接口调用**（需要 mock 的 API）
- **涉及的状态管理**（Vuex/Pinia/Redux/Zustand store）
- **关键业务逻辑**（需要重点覆盖的核心流程）

---

## Step 2：分析源代码，理解实现细节

对每个被测模块，读取对应的源文件：

```bash
# 查找源文件（常见路径）
src/components/xxx.tsx
src/hooks/useXxx.ts
src/utils/xxx.ts
src/store/xxx.ts
src/pages/xxx/index.tsx
```

分析时重点关注：
- **函数签名**：入参类型、返回值类型、是否异步
- **外部依赖**：需要 mock 的模块（API 请求、路由、store、第三方库）
- **副作用**：DOM 操作、定时器、事件监听
- **条件分支**：if/else、switch、三元表达式（每个分支都需要测试）
- **错误处理**：try/catch、Promise.reject、错误边界

如果源文件不存在（技术方案中的模块尚未开发），根据技术方案中的接口设计和功能描述推断测试场景，生成「待实现」注释的测试骨架。

---

## Step 3：识别框架类型，确定测试策略

**自动识别框架**，按以下顺序判断：

| 判断依据 | 框架 | 测试工具 |
|---------|------|---------|
| `package.json` 中有 `react` / 文件扩展名 `.tsx` | React | `@testing-library/react` |
| `package.json` 中有 `vue` / 文件扩展名 `.vue` | Vue 3 | `@vue/test-utils` |
| 纯工具函数 / hooks（无 UI） | 通用 | 纯 Jest |
| 有 `gundam` / `mach` 相关依赖 | 内部框架 | 参考项目现有测试风格 |

读取 `assets/test-templates.md` 获取对应框架的测试模板。

**检查项目测试配置**：
```bash
# 查找 jest 配置
cat jest.config.js 2>/dev/null || cat jest.config.ts 2>/dev/null || cat package.json | grep jest
```

如果项目有自定义的 jest 配置（如 `moduleNameMapper`、`setupFilesAfterFramework`），在生成的测试文件中遵循这些配置。

---

## Step 4：并行规范读取（使用 subagent）

使用 Task 工具创建 2 个并行 subagent，读取测试规范：

### 4.1 Subagent 1: scenario-rules-reader

**任务**: 读取内置测试场景设计规范

**执行步骤**:
1. 读取 `references/test-scenarios.md` 获取完整的场景设计规范
2. 提取场景设计原则、命名规范、覆盖率要求等

**返回**:
```json
{
  "designPrinciples": "场景设计原则",
  "namingConvention": "命名规范",
  "coverageRequirements": "覆盖率要求",
  "bestPractices": "最佳实践",
  "happyPathGuidelines": "主流程场景设计指南",
  "edgeCaseGuidelines": "边界条件场景设计指南",
  "errorCaseGuidelines": "异常处理场景设计指南"
}
```

### 4.2 Subagent 2: custom-knowledge-collector

**任务**: 获取用户自定义测试规范

**执行步骤**:
1. 扫描项目 `.catpaw/skills/unit-test-generator/references/` 目录下的所有 `custom-*.md` 文件
2. 读取所有找到的自定义测试规范文件内容
3. 提取自定义测试场景、额外的边界条件、项目特定的测试要求、自定义 mock 规则等

**返回**:
```json
{
  "customScenarios": {
    "additionalTestCases": "额外测试场景",
    "projectSpecificRequirements": "项目特定要求",
    "customMockRules": "自定义 mock 规则"
  },
  "hasCustomKnowledge": true
}
```

---

## Step 5：设计测试场景

汇总 2 个 subagent 的返回结果，基于规范设计测试场景：

每个被测模块必须覆盖以下三类场景：

### 主流程场景（Happy Path）
- 正常输入 → 预期输出
- 核心业务逻辑的完整执行路径
- 用户最常见的操作流程

### 边界条件场景（Edge Cases）
- 空值 / null / undefined 输入
- 最小值 / 最大值（数字、字符串长度、数组长度）
- 空数组 / 空对象 / 空字符串
- 特殊字符、超长字符串
- 并发调用（如快速连续点击）

### 异常处理场景（Error Cases）
- API 请求失败（网络错误、4xx、5xx）
- 参数类型错误
- 权限不足
- 数据格式异常
- 组件卸载后的异步回调

### 自定义场景（Custom Cases）
- 基于用户自定义规范文件的额外测试场景
- 项目特定的测试要求
- 自定义 mock 规则验证

**应用规范**:
- 按照 scenario-rules-reader 返回的设计原则优化场景
- 整合 custom-knowledge-collector 返回的自定义测试要求

**场景命名规范**：
```
describe('模块名', () => {
  describe('功能点', () => {
    it('should [预期行为] when [条件]', ...)
    it('should [预期行为] when [边界条件]', ...)
    it('should [错误处理行为] when [异常条件]', ...)
  })
})
```

---

## Step 6：生成测试文件并写入 __tests__/ 目录

### 文件命名规则

```
# 源文件路径 → 测试文件路径
src/components/UserCard.tsx     → __tests__/components/UserCard.test.ts
src/hooks/useUserInfo.ts        → __tests__/hooks/useUserInfo.test.ts
src/utils/formatDate.ts         → __tests__/utils/formatDate.test.ts
src/store/userStore.ts          → __tests__/store/userStore.test.ts
src/pages/home/index.tsx        → __tests__/pages/home/index.test.ts
```

### 测试文件结构

```typescript
/**
 * @description [模块名] 单元测试
 * @module [源文件相对路径]
 * @techdoc [技术方案文件路径]（如有）
 */

// 1. 依赖导入
import { xxx } from '@/xxx'

// 2. Mock 声明（统一放在文件顶部）
jest.mock('@/api/xxx')
jest.mock('react-router-dom')

// 3. 测试数据工厂（避免在每个 it 中重复定义）
const createMockUser = (overrides = {}) => ({
  id: 1,
  name: 'test',
  ...overrides,
})

// 4. 测试套件
describe('[模块名]', () => {
  // 5. 公共 setup/teardown
  beforeEach(() => { ... })
  afterEach(() => { ... })

  // 6. 按功能点分组的测试用例
  describe('[功能点1]', () => {
    it('should ...', () => { ... })
  })
})
```

### Mock 规范

```typescript
// API Mock
import { getUserInfo } from '@/api/user'
jest.mock('@/api/user')
const mockGetUserInfo = getUserInfo as jest.MockedFunction<typeof getUserInfo>

// 在测试中设置返回值
mockGetUserInfo.mockResolvedValue({ id: 1, name: 'test' })
mockGetUserInfo.mockRejectedValue(new Error('Network Error'))

// 路由 Mock（React）
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useParams: () => ({ id: '123' }),
}))

// 定时器 Mock
jest.useFakeTimers()
jest.runAllTimers()
jest.useRealTimers()
```

### 创建目录并写入文件

```bash
# 确保目录存在
mkdir -p __tests__/[子目录]
```

然后将生成的测试内容写入对应文件。

---

## Step 7：输出测试覆盖摘要

所有文件写入完成后，在对话中输出摘要：

```
✅ 单测生成完成

📁 生成文件（共 N 个）：
  - __tests__/components/UserCard.test.ts（X 个测试用例）
  - __tests__/hooks/useUserInfo.test.ts（X 个测试用例）
  - ...

📊 场景覆盖：
  - 主流程：X 个
  - 边界条件：X 个
  - 异常处理：X 个
  - 自定义场景：X 个（如有）

🔧 需要手动处理：
  - [如有需要补充的 mock 或无法自动推断的场景，在此列出]

💡 运行测试：
  npx jest __tests__/[路径] --coverage
```

---

## 错误处理

- **源文件不存在**：生成测试骨架，用 `// TODO: 待源文件实现后补充` 注释标注无法推断的部分
- **框架无法识别**：询问用户确认框架类型，或生成通用 Jest 测试（不依赖 UI 测试库）
- **技术方案不存在**：直接分析用户指定的源文件，跳过 Step 1
- **__tests__/ 目录不存在**：自动创建
