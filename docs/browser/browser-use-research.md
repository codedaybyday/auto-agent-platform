# Browser-Use 主流方案调研

## 当前项目状态

目前使用 **Playwright** 实现基础的浏览器控制：
- 导航、点击、输入、截图、获取文本、滚动、等待
- 非 headless 模式（显示浏览器窗口）
- 单页面状态保持

---

## 主流方案对比

### 1. Playwright（当前使用）

**官网**: https://playwright.dev

**特点**:
- 微软出品，更新活跃
- 支持 Chromium、Firefox、WebKit
- 自动等待、网络拦截、截图、录屏
- 强大的选择器引擎（text、CSS、XPath）

**优点**:
- ✅ 社区活跃，文档完善
- ✅ 支持多浏览器
- ✅ 内置自动等待，减少 flaky tests
- ✅ 强大的调试工具（trace viewer、codegen）

**缺点**:
- ❌ 与 AI Agent 集成需要自行封装
- ❌ 没有内置的 AI 感知能力（如理解页面结构）

**适用场景**: 通用浏览器自动化，测试脚本

---

### 2. Puppeteer

**官网**: https://pptr.dev

**特点**:
- Google Chrome 团队出品
- 只支持 Chromium
- DevTools Protocol 封装

**优点**:
- ✅ Chrome 生态最完善
- ✅ 启动速度快
- ✅ 占用资源少

**缺点**:
- ❌ 只支持 Chromium
- ❌ 更新频率低于 Playwright
- ❌ 自动等待能力较弱

**适用场景**: 纯 Chrome 环境，简单自动化

---

### 3. Browser-Use（AI 专用）

**GitHub**: https://github.com/browser-use/browser-use

**特点**:
- 专门为 AI Agent 设计
- 基于 Playwright
- 提供高层次的语义化接口

**核心功能**:
```python
from browser_use import Agent

agent = Agent(
    task="查找今天的新闻",
    llm=openai_client
)
result = await agent.run()
```

**优点**:
- ✅ 专为 AI 设计，理解自然语言任务
- ✅ 自动处理表单、点击、滚动
- ✅ 支持多步骤任务规划
- ✅ 内置页面内容提取（LLM 友好格式）

**缺点**:
- ❌ 较新的项目，社区较小
- ❌ 主要支持 Python，Node.js 支持有限

**适用场景**: AI Agent 项目，需要自然语言控制浏览器

---

### 4. Stagehand

**GitHub**: https://github.com/browserbase/stagehand

**特点**:
- 由 Browserbase 出品
- 专为 AI 设计的浏览器自动化
- 支持 "act", "extract", "observe" 三种模式

**核心功能**:
```typescript
import { Stagehand } from "@browserbasehq/stagehand";

const stagehand = new Stagehand({
  env: "LOCAL", // 或 "BROWSERBASE" 使用云端浏览器
});

await stagehand.init();

// AI 执行操作
await stagehand.page.act("点击登录按钮");

// AI 提取数据
const data = await stagehand.page.extract({
  instruction: "提取所有商品名称和价格",
  schema: z.object({
    items: z.array(z.object({
      name: z.string(),
      price: z.number()
    }))
  })
});

// AI 观察页面
const observation = await stagehand.page.observe(
  "找到搜索框的位置"
);
```

**优点**:
- ✅ TypeScript 原生支持
- ✅ 自然语言操作页面
- ✅ 结构化数据提取（带 schema 验证）
- ✅ 支持云端浏览器（Browserbase）
- ✅ 支持本地和云端两种模式

**缺点**:
- ❌ 依赖 OpenAI 等 LLM（需要 API key）
- ❌ 较新的项目，API 可能变化

**适用场景**: TypeScript/Node.js AI 项目，需要自然语言控制

---

### 5. Anthropic Computer Use（官方方案）

**文档**: https://docs.anthropic.com/en/docs/build-with-claude/computer-use

**特点**:
- Claude 官方提供的计算机控制能力
- 支持浏览器、命令行、文件操作
- 基于截图和坐标点击

**工作原理**:
1. 截图当前屏幕
2. 发送给 Claude 分析
3. Claude 返回操作指令（点击、输入等）
4. 执行操作并重复

**优点**:
- ✅ 与 Claude 深度集成
- ✅ 无需编写复杂的选择器
- ✅ 支持整个桌面环境（不只是浏览器）

**缺点**:
- ❌ 只支持 Claude 模型
- ❌ 基于截图，成本较高（token 消耗大）
- ❌ 速度较慢（每步都需要截图和 LLM 调用）
- ❌ 精度依赖截图质量

**适用场景**: 使用 Claude 的项目，需要通用计算机控制

---

### 6. Crawlee + Playwright

**官网**: https://crawlee.dev

**特点**:
- 由 Apify 出品
- 专业的网页爬取框架
- 内置 Playwright 集成

**优点**:
- ✅ 专业的爬取能力（队列、存储、代理轮换）
- ✅ 自动缩放、错误重试
- ✅ 数据集导出

**缺点**:
- ❌ 学习曲线较陡
- ❌ 偏重爬虫场景

**适用场景**: 大规模网页爬取、数据采集

---

### 7. OpenClaw Browser（企业级方案）

**GitHub**: https://github.com/openclaw-ai/openclaw

**特点**:
- 企业级浏览器自动化系统
- 双驱动架构：Playwright Core + Chrome MCP
- 三目标执行：sandbox / host / node
- 完整的安全模型和 SSRF 防护
- 17 种 Action + 12 种 act kind

**核心架构**:
```
OpenClaw Browser-Use 架构
    │
    ├─ 工具入口: browser tool (17 actions, 12 act kinds)
    │
    ├─ 双驱动引擎
    │   ├─ Playwright Core → 隔离浏览器 (openclaw profile)
    │   └─ Chrome MCP → 用户浏览器 (user profile, chrome-devtools-mcp)
    │
    ├─ 三目标执行
    │   ├─ sandbox → Docker 内浏览器
    │   ├─ host → 网关本机浏览器
    │   └─ node → 远程节点浏览器代理
    │
    ├─ 安全层
    │   ├─ SSRF 防护（导航策略、重定向链检查、私有网络阻断）
    │   ├─ 认证授权（CDP token、网关 auth、bridge auth）
    │   └─ 安全审计（配置检查、暴露风险评估）
    │
    ├─ 感知层
    │   ├─ Snapshot (role/aria/ai 三种格式)
    │   ├─ Screenshot (png/jpeg, 全页/元素级)
    │   └─ Console/Network 监控
    │
    └─ 交互层
        ├─ 12 种 act kind
        ├─ 表单填充、文件上传
        ├─ Dialog 处理
        └─ JS evaluate
```

**Snapshot 系统（AI 感知核心）**:
| 格式 | 说明 | 适用场景 |
|------|------|---------|
| role | 基于 role+name 的元素引用（e12） | 通用 UI 自动化 |
| aria | Playwright aria-ref id（ax5） | 跨调用稳定引用 |
| ai | AI 优化的页面结构描述 | LLM 理解页面语义 |

**17 种 Actions**:
- 生命周期：`doctor`, `status`, `start`, `stop`
- Profile：`profiles`（多配置文件管理）
- Tab 管理：`tabs`, `open`, `focus`, `close`
- 页面观察：`snapshot`, `screenshot`, `console`
- 导航：`navigate`
- 交互：`act`（12 种 kind）
- 文件操作：`upload`, `pdf`, `dialog`

**12 种 act kind**:
```
click | clickCoords | type | press | hover | drag | select | fill | resize | wait | evaluate | close
```

**安全模型**:
- SSRF 防护：navigation-guard + ssrf-policy-helpers
- 私有网络阻断：默认禁止访问内网地址
- 重定向链检查：完整检查导航重定向链
- 主机名白名单：allowedHostnames 配置
- CDP 认证：token/password/none/trusted-proxy 多模式
- 安全审计：自动化配置检查和暴露风险评估

**优点**:
- ✅ 企业级安全（SSRF 防护、认证体系、安全审计）
- ✅ 双驱动灵活切换（隔离浏览器/用户浏览器）
- ✅ 三目标执行（本地/远程/沙箱）
- ✅ 强大的 Snapshot 系统（role/aria/ai 三种格式）
- ✅ 远程 Node 代理（自动发现和能力路由）
- ✅ Tab 生命周期追踪（session 绑定）
- ✅ 完整的 CLI 工具链

**缺点**:
- ❌ 架构复杂，学习曲线较陡
- ❌ 主要面向企业级场景
- ❌ 社区相对较小（较新的项目）

**适用场景**: 企业级 AI Agent 平台，需要高安全性和多环境部署

---

## 方案对比矩阵

| 方案 | AI 友好度 | 语言 | 云端支持 | 学习曲线 | 社区活跃度 | 安全等级 |
|------|----------|------|---------|---------|-----------|---------|
| Playwright | ⭐⭐ | TS/JS/Python | ❌ | 中 | 高 | ⭐⭐ |
| Puppeteer | ⭐ | TS/JS | ❌ | 低 | 中 | ⭐⭐ |
| Browser-Use | ⭐⭐⭐⭐⭐ | Python | ❌ | 低 | 低（新兴） | ⭐⭐⭐ |
| Stagehand | ⭐⭐⭐⭐⭐ | TS/JS | ✅ | 低 | 低（新兴） | ⭐⭐⭐ |
| Anthropic CU | ⭐⭐⭐⭐ | 多语言 | ❌ | 中 | 中 | ⭐⭐⭐ |
| Crawlee | ⭐⭐ | TS/JS | ✅ | 高 | 中 | ⭐⭐ |
| **OpenClaw** | ⭐⭐⭐⭐⭐ | TS/JS | ✅ | 高 | 低 | ⭐⭐⭐⭐⭐ |

---

## 推荐方案

### 方案 A: 继续使用 Playwright + 自建封装（推荐当前阶段）

**适用场景**: 项目已使用 Playwright，功能需求不复杂

**改进方向**（借鉴 OpenClaw 设计）:
1. **语义化接口**: 自然语言描述操作
2. **Snapshot 系统**: 三种格式（简洁/aria/AI优化）提取页面结构
3. **智能元素定位**: 基于文本、role、placeholder 多重策略
4. **安全层**: URL 校验、私有网络阻断、SSRF 防护
5. **操作历史**: 追踪执行步骤便于调试和重试

**已实现功能**:
```typescript
// 语义化操作
await browserAI.semanticAct("搜索 TypeScript 教程");
await browserAI.semanticAct("点击登录按钮");
await browserAI.semanticAct("在搜索框输入关键词");

// 页面分析
const analysis = await browserAI.analyzePage();
// 返回结构化页面信息：interactiveElements、forms、links、headings

// 智能数据提取
const data = await browserAI.extractData({
  title: { selector: "h1" },
  links: { selector: "a.article-link", multiple: true, attribute: "href" }
});

// 页面摘要（用于 LLM 上下文）
const summary = await browserAI.getPageSummary();
```

---

### 方案 B: 迁移到 Stagehand（推荐 AI 优先项目）

**适用场景**: 项目以 AI 为核心，需要自然语言控制浏览器

**迁移步骤**:
1. 安装 `@browserbasehq/stagehand`
2. 替换 BrowserTool 实现
3. 配置 LLM 客户端
4. 调整工具调用接口

**优点**:
- 原生 AI 支持
- TypeScript 友好
- 可选择本地或云端浏览器

---

### 方案 C: 参考 OpenClaw 构建企业级方案（长期推荐）

**架构**（受 OpenClaw 启发）:
```
Agent Loop
    ↓
Browser Controller（封装层）
    ├─ 安全层：URL 校验、SSRF 防护、导航策略
    ├─ 感知层：Snapshot（role/aria/ai）、Screenshot
    ├─ 交互层：语义化 act、表单填充、文件上传
    └─ 执行层：
        ├─→ Playwright（隔离浏览器）
        └─→ Chrome MCP（用户浏览器附加）
```

**借鉴 OpenClaw 的核心能力**:
| 能力 | 实现建议 | 优先级 |
|------|---------|--------|
| **Snapshot 系统** | 三种格式（role/aria/ai）提取页面结构 | 高 |
| **元素引用稳定化** | 使用 aria-ref 替代动态选择器 | 高 |
| **安全模型** | URL 白名单、私有网络阻断 | 中 |
| **多 Profile** | 支持隔离/用户浏览器切换 | 低 |
| **远程执行** | Node 代理模式 | 低 |

---

## 下一步建议

1. **已完成**: ✅ 基础语义化封装 (`browser-ai.ts`)
2. **短期（本周）**: 添加 Snapshot 系统和元素稳定引用
3. **中期（下周）**: 实现基础安全层（URL 校验、SSRF 防护）
4. **长期（后续）**: 根据使用场景选择是否引入 Stagehand 或参考 OpenClaw 完善

已实现 **方案 A** 的基础语义化封装，位于 `apps/client/src/main/tools/browser-ai.ts`。
