"""
广度优先搜索 (Breadth First Search) 完整实现
========================================
与 DFS 对比：BFS = 队列，DFS = 栈
"""

from collections import defaultdict, deque

# ============================================================
# 第一部分：图的 BFS 基本实现
# ============================================================

class Graph:
    """使用邻接表表示的无向图"""
    
    def __init__(self):
        self.graph = defaultdict(list)
    
    def add_edge(self, u, v):
        self.graph[u].append(v)
        self.graph[v].append(u)
    
    # ---------- BFS 基本遍历 ----------
    def bfs(self, start):
        """队列实现 BFS，返回遍历顺序"""
        visited = {start}
        queue = deque([start])
        result = []
        
        while queue:
            node = queue.popleft()   # ⭐ 区别1：先进先出（和 DFS 的 pop 不同）
            result.append(node)
            for neighbor in self.graph[node]:
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)  # ⭐ 区别2：入队（入队时标记已访问）
        
        return result
    
    # ---------- 完整图遍历（非连通图） ----------
    def bfs_full(self):
        """遍历整个图的所有连通分量"""
        visited = set()
        components = []
        
        for node in list(self.graph.keys()):
            if node not in visited:
                component = []
                queue = deque([node])
                visited.add(node)
                while queue:
                    cur = queue.popleft()
                    component.append(cur)
                    for nb in self.graph[cur]:
                        if nb not in visited:
                            visited.add(nb)
                            queue.append(nb)
                components.append(component)
        
        return components
    
    # ---------- 分层 BFS（记录距离） ----------
    def bfs_with_distance(self, start):
        """BFS 同时记录每个节点到起点的最短距离"""
        distance = {start: 0}
        queue = deque([start])
        
        while queue:
            node = queue.popleft()
            for neighbor in self.graph[node]:
                if neighbor not in distance:
                    distance[neighbor] = distance[node] + 1
                    queue.append(neighbor)
        
        return distance


# ============================================================
# 第二部分：树的 BFS（层序遍历）
# ============================================================

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right


class TreeBFS:
    """二叉树的 BFS 遍历"""
    
    @staticmethod
    def level_order(root):
        """层序遍历（返回一维列表）"""
        if not root:
            return []
        result = []
        queue = deque([root])
        while queue:
            node = queue.popleft()
            result.append(node.val)
            if node.left:
                queue.append(node.left)
            if node.right:
                queue.append(node.right)
        return result
    
    @staticmethod
    def level_order_grouped(root):
        """层序遍历（按层分组）"""
        if not root:
            return []
        result = []
        queue = deque([root])
        while queue:
            level_size = len(queue)
            level = []
            for _ in range(level_size):
                node = queue.popleft()
                level.append(node.val)
                if node.left:
                    queue.append(node.left)
                if node.right:
                    queue.append(node.right)
            result.append(level)
        return result
    
    @staticmethod
    def zigzag_level_order(root):
        """锯齿形层序遍历（之字形）"""
        if not root:
            return []
        result = []
        queue = deque([root])
        left_to_right = True
        while queue:
            level_size = len(queue)
            level = deque()
            for _ in range(level_size):
                node = queue.popleft()
                if left_to_right:
                    level.append(node.val)
                else:
                    level.appendleft(node.val)
                if node.left:
                    queue.append(node.left)
                if node.right:
                    queue.append(node.right)
            result.append(list(level))
            left_to_right = not left_to_right
        return result
    
    @staticmethod
    def max_depth(root):
        """BFS 求二叉树最大深度"""
        if not root:
            return 0
        depth = 0
        queue = deque([root])
        while queue:
            depth += 1
            for _ in range(len(queue)):
                node = queue.popleft()
                if node.left:
                    queue.append(node.left)
                if node.right:
                    queue.append(node.right)
        return depth


# ============================================================
# 第三部分：BFS 经典应用场景
# ============================================================

class BFSApplications:
    """BFS 经典应用场景"""
    
    # ---------- 场景 1：最短路径（无权图） ----------
    @staticmethod
    def shortest_path(graph, start, target):
        """无权图最短路径（BFS 天然保证最短）"""
        if start == target:
            return [start]
        
        visited = {start}
        queue = deque([(start, [start])])  # (当前节点, 路径)
        
        while queue:
            node, path = queue.popleft()
            for neighbor in graph[node]:
                if neighbor == target:
                    return path + [neighbor]
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append((neighbor, path + [neighbor]))
        
        return None  # 无路径
    
    # ---------- 场景 2：单词接龙 (Word Ladder) ----------
    @staticmethod
    def word_ladder(begin_word, end_word, word_list):
        """
        单词接龙问题：每次改变一个字母，从 beginWord 到 endWord 的最短转换序列长度
        经典 BFS 应用！
        """
        word_set = set(word_list)
        if end_word not in word_set:
            return 0
        
        queue = deque([(begin_word, 1)])
        visited = {begin_word}
        
        while queue:
            word, steps = queue.popleft()
            if word == end_word:
                return steps
            
            # 尝试改变每个位置的字母
            for i in range(len(word)):
                for c in 'abcdefghijklmnopqrstuvwxyz':
                    if c == word[i]:
                        continue
                    new_word = word[:i] + c + word[i+1:]
                    if new_word in word_set and new_word not in visited:
                        visited.add(new_word)
                        queue.append((new_word, steps + 1))
        
        return 0  # 无法转换
    
    # ---------- 场景 3：二叉树的右视图 ----------
    @staticmethod
    def right_side_view(root):
        """BFS 层序遍历，取每层最右边节点"""
        if not root:
            return []
        result = []
        queue = deque([root])
        while queue:
            level_size = len(queue)
            for i in range(level_size):
                node = queue.popleft()
                if i == level_size - 1:  # 每层最后一个
                    result.append(node.val)
                if node.left:
                    queue.append(node.left)
                if node.right:
                    queue.append(node.right)
        return result
    
    # ---------- 场景 4：岛屿数量 ----------
    @staticmethod
    def num_islands(grid):
        """
        BFS 求岛屿数量（二维矩阵中的连通分量）
        '1' 为陆地，'0' 为水
        """
        if not grid:
            return 0
        
        rows, cols = len(grid), len(grid[0])
        visited = set()
        count = 0
        directions = [(0, 1), (0, -1), (1, 0), (-1, 0)]  # 四方向
        
        for r in range(rows):
            for c in range(cols):
                if grid[r][c] == '1' and (r, c) not in visited:
                    count += 1
                    # BFS 遍历整个岛屿
                    queue = deque([(r, c)])
                    visited.add((r, c))
                    while queue:
                        x, y = queue.popleft()
                        for dx, dy in directions:
                            nx, ny = x + dx, y + dy
                            if 0 <= nx < rows and 0 <= ny < cols and \
                               grid[nx][ny] == '1' and (nx, ny) not in visited:
                                visited.add((nx, ny))
                                queue.append((nx, ny))
        return count
    
    # ---------- 场景 5：迷宫最短路径 ----------
    @staticmethod
    def maze_shortest_path(maze, start, end):
        """
        BFS 在迷宫中找最短路径
        maze: 0=路, 1=墙
        """
        rows, cols = len(maze), len(maze[0])
        visited = {start}
        queue = deque([(start[0], start[1], 0)])  # (x, y, distance)
        directions = [(0, 1), (0, -1), (1, 0), (-1, 0)]
        
        while queue:
            x, y, dist = queue.popleft()
            if (x, y) == end:
                return dist
            
            for dx, dy in directions:
                nx, ny = x + dx, y + dy
                if 0 <= nx < rows and 0 <= ny < cols and \
                   maze[nx][ny] == 0 and (nx, ny) not in visited:
                    visited.add((nx, ny))
                    queue.append((nx, ny, dist + 1))
        
        return -1  # 无法到达
    
    # ---------- 场景 6：拓扑排序（Kahn 算法） ----------
    @staticmethod
    def topological_sort_bfs(graph):
        """
        Kahn 算法：基于 BFS 的拓扑排序
        graph: {u: [v1, v2, ...]} 表示 u -> v
        """
        # 计算入度
        in_degree = {node: 0 for node in graph}
        for node in graph:
            for neighbor in graph[node]:
                in_degree[neighbor] = in_degree.get(neighbor, 0) + 1
        
        # 入度为 0 的节点入队
        queue = deque([node for node in graph if in_degree[node] == 0])
        result = []
        
        while queue:
            node = queue.popleft()
            result.append(node)
            for neighbor in graph[node]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)
        
        # 如果结果长度不等于节点数，说明有环
        if len(result) != len(graph):
            return None  # 存在环，无法拓扑排序
        
        return result


# ============================================================
# 第四部分：BFS vs DFS 对比测试
# ============================================================

def run_all_tests():
    print("=" * 70)
    print("【第一部分】BFS 基本遍历测试")
    print("=" * 70)
    
    g = Graph()
    for u, v in [(0, 1), (0, 2), (1, 3), (1, 4), (2, 5), (2, 6)]:
        g.add_edge(u, v)
    
    print(f"图结构: 0-1-3, 0-1-4, 0-2-5, 0-2-6")
    print(f"BFS 遍历 (从0): {g.bfs(0)}")
    print(f"BFS 分层距离: {dict(sorted(g.bfs_with_distance(0).items()))}")
    
    g2 = Graph()
    for u, v in [(0, 1), (2, 3)]:
        g2.add_edge(u, v)
    print(f"非连通图分量: {g2.bfs_full()}")
    print()
    
    print("=" * 70)
    print("【第二部分】树的 BFS（层序遍历）")
    print("=" * 70)
    
    #       1
    #      / \
    #     2   3
    #    / \   \
    #   4   5   6
    root = TreeNode(1)
    root.left = TreeNode(2, TreeNode(4), TreeNode(5))
    root.right = TreeNode(3, None, TreeNode(6))
    
    tb = TreeBFS()
    print(f"层序遍历:          {tb.level_order(root)}")
    print(f"按层分组:          {tb.level_order_grouped(root)}")
    print(f"锯齿形遍历:        {tb.zigzag_level_order(root)}")
    print(f"二叉树最大深度:    {tb.max_depth(root)}")
    print()
    
    print("=" * 70)
    print("【第三部分】BFS 经典应用")
    print("=" * 70)
    
    app = BFSApplications()
    
    # 场景 1：最短路径
    print("■ 场景 1：最短路径（无权图）")
    graph = {0: [1, 2], 1: [0, 3, 4], 2: [0, 5, 6], 3: [1], 4: [1], 5: [2], 6: [2, 7], 7: [6]}
    path = app.shortest_path(graph, 3, 7)
    print(f"  3 -> 7 最短路径: {path} (长度 {len(path)-1 if path else '无'})")
    
    # 场景 2：单词接龙
    print("\n■ 场景 2：单词接龙")
    steps = app.word_ladder("hit", "cog", ["hot", "dot", "dog", "lot", "log", "cog"])
    print(f"  hit -> cog 最短步数: {steps} (预期: 5)")
    
    # 场景 3：二叉树的右视图
    print("\n■ 场景 3：二叉树右视图")
    print(f"  右视图: {app.right_side_view(root)} (预期: [1, 3, 6])")
    
    # 场景 4：岛屿数量
    print("\n■ 场景 4：岛屿数量")
    grid = [
        ['1','1','0','0','0'],
        ['1','1','0','0','0'],
        ['0','0','1','0','0'],
        ['0','0','0','1','1']
    ]
    print(f"  岛屿数量: {app.num_islands(grid)} (预期: 3)")
    
    # 场景 5：迷宫最短路径
    print("\n■ 场景 5：迷宫最短路径")
    maze = [
        [0, 0, 1, 0],
        [1, 0, 1, 0],
        [0, 0, 0, 0],
        [0, 1, 1, 0]
    ]
    dist = app.maze_shortest_path(maze, (0, 0), (3, 3))
    print(f"  (0,0) -> (3,3) 最短距离: {dist}")
    
    # 场景 6：拓扑排序（Kahn）
    print("\n■ 场景 6：拓扑排序 (Kahn BFS)")
    dag = {'A': ['B', 'C'], 'B': ['D'], 'C': ['D'], 'D': ['E'], 'E': []}
    topo = app.topological_sort_bfs(dag)
    print(f"  拓扑排序: {topo}")
    
    # 有环图
    cyclic = {'A': ['B'], 'B': ['C'], 'C': ['A']}
    topo2 = app.topological_sort_bfs(cyclic)
    print(f"  有环图拓扑排序: {topo2}")
    print()
    
    print("=" * 70)
    print("【第四部分】BFS vs DFS 核心区别总结")
    print("=" * 70)
    print()
    print("  ┌─────────┬──────────────────────┬──────────────────────┐")
    print("  │         │        BFS           │        DFS           │")
    print("  ├─────────┼──────────────────────┼──────────────────────┤")
    print("  │ 数据结构 │ 队列 (queue)         │ 栈 (stack)           │")
    print("  │ 取元素   │ popleft() 先进先出   │ pop() 后进先出       │")
    print("  │ 遍历顺序 │ 按层逐层扩散          │ 一条路走到黑         │")
    print("  │ 最短路径 │ ✅ 天然保证最短       │ ❌ 不保证最短        │")
    print("  │ 空间复杂度│ O(宽度) 可能很大     │ O(深度) 通常较小     │")
    print("  │ 适用场景 │ 最短路径、层序        │ 连通性、回溯、全排列  │")
    print("  │ 树遍历   │ 层序遍历             │ 前/中/后序           │")
    print("  └─────────┴──────────────────────┴──────────────────────┘")
    print()


if __name__ == "__main__":
    run_all_tests()
