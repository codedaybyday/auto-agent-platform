# CLAUDE.md

Auto Agent Platform - AI assistant with Agent Loop capabilities.

## Quick Start

```bash
pnpm dev              # Start both client and server
pnpm dev:client       # Electron only
pnpm dev:server       # Server only
```

## Mandatory

### Forbidden
1. No guess fixes - RCA first
2. No skip analysis - RCA always
3. No blind retry - Re-analyze after failure

### Process
- **Bug**: Logs → RCA → Fix → Verify
- **Feature**: Analysis → Design → Confirm → Implement
- **Optimize**: Best practice → Design → Implement

### Design Principles
1. **Accuracy**: Changes must be controllable
2. **Extensibility**: Extract common patterns, avoid case-by-case
