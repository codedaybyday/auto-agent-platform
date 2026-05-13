#!/bin/bash

# invoke-skill.sh - 通用 Skill 调用脚本
# 用法: ./invoke-skill.sh <skill-name> [skill-args...]

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查参数
if [ $# -eq 0 ]; then
    echo "用法: $0 <skill-name> [skill-args...]"
    echo ""
    echo "示例:"
    echo "  $0 design-alignment"
    echo "  $0 ui-driven-development T05"
    echo "  $0 logic-driven-development T03"
    exit 1
fi

SKILL_NAME=$1
shift
SKILL_ARGS="$@"

# 查找 skill 目录
SKILL_DIR=""

# 方法 1: 直接路径
if [ -d ".catpaw/skills/${SKILL_NAME}" ] && [ -f ".catpaw/skills/${SKILL_NAME}/SKILL.md" ]; then
    SKILL_DIR=".catpaw/skills/${SKILL_NAME}"
fi

# 方法 2: 遍历 skills 目录
if [ -z "$SKILL_DIR" ] && [ -d ".catpaw/skills" ]; then
    for dir in .catpaw/skills/*/; do
        [ -d "$dir" ] || continue
        skill_name=$(basename "$dir")
        if [ "$skill_name" = "$SKILL_NAME" ] && [ -f "${dir}SKILL.md" ]; then
            SKILL_DIR="${dir%/}"
            break
        fi
    done
fi

# 方法 3: 在项目根目录查找
if [ -z "$SKILL_DIR" ]; then
    PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
    if [ -d "$PROJECT_ROOT/.catpaw/skills/${SKILL_NAME}" ] && [ -f "$PROJECT_ROOT/.catpaw/skills/${SKILL_NAME}/SKILL.md" ]; then
        SKILL_DIR="$PROJECT_ROOT/.catpaw/skills/${SKILL_NAME}"
    elif [ -d "$PROJECT_ROOT/.catpaw/skills" ]; then
        for dir in "$PROJECT_ROOT/.catpaw/skills"/*/; do
            [ -d "$dir" ] || continue
            skill_name=$(basename "$dir")
            if [ "$skill_name" = "$SKILL_NAME" ] && [ -f "${dir}SKILL.md" ]; then
                SKILL_DIR="${dir%/}"
                break
            fi
        done
    fi
fi

# 检查是否找到
if [ -z "$SKILL_DIR" ]; then
    echo -e "${YELLOW}❌ 未找到 skill: ${SKILL_NAME}${NC}"
    echo ""
    echo "可用的 skill:"
    if [ -d ".catpaw/skills" ]; then
        for dir in .catpaw/skills/*/; do
            [ -d "$dir" ] || continue
            if [ -f "${dir}SKILL.md" ]; then
                skill_name=$(basename "$dir")
                echo "  - $skill_name"
            fi
        done
    fi
    exit 1
fi

SKILL_FILE="${SKILL_DIR}/SKILL.md"

# 输出分隔线
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🎯 Skill: ${SKILL_NAME}${NC}"
if [ -n "$SKILL_ARGS" ]; then
    echo -e "${GREEN}📝 参数: ${SKILL_ARGS}${NC}"
fi
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 读取并输出 SKILL.md
if [ -f "$SKILL_FILE" ]; then
    # 提取 YAML frontmatter 中的 name 和 description
    NAME=$(sed -n '/^---$/,/^---$/p' "$SKILL_FILE" | grep '^name:' | sed 's/name: *//')
    DESC=$(sed -n '/^---$/,/^---$/p' "$SKILL_FILE" | grep '^description:' | sed 's/description: *//')

    echo -e "${GREEN}名称:${NC} $NAME"
    echo -e "${GREEN}描述:${NC} ${DESC:0:100}..."
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    # 输出完整内容(跳过 frontmatter)
    echo -e "${YELLOW}📄 Skill 内容:${NC}"
    echo ""
    sed '1,/^---$/d' "$SKILL_FILE" | sed '1,/^---$/d'
else
    echo -e "${YELLOW}❌ SKILL.md 文件不存在: ${SKILL_FILE}${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Skill 已加载,请按照上述指引执行${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
