# Bash Session 持久化测试指南

## 测试目标
验证 `cd`、环境变量、多会话隔离等功能是否正常工作。

---

## 测试用例

### 测试1: cd 命令持久化

**操作步骤:**
1. 在对话框输入: `cd /tmp && pwd`
2. 等待返回 `/tmp`
3. 再输入: `pwd`

**预期结果:**
```
第二次 pwd 仍返回 /tmp，而不是初始目录
```

**失败表现:**
```
第二次 pwd 返回到项目根目录（说明 cd 没有持久化）
```

---

### 测试2: 环境变量持久化

**操作步骤:**
1. 输入: `export MY_VAR=hello123`
2. 再输入: `echo $MY_VAR`

**预期结果:**
```
输出: hello123
```

**失败表现:**
```
输出为空（环境变量没有保持）
```

---

### 测试3: 多会话隔离

**操作步骤:**
1. 在会话A中发送: `cd /tmp && export SESSION=A`
2. 新建一个对话（会话B）
3. 在会话B中发送: `cd /var && export SESSION=B`
4. 回到会话A发送: 

5. 在会话B发送: `pwd && echo $SESSION`

**预期结果:**
```
会话A: /tmp + A
会话B: /var + B
（互不干扰）
```

**失败表现:**
```
会话A显示 /var 或 SESSION=B（会话间状态混乱）
```

---

### 测试4: 复杂工作流

**操作步骤:**
1. `mkdir -p ~/test-project && cd ~/test-project`
2. `git init`
3. `echo "# Test" > README.md`
4. `git add . && git commit -m "init"`
5. `pwd`

**预期结果:**
```
pwd 返回: /Users/用户名/test-project
git log 显示 init 提交
```

---

### 测试5: 重启会话

**操作步骤:**
1. `cd /tmp && export TEST=old`
2. `pwd && echo $TEST` （验证设置成功）
3. 发送请求时使用 restart 参数（需代码支持）
4. `pwd && echo $TEST`

**预期结果:**
```
目录和环境变量重置为初始状态
TEST 变量不存在
```

---

## 快速验证脚本

在项目根目录运行 Node.js:

```bash
node --experimental-vm-modules -e "
const { createBashTool } = require('./apps/client/dist/main/tools/bash/bash-tool.js');

async function test() {
  const tool = createBashTool('test');

  // Test 1: cd persists
  await tool.execute({ command: 'cd /tmp' });
  const r1 = await tool.execute({ command: 'pwd' });
  console.log('Test 1 - cd persists:', r1.stdout.includes('/tmp') ? '✅' : '❌');

  // Test 2: env persists
  await tool.execute({ command: 'export MY_VAR=test' });
  const r2 = await tool.execute({ command: 'echo \$MY_VAR' });
  console.log('Test 2 - env persists:', r2.stdout.includes('test') ? '✅' : '❌');

  tool.destroy();
}

test();
"
```

---

## 常见问题排查

### 问题1: cd 不生效
**检查点:**
- Session ID 是否一致（每次请求使用相同 sessionId）
- `sessionManager.getOrCreate()` 是否被调用

### 问题2: 环境变量丢失
**检查点:**
- Shell 是否以 `-i` 模式启动（交互式）
- `export` 命令是否正确发送到 stdin

### 问题3: 多会话混乱
**检查点:**
- 不同会话是否使用不同的 sessionId
- sessionManager 是否单例
