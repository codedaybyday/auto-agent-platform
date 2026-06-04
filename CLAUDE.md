# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Auto Agent Platform is an AI assistant platform with multi-model support and Agent Loop capabilities. It uses a monorepo structure with:

- **apps/client**: Electron desktop app (React + Playwright)
- **apps/server**: Node.js backend (Express + WebSocket)
- **packages/shared-types**: Shared TypeScript types
- **packages/shared-utils**: Shared utilities (logging, helpers)

## Architecture

### Three-Layer Communication

```
Renderer (UI) ←→ Main Process (Browser/Bash tools) ←→ Server (Agent Loop) ←→ LLM
     IPC               WebSocket                            HTTP API
```

### Key Components

1. **Agent Loop** (`apps/server/src/services/agent/`): ReAct pattern implementation
   - `loop.ts`: Main agent orchestration
   - `bridge.ts`: Tool execution bridge
   - `parser.ts`: LLM response parsing

2. **Browser Automation** (`apps/client/src/main/tools/browser-use/`): CDP-based browser control
   - `dom-service.ts`: DOM state extraction via CDP
   - `controller.ts`: Browser action execution
   - `dom-state.ts`: Element tree and state types

3. **Memory Management** (`apps/server/src/services/memory/`): Tiered storage
   - Tier 1: Recent 5 rounds (full context)
   - Tier 2: Compressed historical context

## Common Commands

### Development

```bash
# Install dependencies
pnpm install

# Start both client and server
pnpm dev

# Start individually
pnpm dev:client  # Electron app
pnpm dev:server  # Node.js backend

# Build all packages
pnpm build

# Type checking
pnpm type-check
```

### Working with Specific Apps

```bash
# Client (Electron)
cd apps/client
pnpm dev          # Start dev mode
pnpm build        # Build for production
pnpm type-check   # Check TypeScript

# Server (Node.js)
cd apps/server
pnpm dev          # Start with tsx watch
pnpm build        # Build with tsup
pnpm start        # Run built version
```

## Key Files and Locations

### Configuration
- `apps/server/.env`: LLM API configuration (copy from .env.example)
- `pnpm-workspace.yaml`: Monorepo workspace definition
- `turbo.json`: Build pipeline configuration

### Browser Tool Implementation
- `apps/client/src/main/tools/browser-use/dom/dom-service.ts`: CDP DOM extraction
- `apps/client/src/main/tools/browser-use/core/controller.ts`: Action execution
- `apps/server/src/services/llm/parser.ts`: LLM response parsing for browser actions

### Tool Execution Flow
1. LLM decides action → Server sends via WebSocket
2. Main process receives → Executes via Playwright/CDP
3. Result returned → Server evaluates progress

## Browser Automation Design

The project implements a browser-use style approach:

1. **DOM Extraction**: Uses CDP `DOMSnapshot.captureSnapshot` + `Accessibility.getFullAXTree`
2. **Element Detection**: Combines AX Tree roles with DOM attributes
3. **Action Execution**: Coordinate-based clicking (more reliable than selectors)
4. **State Management**: `DOMState` contains element tree with bounding boxes

### Important Notes

- Browser connects to port 9222 (CDP)
- Chrome must be running separately or pre-launched
- SSO login state is inherited from system Chrome
- New tabs start as `about:blank` - must navigate before DOM extraction

## Claude Commands

This project includes a custom Claude command:

- `/analyze-logs`: Analyze server.log and client.log for errors and performance

## Troubleshooting

### Common Issues

1. **Blank page DOM**: New tabs start empty. Must navigate before extracting DOM.
2. **CDP connection**: Ensure Chrome is running on port 9222 or BrowserManager prelaunch is working.
3. **Type errors**: shared-utils must be built before other packages (composite: true in tsconfig).

### Logs Location
- `client.log`: Client-side logs (main process)
- `server.log`: Server-side logs (Node.js backend)
- Apps output to stdout/stderr in dev mode

## 错误处理协议

### 绝对禁止的行为
- ❌ **严禁猜测式修复**：不确定根因就修改代码
- ❌ **严禁跳过根因分析**：无论错误多简单，必须先分析
- ❌ **严禁在第一次修改失败后，盲目尝试第二次**（必须重新分析）

### 强制执行的流程
当遇到错误时，Claude 必须：

1. **先读日志、再分析、后修改**（RCA 优先）
2. **如果一次修改不成功**：
   - 不要立即尝试第二种方案
   - 必须输出：`第一次修改失败，重新分析...`
   - 重新执行根因分析，说明为什么第一个方案无效
3. **禁止兜底**：
   - 不要用 try-catch 吞掉错误（除非明确要求）
   - 不要为了“让程序继续运行”而忽略错误
   - 不允许说“这可能是...”或“大概率是...”（必须说“根因是...”）

当需要优化时，Claude 必须：

1. **先参考开源的最佳实现**：如果开源最佳实现已经满足需求，则直接使用
2. **先设计方案**：如果开源最佳实现不满足需求，则先设计方案

### 输出格式要求
报告错误时使用模板：
