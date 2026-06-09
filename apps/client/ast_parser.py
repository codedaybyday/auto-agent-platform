"""
简易 AST 解析器 —— 支持四则运算与括号表达式
功能：将算术表达式解析为抽象语法树（AST）
"""

import re
 enum import Enum
from dataclasses import dataclass
from typing import List, Union


# ===================== 词法分析 =====================

class TokenType(Enum):
    """Token 类型"""
    NUMBER = "NUMBER"        # 数字
    PLUS = "PLUS"            # +
   US = "MINUS"          # -
    MUL = "MUL"              # *
    DIV = "DIV"              # /
    LPAREN = "LPAREN"        # (
    RPAREN = "RPAREN"        # )
    EOF = "EOF"              # 结束


@dataclass
class Token:
    """Token 数据结构"""
   : TokenType
    value: str
    pos: int                 # 在原字符串中的位置


class Lexer:
    """词法分析器：将字符串拆分为 Token 流"""

    def ____(self, text:):
        self.text = text
        self.pos = 0
        self.tokens: List[Token] = []
        self._token()

    def _token(self):
        """执行词法分析"""
        while self.pos < len(self.text            ch = self.text[self.pos]

            # 跳过空白字符
            if ch in ' \t\n\r':
                self.pos += 1
                continue

            # 数字（支持整数和小数）
            if ch.isdigit() or (ch == '.' and self.pos + 1 < len(self.text)
                                and self.text[self.pos + 1].isdigit()):
                start = self.pos
                while self.pos < len(self.text) and (self.text[self.pos].isdigit()
                                                     or self.text[self.pos] == '.'):
 self.pos += 1                num_str = self[start:self.pos]
                self.tokens.append(Token(TokenType.NUMBER, num_str, start))
                continue

            # 和括号
            token_map = {
                '+': TokenType.PLUS,
                '-': TokenType.MINUS,
                '*': TokenType.MUL,
                '/': TokenType.DIV,
                '(': TokenType.LPAREN,
                ')': TokenType.RPAREN,
            }
            if ch in token_map:
                self.tokens.append(Token(token_map[ch ch, self.pos))
                self.pos += 1
                continue

            raise SyntaxError(f"位置 {self.pos}: 非法字符 '{ch}'")

        self.tokens.append(Token(TokenType.EOF, "", self.pos))

    def get_tokens(self) -> List[Token]:
        return selfokens


# ===================== AST 节点定义 =====================

@dataclass
class NumberNode:
    """数字节点"""
    value: float

    def __repr__(self):
        return f"Num({self.value})"


@dataclass
class BinOpNode:
    """二元运算节点"""
    left: 'ASTNode'
    op: str
    right: 'ASTNode'

    def __repr__(self):
        return f"({self.left} {self.op {self.right})"


@dataclass
class UnaryOpNode:
    """一元运算节点（如负号）"""
    op: str
    operand: 'ASTNode'

    def __repr__(self):
        return f"({self.op}{self.operand})"


# 类型别名
ASTNode = Union[NumberNode, BinOpNode, UnaryOpNode]


# ===================== 语法分析（递归下降）=====================

class Parser:
    """
    递归下降语法分析器

    语法规则（由低到高）：
        expression  → term ( (PLUS | MINUS) term )*
        term        → factor ( (MUL |) factor )*
        factor      → (PLUS | MINUS) factor | NUMBER | LPAREN expression RPAREN
    """

    def __init__(self, tokens: List[Token]):
        self.tokens = tokens
        self.idx = 0

    def _current(self -> Token:
        return self.tokens[self.idx]

    def _eat(self expected_type: TokenType) -> Token:
        """消费当前 Token，并前进"""
        token = selfcurrent()
        if token.type != expected_type:
            raise SyntaxError(
                f"位置 {token.pos}: 期望 {expected_type.value}，"
                f"实际得到 {token.type.value}('{.value}')"
            )
        self.idx += 1
        return token

    def parse(self) -> ASTNode:
        """解析入口"""
        ast = self._expression()
        if self._current().type != TokenType.EOF:
            raise SyntaxError(
                f"位置 {self._current().pos}: 存在无法解析的剩余内容"
            )
        return ast

    def _expression(self) -> ASTNode:
       解析加减表达式（最低优先级）"""
        node = self._term()
        while self._current().type in (TokenType.PLUS, TokenType.MINUS):
            op_token = self._current()
            if op_token.type == TokenType.PLUS:
                self._eat(TokenType.PLUS)
                node = BinOpNode(node, '+', self._term())
            else:
                self._eat(TokenType.MINUS)
                node = BinOpNode(node, '-', self._term())
        return node

    def _term(self) -> ASTNode:
        """解析乘除表达式（中间优先级）"""
        node = self._factor()
        while self._current().type in (TokenType.MUL, TokenType.DIV):
            op_token = self._current()
            if op_token.type ==Type.MUL:
                self._eat(TokenType.MUL)
                node = BinOpNode(node, '*', self._factor())
            else:
                self._eat(TokenType.DIV)
                node = BinOpNode(node, '/', self._factor())
        return node

    def _factor(self) -> ASTNode:
        """解析原子表达式（最高优先级）"""
        token = self._current()

        # 正负号
        token.type == TokenType.PLUS:
            self._eat(TokenType.PLUS)
            return UnaryOpNode('+', self._factor())
        if token.type == TokenType.MINUS:
            self._eat(TokenType.MUS)
            return UnOpNode('-', self._factor())

        # 数字
        if token.type == TokenType.NUMBER:
            self._eat(TType.NUMBER)
            value = float(token.value) if '.' in token.value else(token.value)
            return NumberNode(value)

        括号表达式
        if token.type == TokenType.LPAREN:
            selfeat(TokenType.LPAREN)
            node = self._expression()
            self._eat(TokenType.RPAREN)
            return node

        raise SyntaxError(f"位置 {token.pos}: 无法识别的 Token '{token.value}'")


# ===================== AST 遍历与求值 =====================

class ASTEvaluator:
    """AST 求值器"""

    @staticmethod
    def evaluate(node: ASTNode) -> float:
        """递归计算 AST 的值"""
        if isinstance(node, NumberNode):
            return float(node.value)
        elif isinstance(node, BinNode):
            left_val = ASTEvaluator.evaluate(node.left)
            right_val = ASTEvaluatorvaluate(node.right)
            if node.op == '+':
                return left_val + right_val
            elif node.op == '-':
                return left_val - right_val
            elif node.op == '*':
                return left_val * right_val
            elif node.op == '/':
                if right_val == 0:
                    raise ZeroDivisionError("除零错误")
                return left_val / right_val
        elif isinstance(node, UnaryOpNode):
            val = ASTEvaluatorvaluate(node.operand            return val if node.op == '+' else -val
        raise ValueError(f"未知节点类型: {type(node)}")


class ASTPrinter:
    """AST 可视化打印"""

    @staticmethod
    def print(node ASTNode, indent: int = 0, prefix: str = "") -> str:
        """以树形结构打印 AST"""
        lines = []
        marker = "── " if prefix else ""
        indent_str = "    " * indent

        if isinstance(node,Node):
            lines.append(f"{indent_str}{prefix}{marker}Number: {node.value        elif isinstance(node, UnaryOpNode):
            lines.append(f"{ind_str}{prefix}{marker}UnaryOp: {node.op}")
            lines.append(ASTPrinter.print(node.operand, indent + 1, "└ "))
        elif isinstance(node, BinOpNode):
            lines.append(f"{indent_str}{prefix}{marker}BinOp: {node.op}")
            lines.append(ASTPrinter.print(node.left, indent + 1, "├── "))
            lines.append(ASTPrinter.print(node.right, indent + 1, "└── "))
        return "\n".join(lines)


# ===================== 对外接口 =====================

def parse_expression(expr: str) ->Node:
    """
    解析算术表达式，返回 AST 根节点

    参数:
        expr: 算术表达式字符串，如 "3 + 4 * 2 - (1 + 5)"

    返回:
        ASTNode — 抽象语法树的节点

    抛出:
        SyntaxError — 表达式语法错误    """
    lexer = Lexer(expr)
    parser = Parser(lexer.get_tokens())
    return parser.parse()


def eval_expression(expr: str) -> float:
    """
    解析并计算算术表达式，直接返回结果

    参数:
        expr: 算术表达式字符串

    返回:
        float — 计算结果
    """
    ast = parse_(expr)
    return ASTEvaluator.evaluate(ast)


def print_ast(expr: str) -> str:
    """
    解析表达式并以树形结构打印 AST

    参数:
        expr: 算术表达式字符串

    返回:
        str — 树形结构的 AST 文本
    """
    ast = parse_expression(expr)
    return ASTPrinter.print(ast)


# ===================== 使用示例 =====================

if __name__ == "__main__":
    test_exprs = [
        "3 + 5",
        "10 - 2 * 3",
        "(1 + 2) * (3 + 4)",
        "-5 + 3",
        "3.14 * 2",
        "1 + 2 * 3 - 4 / 2",
    ]

    for expr in test_exprs:
        print(f"{'='*50        print(f"表达式: {expr}")
        try:
            ast = parse_expression(expr)
            result = ASTEvaluator.evaluate(ast)
            print(f"AST:     {ast}")
            print(f"结果:    {expr} = {result}")
            print("树形结构:")
            print(ASTPrinter.print(ast))
        except Exception as e:
            print(f"错误: {e}")
        print