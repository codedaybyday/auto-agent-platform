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

## 禁区
1. 禁止猜测式修复 - 不确定根因就改代码 2
2. 禁止跳过分析 - 无论多简单都要先RCA
3. 禁止盲目重试 - 第一次改失败必须重新分析，不能立即试第二方案

## 强制流程

### 遇到错误时：
1. 读日志 → 分析根因 → 修改代码（RCA优先）
2. 修改失败 → 输出"第一次修改失败，重新分析..." → 说明为什么第一方案无效
3. 禁止try-catch兜底、禁止说"可能是..."、必须说"根因是..."

### 需要优化时：
1. 优先参考开源最佳实现
2. 开源实现不够 → 先设计方案再实施

### 新增需求时：
1. 需求分析 - 明确模糊点
2. 方案设计 - 全局分析整条链路，需经用户确认
3. 实施 - 用户确认后才修改

### 方案设计原则：
1. 准确性 - 修改影响可控（如加流式输出需删非流式）
2. 可扩展性 - 禁止case by case，提取共性给通用方案
