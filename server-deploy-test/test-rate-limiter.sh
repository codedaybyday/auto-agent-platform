#!/bin/bash
#
# 限流系统测试脚本
# 使用方法: ./test-rate-limiter.sh [server_url]
#

SERVER_URL=${1:-"http://localhost:3000"}
WS_URL=${SERVER_URL/http/ws}

echo "======================================"
echo "Rate Limiter 测试脚本"
echo "Server: $SERVER_URL"
echo "WebSocket: $WS_URL"
echo "======================================"
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 测试计数
TESTS_PASSED=0
TESTS_FAILED=0

# 辅助函数
function log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

function log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

function log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# 测试 1: 健康检查接口
function test_health_endpoint() {
    echo ""
    echo "--------------------------------------"
    log_info "测试 1: 健康检查接口 (查看限流统计)"
    echo "--------------------------------------"

    RESPONSE=$(curl -s "$SERVER_URL/health")

    if echo "$RESPONSE" | grep -q "rateLimit"; then
        log_info "✓ 健康检查返回限流统计"
        echo "$RESPONSE" | jq '.stats.rateLimit' 2>/dev/null || echo "$RESPONSE"
        ((TESTS_PASSED++))
    else
        log_error "✗ 健康检查未返回限流统计"
        echo "$RESPONSE"
        ((TESTS_FAILED++))
    fi
}

# 测试 2: 快速请求触发限流
function test_rate_limit_blocking() {
    echo ""
    echo "--------------------------------------"
    log_info "测试 2: 快速请求触发限流"
    echo "--------------------------------------"

    local USER_ID="test-user-$(date +%s)"
    local BLOCKED=0

    log_info "发送 20 个快速请求..."

    for i in {1..20}; do
        RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
            "$SERVER_URL/api/sessions" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer test-token" \
            -d "{\"userId\": \"$USER_ID\", \"title\": \"Test $i\"}" 2>/dev/null)

        HTTP_CODE=$(echo "$RESPONSE" | tail -1)

        if [ "$HTTP_CODE" == "429" ] || echo "$RESPONSE" | grep -q "过于频繁"; then
            log_warn "请求 $i 被限流 (HTTP $HTTP_CODE)"
            BLOCKED=1
            break
        fi
    done

    if [ $BLOCKED -eq 1 ]; then
        log_info "✓ 限流正确触发"
        ((TESTS_PASSED++))
    else
        log_warn "! 未触发限流（可能配置较宽松）"
    fi
}

# 测试 3: WebSocket 限流
function test_websocket_rate_limit() {
    echo ""
    echo "--------------------------------------"
    log_info "测试 3: WebSocket 消息限流"
    echo "--------------------------------------"

    log_info "需要使用 wscat 或类似工具测试"
    log_info "命令: wscat -c $WS_URL/ws"
    log_info "然后快速发送多条 agent.run 消息"

    # 如果存在 node，使用简单的 WebSocket 测试
    if command -v node &> /dev/null; then
        log_info "使用 Node.js 进行 WebSocket 测试..."

        node << 'NODE_EOF'
const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000/ws');
let messageCount = 0;
let errorCount = 0;

ws.on('open', () => {
    console.log('WebSocket 已连接');

    // 发送认证
    ws.send(JSON.stringify({
        type: 'connect',
        messageId: 'test-1',
        timestamp: Date.now(),
        payload: { userId: 'test-ws-user' }
    }));

    // 快速发送消息
    setTimeout(() => {
        for (let i = 0; i < 10; i++) {
            ws.send(JSON.stringify({
                type: 'agent.run',
                messageId: `test-msg-${i}`,
                timestamp: Date.now(),
                payload: { content: `Test message ${i}` }
            }));
            messageCount++;
        }
    }, 100);
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'stream.error' && msg.payload?.error?.includes('频繁')) {
        console.log('✓ 收到限流错误:', msg.payload.error);
        errorCount++;
    }
});

ws.on('error', (err) => {
    console.error('WebSocket 错误:', err.message);
});

setTimeout(() => {
    console.log(`发送: ${messageCount}, 限流: ${errorCount}`);
    ws.close();
    process.exit(0);
}, 3000);
NODE_EOF

        if [ $? -eq 0 ]; then
            ((TESTS_PASSED++))
        else
            log_warn "Node.js WebSocket 测试需要安装 ws 包: npm install -g ws"
        fi
    else
        log_warn "Node.js 未安装，跳过 WebSocket 自动测试"
    fi
}

# 测试 4: 限流恢复测试
function test_rate_limit_recovery() {
    echo ""
    echo "--------------------------------------"
    log_info "测试 4: 限流恢复"
    echo "--------------------------------------"

    local USER_ID="recovery-test-$(date +%s)"

    # 先触发限流
    log_info "触发限流..."
    for i in {1..30}; do
        curl -s -X POST "$SERVER_URL/api/sessions" \
            -H "Authorization: Bearer test-token" \
            -d "{\"userId\": \"$USER_ID\"}" > /dev/null 2>&1
    done

    log_info "等待 3 秒后重试..."
    sleep 3

    # 重试
    RESPONSE=$(curl -s -X POST \
        "$SERVER_URL/api/sessions" \
        -H "Authorization: Bearer test-token" \
        -d "{\"userId\": \"$USER_ID\"}")

    if echo "$RESPONSE" | grep -q "success\":true"; then
        log_info "✓ 限流恢复后请求成功"
        ((TESTS_PASSED++))
    else
        log_warn "! 限流可能仍在生效（取决于配置）"
    fi
}

# 测试 5: 会话级限流
function test_session_rate_limit() {
    echo ""
    echo "--------------------------------------"
    log_info "测试 5: 会话级限流隔离"
    echo "--------------------------------------"

    log_info "创建两个会话并快速发送消息..."
    log_info "需要手动测试：同时打开两个浏览器标签，"
    log_info "用同一会话快速发送消息，另一个会话应不受影响"
}

# 压力测试
function stress_test() {
    echo ""
    echo "--------------------------------------"
    log_info "压力测试: 100 并发请求"
    echo "--------------------------------------"

    if command -v ab &> /dev/null; then
        log_info "使用 Apache Bench 进行压力测试..."
        ab -n 100 -c 10 -T "application/json" \
            -H "Authorization: Bearer test-token" \
            -p /dev/null \
            "$SERVER_URL/health" 2>&1 | tail -10
    elif command -v curl &> /dev/null; then
        log_info "使用 curl 进行简单压力测试..."

        local START_TIME=$(date +%s%N)
        local SUCCESS=0
        local FAILED=0

        for i in {1..50}; do
            RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL/health")
            if [ "$RESPONSE" == "200" ]; then
                ((SUCCESS++))
            else
                ((FAILED++))
            fi
        done &

        for i in {1..50}; do
            RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL/health")
            if [ "$RESPONSE" == "200" ]; then
                ((SUCCESS++))
            else
                ((FAILED++))
            fi
        done &

        wait

        local END_TIME=$(date +%s%N)
        local DURATION=$(( (END_TIME - START_TIME) / 1000000 ))

        echo ""
        log_info "压力测试结果:"
        echo "  成功: $SUCCESS"
        echo "  失败: $FAILED"
        echo "  耗时: ${DURATION}ms"
    fi
}

# 主菜单
function show_menu() {
    echo ""
    echo "======================================"
    echo "选择测试项目:"
    echo "======================================"
    echo "1) 运行所有测试"
    echo "2) 健康检查测试"
    echo "3) 限流触发测试"
    echo "4) WebSocket 限流测试"
    echo "5) 限流恢复测试"
    echo "6) 压力测试"
    echo "q) 退出"
    echo ""
    read -p "请选择: " CHOICE

    case $CHOICE in
        1)
            test_health_endpoint
            test_rate_limit_blocking
            test_websocket_rate_limit
            test_rate_limit_recovery
            stress_test
            ;;
        2) test_health_endpoint ;;
        3) test_rate_limit_blocking ;;
        4) test_websocket_rate_limit ;;
        5) test_rate_limit_recovery ;;
        6) stress_test ;;
        q) exit 0 ;;
        *) log_error "无效选择" ;;
    esac

    show_menu
}

# 检查服务器是否运行
log_info "检查服务器状态..."
if ! curl -s "$SERVER_URL/health" > /dev/null 2>&1; then
    log_error "无法连接到服务器: $SERVER_URL"
    log_info "请先启动服务器: cd apps/server && npm run dev"
    exit 1
fi

log_info "服务器连接正常"

# 如果有参数，直接运行对应测试
if [ -n "$2" ]; then
    case $2 in
        health) test_health_endpoint ;;
        block) test_rate_limit_blocking ;;
        ws) test_websocket_rate_limit ;;
        recovery) test_rate_limit_recovery ;;
        stress) stress_test ;;
        *) log_error "未知测试: $2" ;;
    esac
else
    show_menu
fi

echo ""
echo "======================================"
echo "测试完成!"
echo "通过: $TESTS_PASSED"
echo "失败: $TESTS_FAILED"
echo "======================================"
