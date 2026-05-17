#!/usr/bin/env bash
# dev.sh - 在两个终端窗口分别启动 server 和 client
# 用法: ./scripts/dev.sh 或 pnpm dev

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# 颜色定义
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${GREEN}🚀 Auto Agent Platform - Dev Mode${NC}"
echo -e "${CYAN}   Project: ${PROJECT_DIR}${NC}"
echo ""

# 先构建依赖包（确保 shared-types/shared-utils 产物就绪）
echo -e "${GREEN}📦 Building dependencies...${NC}"
pnpm turbo run build --filter=@auto-agent/shared-types --filter=@auto-agent/shared-utils
echo ""

# 检测终端类型，选择打开新窗口的方式
open_terminal() {
  local title="$1"
  local command="$2"

  if [[ "$TERM_PROGRAM" == "iTerm.app" ]]; then
    # iTerm2: 用 osascript 打开新标签页
    osascript -e "
      tell application \"iTerm\"
        activate
        tell current window
          set newTab to (create tab with default profile)
          tell current session of newTab
            write text \"cd ${PROJECT_DIR} && ${command}\"
          end tell
        end tell
      end tell
    "
  elif [[ "$TERM_PROGRAM" == "vscode" ]] || [[ -n "$VSCODE_GIT_IPC_HANDLE" ]]; then
    # VS Code 终端: 无法直接开新窗口，用后台方式分别输出
    echo -e "${CYAN}📝 VS Code terminal detected, running in background${NC}"
    echo -e "${CYAN}   Server logs: ${PROJECT_DIR}/.dev-server.log${NC}"
    echo -e "${CYAN}   Client logs: ${PROJECT_DIR}/.dev-client.log${NC}"
    echo ""
    nohup pnpm dev:server > "${PROJECT_DIR}/.dev-server.log" 2>&1 &
    SERVER_PID=$!
    nohup pnpm dev:client > "${PROJECT_DIR}/.dev-client.log" 2>&1 &
    CLIENT_PID=$!
    echo -e "${GREEN}✅ Server PID: ${SERVER_PID}${NC}"
    echo -e "${GREEN}✅ Client PID: ${CLIENT_PID}${NC}"
    echo ""
    echo -e "📋 View logs:"
    echo -e "   tail -f ${PROJECT_DIR}/.dev-server.log"
    echo -e "   tail -f ${PROJECT_DIR}/.dev-client.log"
    echo ""
    echo -e "🛑 Stop all:"
    echo -e "   kill ${SERVER_PID} ${CLIENT_PID}"
    # 等待子进程
    wait
    return
  else
    # macOS 默认 Terminal.app
    osascript -e "
      tell application \"Terminal\"
        activate
        set newTab to do script \"cd ${PROJECT_DIR} && ${command}\"
        set custom title of front window to \"${title}\"
      end tell
    "
  fi
}

echo -e "${GREEN}🖥️  Starting Server (Terminal 1)...${NC}"
open_terminal "Auto Agent - Server" "pnpm dev:server; exec zsh"

sleep 1

echo -e "${GREEN}🖥️  Starting Client (Terminal 2)...${NC}"
open_terminal "Auto Agent - Client" "pnpm dev:client; exec zsh"

echo ""
echo -e "${GREEN}✅ Dev environment launched in separate terminals!${NC}"
echo -e "   ${CYAN}Terminal 1: Server (tsx watch)${NC}"
echo -e "   ${CYAN}Terminal 2: Client (electron-vite)${NC}"
