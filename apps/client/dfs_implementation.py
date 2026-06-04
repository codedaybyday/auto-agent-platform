"""
深度优先搜索 (Depth First Search) 完整实现
========================================
包含：递归、迭代、图的遍历、树的应用、常见场景
"""

from collections import defaultdict

# ============================================================
# 第一部分：图的 DFS 基本实现
# ============================================================

class Graph:
    """使用邻接表表示的无向图"""
    
    def __init__(self):
        self.graph = defaultdict(list)  # 邻接表
    
    def add_edge(self, u, v):
        """添加无向边"""
        self.graph[u].append(v)
        self.graph[v].append(u)
    
    # ---------- 1.1 递归版 DFS ----------
    def dfs_recursive(self, start):
        """递归方式实现 DFS，返回遍历顺序"""
        visited = set()
        result = []
        
        def _dfs(node):
            visited.add(node)
            result.append(node)
            for neighbor in self.graph[node]:
                if neighbor not in visited:
                    _dfs(neighbor)
        
        _dfs(start)
        return result
    
    # ---------- 1.2 迭代版 DFS ----------
    def dfs_iterative(self, start):
        """显式栈实现 DFS，返回遍历顺序"""
        visited = set()
        stack = [start]
        result = []
        
        while stack:
            node = stack.pop()
            if node not in visited:
                visited.add(node)
                result.append(node)
                # 注意：为了实现与递归相同的顺序，将邻居逆序入栈
                for neighbor in reversed(self.graph[node]):
                    if neighbor not in visited:
                        stack.append(neighbor)
        
        return result
    
    # ---------- 1.3 完整图遍历（处理非连通图） ----------
    def dfs_full(self):
        """遍历整个图（可能包含多个连通分量）"""
        visited = set()
        components = []
        
        def _dfs(node, component):
            visited.add(node)
            component.append(node)
            for neighbor in self.graph[node]:
                if neighbor not in visited:
                    _dfs(neighbor, component)
        
        for node in list(self.graph.keys()):
            if node not in visited:
                component = []
                _dfs(node, component)
                components.append(component)
        
        return components


# ============================================================
# 第二部分：DFS 在树上的应用
# ============================================================

class TreeNode:
    """二叉树节点"""
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right


class BinaryTreeDFS:
    """二叉树的三种 DFS 遍历"""
    
    @staticmethod
    def preorder_recursive(root):
        """前序遍历：根 -> 左 -> 右"""
        result = []
        def _dfs(node):
            if not node:
                return
            result.append(node.val)      # 访问根
            _dfs(node.left)               # 遍历左子树
            _dfs(node.right)              # 遍历右子树
        _dfs(root)
        return result
    
    @staticmethod
    def inorder_recursive(root):
        """中序遍历：左 -> 根 -> 右 (BST 下得到有序序列)"""
        result = []
        def _dfs(node):
            if not node:
                return
            _dfs(node.left)               # 遍历左子树
            result.append(node.val)      # 访问根
            _dfs(node.right)              # 遍历右子树
        _dfs(root)
        return result
    
    @staticmethod
    def postorder_recursive(root):
        """后序遍历：左 -> 右 -> 根"""
        result = []
        def _dfs(node):
            if not node:
                return
            _dfs(node.left)               # 遍历左子树
            _dfs(node.right)              # 遍历右子树
            result.append(node.val)      # 访问根
        _dfs(root)
        return result
    
    @staticmethod
    def preorder_iterative(root):
        """前序遍历（迭代版）"""
        if not root:
            return []
        result = []
        stack = [root]
        while stack:
            node = stack.pop()
            result.append(node.val)
            if node.right:   # 先右后左，保证左子树先出栈
                stack.append(node.right)
            if node.left:
                stack.append(node.left)
        return result


# ============================================================
# 第三部分：常见应用场景
# ============================================================

class DFSApplications:
    """DFS 经典应用场景"""
    
    # ---------- 场景 1：路径查找 ----------
    @staticmethod
    def has_path(graph, start, target):
        """判断从 start 到 target 是否存在路径"""
        visited = set()
        
        def _dfs(node):
            if node == target:
                return True
            visited.add(node)
            for neighbor in graph[node]:
                if neighbor not in visited:
                    if _dfs(neighbor):
                        return True
            return False
        
        return _dfs(start)
    
    @staticmethod
    def find_all_paths(graph, start, target):
        """找到从 start 到 target 的所有路径"""
        visited = set()
        all_paths = []
        
        def _dfs(node, path):
            if node == target:
                all_paths.append(path[:])
                return
            visited.add(node)
            for neighbor in graph[node]:
                if neighbor not in visited:
                    path.append(neighbor)
                    _dfs(neighbor, path)
                    path.pop()  # 回溯
            visited.remove(node)  # 允许其他路径经过该节点
        
        _dfs(start, [start])
        return all_paths
    
    # ---------- 场景 2：连通分量 ----------
    @staticmethod
    def count_connected_components(graph):
        """统计无向图的连通分量数量"""
        visited = set()
        count = 0
        
        def _dfs(node):
            visited.add(node)
            for neighbor in graph[node]:
                if neighbor not in visited:
                    _dfs(neighbor)
        
        for node in graph:
            if node not in visited:
                count += 1
                _dfs(node)
        
        return count
    
    # ---------- 场景 3：检测环 ----------
    @staticmethod
    def has_cycle(graph):
        """检测无向图是否有环"""
        visited = set()
        
        def _dfs(node, parent):
            visited.add(node)
            for neighbor in graph[node]:
                if neighbor not in visited:
                    if _dfs(neighbor, node):
                        return True
                elif neighbor != parent:  # 遇到已访问且不是父节点
                    return True
            return False
        
        for node in graph:
            if node not in visited:
                if _dfs(node, None):
                    return True
        return False
    
    # ---------- 场景 4：拓扑排序（有向图） ----------
    @staticmethod
    def topological_sort(graph):
        """
        对有向无环图进行拓扑排序
        graph: {u: [v1, v2, ...]} 表示 u -> v
        """
        visited = set()
        stack = []
        
        def _dfs(node):
            visited.add(node)
            for neighbor in graph[node]:
                if neighbor not in visited:
                    _dfs(neighbor)
            stack.append(node)  # 后序入栈
        
        for node in graph:
            if node not in visited:
                _dfs(node)
        
        return stack[::-1]  # 逆序即拓扑序
    
    # ---------- 场景 5：二分图判定 ----------
    @staticmethod
    def is_bipartite(graph):
        """判定无向图是否为二分图"""
        colors = {}  # 0: 未染色, 1: 红色, -1: 蓝色
        
        def _dfs(node, color):
            colors[node] = color
            for neighbor in graph[node]:
                if neighbor not in colors:
                    if not _dfs(neighbor, -color):
                        return False
                elif colors[neighbor] == color:  # 相邻节点颜色相同
                    return False
            return True
        
        for node in graph:
            if node not in colors:
                if not _dfs(node, 1):
                    return False
        return True
    
    # ---------- 场景 6：回溯法 - N皇后 ----------
    @staticmethod
    def solve_n_queens(n):
        """使用 DFS + 回溯解决 N 皇后问题"""
        def _is_safe(board, row, col):
            # 检查列
            for i in range(row):
                if board[i][col] == 'Q':
                    return False
            # 检查左上对角线
            i, j = row - 1, col - 1
            while i >= 0 and j >= 0:
                if board[i][j] == 'Q':
                    return False
                i -= 1
                j -= 1
            # 检查右上对角线
            i, j = row - 1, col + 1
            while i >= 0 and j < n:
                if board[i][j] == 'Q':
                    return False
                i -= 1
                j += 1
            return True
        
        solutions = []
        
        def _dfs(board, row):
            if row == n:
                solutions.append([''.join(r) for r in board])
                return
            for col in range(n):
                if _is_safe(board, row, col):
                    board[row][col] = 'Q'
                    _dfs(board, row + 1)
                    board[row][col] = '.'  # 回溯
        
        board = [['.' for _ in range(n)] for _ in range(n)]
        _dfs(board, 0)
        return solutions


# ============================================================
# 第四部分：测试用例
# ============================================================

def test_dfs_basics():
    """测试 DFS 基本遍历"""
    print("=" * 60)
    print("【第一部分】DFS 基本遍历测试")
    print("=" * 60)
    
    g = Graph()
    edges = [(0, 1), (0, 2), (1, 3), (1, 4), (2, 5), (2, 6)]
    for u, v in edges:
        g.add_edge(u, v)
    
    print(f"图结构: 0-1-3, 0-1-4, 0-2-5, 0-2-6")
    print(f"递归 DFS (从0开始): {g.dfs_recursive(0)}")
    print(f"迭代 DFS (从0开始): {g.dfs_iterative(0)}")
    
    # 非连通图
    g2 = Graph()
    for u, v in [(0, 1), (2, 3)]:
        g2.add_edge(u, v)
    components = g2.dfs_full()
    print(f"\n非连通图连通分量: {components}")
    print()


def test_tree_dfs():
    """测试树的 DFS 遍历"""
    print("=" * 60)
    print("【第二部分】二叉树 DFS 遍历测试")
    print("=" * 60)
    
    # 构建二叉树:
    #       1
    #      / \
    #     2   3
    #    / \   \
    #   4   5   6
    root = TreeNode(1)
    root.left = TreeNode(2)
    root.right = TreeNode(3)
    root.left.left = TreeNode(4)
    root.left.right = TreeNode(5)
    root.right.right = TreeNode(6)
    
    btd = BinaryTreeDFS()
    print(f"前序遍历: {btd.preorder_recursive(root)}   (预期: [1, 2, 4, 5, 3, 6])")
    print(f"前序(迭代): {btd.preorder_iterative(root)}  (预期: [1, 2, 4, 5, 3, 6])")
    print(f"中序遍历: {btd.inorder_recursive(root)}    (预期: [4, 2, 5, 1, 3, 6])")
    print(f"后序遍历: {btd.postorder_recursive(root)}   (预期: [4, 5, 2, 6, 3, 1])")
    print()


def test_applications():
    """测试 DFS 应用场景"""
    print("=" * 60)
    print("【第三部分】DFS 应用场景测试")
    print("=" * 60)
    
    app = DFSApplications()
    
    # 构建测试图
    graph = {
        0: [1, 2],
        1: [0, 3, 4],
        2: [0, 5, 6],
        3: [1],
        4: [1],
        5: [2],
        6: [2, 7],
        7: [6]
    }
    
    # 场景 1：路径查找
    print("■ 场景 1：路径查找")
    print(f"  0 -> 7 是否存在路径: {app.has_path(graph, 0, 7)}")
    all_paths = app.find_all_paths(graph, 3, 6)
    print(f"  3 -> 6 所有路径: {all_paths}")
    
    # 场景 2：连通分量
    print("\n■ 场景 2：连通分量")
    components = app.count_connected_components(graph)
    print(f"  连通分量数量: {components}")
    
    # 场景 3：环检测
    print("\n■ 场景 3：环检测")
    print(f"  当前图是否有环: {app.has_cycle(graph)}")
    
    # 无环图
    tree = {0: [1, 2], 1: [3], 2: [], 3: []}
    print(f"  树是否有环: {app.has_cycle(tree)}")
    
    # 场景 4：拓扑排序
    print("\n■ 场景 4：拓扑排序")
    dag = {
        'A': ['B', 'C'],
        'B': ['D'],
        'C': ['D'],
        'D': ['E'],
        'E': []
    }
    topo = app.topological_sort(dag)
    print(f"  拓扑排序结果: {topo}")
    
    # 场景 5：二分图判定
    print("\n■ 场景 5：二分图判定")
    bipartite_graph = {0: [1, 3], 1: [0, 2], 2: [1, 3], 3: [0, 2]}
    print(f"  二分图判定: {app.is_bipartite(bipartite_graph)}")
    
    non_bipartite = {0: [1, 2], 1: [0, 2], 2: [0, 1]}  # 三角形
    print(f"  三角形图判定: {app.is_bipartite(non_bipartite)}")
    
    # 场景 6：N皇后
    print("\n■ 场景 6：N 皇后问题")
    solutions = app.solve_n_queens(4)
    print(f"  4 皇后共有 {len(solutions)} 种解法:")
    for sol in solutions:
        for row in sol:
            print(f"    {row}")
        print()
    
    print("=" * 60)


if __name__ == "__main__":
    test_dfs_basics()
    test_tree_dfs()
    test_applications()
