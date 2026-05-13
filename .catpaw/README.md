# Spec Workflow 配置目录

此目录由 `spec-workflow init` 命令生成，包含 Spec Workflow 工作流的所有配置文件。

## 目录结构

```
.catpaw/
├── commands/          # 斜杠命令定义
│   ├── 00 环境检测.md
│   ├── 01 仅需求解析.md
│   ├── 02 仅需求评审.md
│   ├── 03 UI设计稿确认.md
│   ├── 04 仅技术方案生成.md
│   ├── 05 仅技术方案评审.md
│   ├── 06 单测生成.md
│   ├── 07 任务拆分.md
│   ├── 08 代码开发.md
│   ├── 09 监控埋点上报.md
│   ├── 10 代码CR.md
│   ├── 10 知识库同步.md
│   ├── 11 AI编码统计上报.md
│   ├── 12 PR发起.md
│   ├── 13 环境部署.md
│   ├── 技术方案生成-评审-修复.md
│   └── 需求自动解析-评审-修复.md
├── mcp.json           # MCP 默认配置
├── hooks.json         # Agent 钩子配置
└── skills/            # Agent 技能模块
    ├── code-review-analyzer/      # 代码评审分析
    ├── ingee-batch-analyzer/      # 印迹设计稿批量解析
    ├── layered-knowledge-builder/ # 分层知识库构建
    ├── logic-driven-development/  # 逻辑驱动开发流程
    ├── mastergo-batch-analyzer/   # MasterGo 设计稿批量解析
    ├── mastergo-extractor/        # MasterGo 单模块提取
    ├── mep-code/                  # MEP 代码开发
    ├── mep-talos/                # MEP Talos 部署
    ├── module-code-review/        # 单模块代码评审
    ├── prd-parser/               # PRD 需求文档解析
    ├── prd-reviewer/             # PRD 需求文档评审
    ├── skill-evolver/            # Skill 自动进化
    ├── spec-coding-stats/        # AI 编码统计
    ├── task-splitter/            # 任务拆分
    ├── techdoc-generator/        # 技术方案生成
    ├── techdoc-reviewer/         # 技术方案评审
    ├── ui-design-analyzer/       # UI 设计稿分析
    ├── ui-driven-development/    # UI 驱动开发流程
    └── unit-test-generator/      # 单元测试生成
```

## 常用命令

```bash
# 初始化项目配置
spec-workflow init

# 更新配置（保留自定义扩展）
spec-workflow update
```

- spec-workflow 提供以下两个命令
  1. spec-workflow init 初始化
  2. spec-workflow update 在原有规则基础上进行更新
- 业务可以根据在相应目录下填充自己的自定义内容

## 如何扩展

### 1. 扩展 Skill

每个 skill 目录下包含：

- `SKILL.md` - 技能定义文件（必需）
- `references/` - 参考文档目录（可选）
- `assets/` - 模板和资源文件目录（可选）

#### 1.1 添加参考文档

在 skill 的 `references/` 目录下创建 `custom-*.md` 文件：

```
skills/prd-parser/references/custom-business.md
skills/modular-developer/references/custom-style.md
```

`spec-workflow update` 时会自动保留这些文件。

#### 1.2 添加模板资源

在 skill 的 `assets/` 目录下添加 `prd-template.md` 文件，**会替换**官方默认模板：

```
skills/prd-parser/assets/
└── prd-template.md    # 替换默认 PRD 模板
```

> **注意**：
> - 自定义模板会完全替换官方模板，请确保模板内容完整
> - `spec-workflow update` 时会保留 `assets/` 目录下的所有文件

### 2. 添加自定义 Command

在 `.catpaw/custom/commands/` 目录下创建 `.md` 文件，定义自定义斜杠命令：

```
.catpaw/custom/commands/
├── 90 营销发布流程.md     # 自定义命令（组合调用官方 skill）
├── 91 数据同步流程.md
└── 92 业务审核流程.md      # 使用 90-99 前缀，会被保留
```

**命名规范**：
- 官方命令：00-13 数字编号开头（如 `00 环境检测.md`）
- 自定义命令：使用 90-99 前缀（如 `90 营销发布流程.md`）

**文件格式**：

```markdown
# 命令标题

命令描述...

## 执行步骤

1. 步骤一（调用官方 skill）
2. 步骤二
...
```

> **注意**：
> - 自定义命令通过组合调用官方 skill 来编排业务特有流程

### 3. 修改 MCP 配置

编辑 `mcp.json` 添加或修改 MCP 服务器配置。

## 更多文档

- [Spec Workflow 使用指南](https://km.sankuai.com/collabpage/2753245425)
- [接入流程](https://km.sankuai.com/collabpage/2751411174)
- [意见反馈](https://km.sankuai.com/collabpage/2752565659)
