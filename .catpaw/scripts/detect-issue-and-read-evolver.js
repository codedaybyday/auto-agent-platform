#!/usr/bin/env node
// detect-issue-and-read-evolver.js
// beforeSubmitPrompt hook: 检测用户消息中的问题关键词，设置标记；记录是否在执行规定指令
// afterAgentResponse hook: 记录执行步骤详情
// stop hook: 会话结束时触发，比对流程执行情况，返回 followup_message

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 问题标记文件路径
const MARKER_FILE = '/tmp/catpaw-issue-detected.txt';
// 继续开发标记文件路径
const CONTINUE_MARKER_FILE = '/tmp/catpaw-continue-detected.txt';
// 规定指令执行标记文件路径
const SKILL_EXECUTION_FILE = '/tmp/catpaw-skill-execution.txt';
// Agent 执行步骤记录文件路径（用于自检比对）
const EXECUTION_TRACE_FILE = '/tmp/catpaw-execution-trace.txt';

// skill-evolver 相关的特征词（表示已经在使用 skill-evolver）
const SKILL_EVOLVER_INDICATORS = [
  "skill-evolver",
  "Skill Evolver",
  "失败案例分析",
  "Skill 进化",
  "skill 进化",
  "打补丁",
  "Patch",
  "诊断报告",
  "根因分析",
  "收集失败案例"
];

// 规定指令（skill）列表
const SKILL_PATTERNS = [
  // 带 / 前缀的 skill 调用
  /^\/[\w-]+/,
  // skill 相关关键词
  "skill-evolver",
  "self-check",
  "task-splitter",
  "techdoc-generator",
  "prd-parser",
  "ui-design-analyzer",
  "ingee-batch-analyzer",
  "mastergo-batch-analyzer",
  "modular-developer",
  "logic-driven-development",
  "ui-driven-development",
  "mep-code",
  "mep-talos",
  // skill 相关动作
  "调用 skill",
  "执行 skill",
  "使用 skill",
  "检查流程",
  "重新执行",
  "流程不对",
  "步骤遗漏",
  "检查是否正确执行"
];

// 问题关键词
const ISSUE_PATTERNS = [
  "不对", "需要调整", "有问题","有点问题", "做错了", "不对劲",
  "出错了", "失败了", "错误", "需要修改", "需要改进",
  "需要优化", "不符合", "不正确", "不准确", "不完整",
  "bug", "Bug", "BUG", "报错", "异常", "失败"
];

// 开发任务关键词（触发 AI 自动提交流程）
const DEV_TASK_KEYWORDS = [
  "继续", "下一个", "继续执行", "继续开发",
  "go on", "continue", "next",
  "接着", "往下", "下一步",
  "继续做", "做下一个", "下一个任务"
];

// 开发指令列表（触发 AI 自动提交流程）
const DEV_COMMANDS = [
  "/08 代码开发",
];

/**
 * 查找项目根目录
 */
function findProjectRoot() {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.catpaw'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

/**
 * 读取 skill 的 SKILL.md 内容
 */
function readSkillMd(projectRoot, skillName) {
  const skillPath = path.join(projectRoot, '.catpaw', 'skills', skillName, 'SKILL.md');
  if (fs.existsSync(skillPath)) {
    return fs.readFileSync(skillPath, 'utf8');
  }
  return null;
}

/**
 * 记录 Agent 执行步骤（用于自检比对）
 * @param {Object} step - 步骤信息
 * @param {string} step.type - 步骤类型
 * @param {boolean} step.isSubAgent - 是否为 subagent
 */
function recordExecutionStep(step) {
  try {
    let trace = [];
    if (fs.existsSync(EXECUTION_TRACE_FILE)) {
      trace = JSON.parse(fs.readFileSync(EXECUTION_TRACE_FILE, 'utf8'));
    }
    trace.push({
      timestamp: new Date().toISOString(),
      agentType: step.isSubAgent ? 'subagent' : 'agent',
      ...step
    });
    fs.writeFileSync(EXECUTION_TRACE_FILE, JSON.stringify(trace, null, 2), 'utf8');
  } catch (e) {
    console.error('[Hook] 记录执行步骤失败:', e.message);
  }
}

/**
 * 读取 Agent 执行步骤记录
 */
function readExecutionTrace() {
  try {
    if (fs.existsSync(EXECUTION_TRACE_FILE)) {
      return JSON.parse(fs.readFileSync(EXECUTION_TRACE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[Hook] 读取执行步骤记录失败:', e.message);
  }
  return [];
}

/**
 * 清理执行步骤记录
 */
function clearExecutionTrace() {
  try {
    if (fs.existsSync(EXECUTION_TRACE_FILE)) {
      fs.unlinkSync(EXECUTION_TRACE_FILE);
    }
  } catch (e) {
    console.error('[Hook] 清理执行步骤记录失败:', e.message);
  }
}

/**
 * 从 AI 响应中提取执行步骤详情
 */
function extractExecutionDetails(text) {
  const details = {
    steps: [],
    toolCalls: [],
    fileOperations: [],
    skillInvocations: []
  };
  
  // 提取 TodoList 更新状态
  const todoUpdateRegex = /更新TodoList.*?状态改为\s*`(\w+)`/gi;
  let match;
  while ((match = todoUpdateRegex.exec(text)) !== null) {
    details.steps.push({
      type: 'todo_update',
      status: match[1],
      raw: match[0]
    });
  }
  
  // 提取步骤完成标记（✓ Step X 完成）
  const stepCompleteRegex = /✓\s*Step\s*(\d+)\s*完成[:：]?\s*(.+?)(?:\n|$)/gi;
  while ((match = stepCompleteRegex.exec(text)) !== null) {
    details.steps.push({
      type: 'step_complete',
      stepNum: parseInt(match[1]),
      description: match[2].trim(),
      raw: match[0]
    });
  }
  
  // 提取 Phase 完成标记
  const phaseCompleteRegex = /✓\s*Phase\s*(\d+)\s*完成[:：]?/gi;
  while ((match = phaseCompleteRegex.exec(text)) !== null) {
    details.steps.push({
      type: 'phase_complete',
      phaseNum: parseInt(match[1]),
      raw: match[0]
    });
  }
  
  // 提取工具调用（通过常见工具名称识别）
  const toolNames = ['read_file', 'write', 'string_replace', 'MultiEdit', 'run_terminal_cmd', 'grep', 'list_dir', 'codebase_search'];
  for (const tool of toolNames) {
    const toolRegex = new RegExp(`\\b${tool}\\b`, 'gi');
    if (toolRegex.test(text)) {
      details.toolCalls.push(tool);
    }
  }
  
  // 提取文件操作
  const fileReadRegex = /读取文件[:：]?\s*[`']?([^`'\n]+)[`']?/gi;
  while ((match = fileReadRegex.exec(text)) !== null) {
    details.fileOperations.push({
      type: 'read',
      path: match[1].trim()
    });
  }
  
  const fileWriteRegex = /(写入|修改|创建|编辑)文件[:：]?\s*[`']?([^`'\n]+)[`']?/gi;
  while ((match = fileWriteRegex.exec(text)) !== null) {
    details.fileOperations.push({
      type: 'write',
      action: match[1],
      path: match[2].trim()
    });
  }
  
  // 提取 skill 调用
  const skillRegex = /(?:调用|执行|使用)\s*[`']?([\w-]+-developer|context-optimization|unit-test-generator|[\w-]+-analyzer|self-check|skill-evolver)[`']?/gi;
  while ((match = skillRegex.exec(text)) !== null) {
    details.skillInvocations.push(match[1]);
  }
  
  return details;
}

/**
 * 生成执行摘要（用于自检比对）
 */
function generateExecutionSummary(trace) {
  if (!trace || trace.length === 0) {
    return '无执行记录';
  }
  
  const summary = {
    totalActions: trace.length,
    stepsCompleted: [],
    phasesCompleted: [],
    todoUpdates: [],
    toolsUsed: new Set(),
    filesOperated: [],
    skillsInvoked: []
  };
  
  for (const entry of trace) {
    if (entry.details) {
      // 汇总步骤完成
      for (const step of (entry.details.steps || [])) {
        if (step.type === 'step_complete') {
          summary.stepsCompleted.push(`Step ${step.stepNum}: ${step.description}`);
        } else if (step.type === 'phase_complete') {
          summary.phasesCompleted.push(`Phase ${step.phaseNum}`);
        } else if (step.type === 'todo_update') {
          summary.todoUpdates.push(step.status);
        }
      }
      
      // 汇总工具使用
      for (const tool of (entry.details.toolCalls || [])) {
        summary.toolsUsed.add(tool);
      }
      
      // 汇总文件操作
      for (const fileOp of (entry.details.fileOperations || [])) {
        summary.filesOperated.push(`${fileOp.type}: ${fileOp.path}`);
      }
      
      // 汇总 skill 调用
      for (const skill of (entry.details.skillInvocations || [])) {
        summary.skillsInvoked.push(skill);
      }
    }
  }
  
  summary.toolsUsed = Array.from(summary.toolsUsed);
  return summary;
}

/**
 * 检查是否命中问题关键词
 */
function checkIssueKeywords(text) {
  // 检查是否已经在使用 skill-evolver
  const isUsingSkillEvolver = SKILL_EVOLVER_INDICATORS.some(indicator => text.includes(indicator));
  if (isUsingSkillEvolver) {
    return false;
  }
  // 检查是否匹配问题关键词
  return ISSUE_PATTERNS.some(pattern => text.includes(pattern));
}

/**
 * 检查是否命中开发任务关键词或指令
 */
function checkDevTaskKeywords(text) {
  // 检查是否已经在使用 skill-evolver（不拦截 skill-evolver）
  if (text.includes('skill-evolver') || text.includes('/skill-evolver')) {
    return false;
  }
  
  // 检查是否匹配开发指令
  if (DEV_COMMANDS.some(cmd => text.includes(cmd))) {
    return true;
  }
  
  // 检查是否匹配开发任务关键词
  const lowerText = text.toLowerCase();
  if (DEV_TASK_KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase()))) {
    return true;
  }
  
  // 检查是否包含任务序号（如 T01、T02、T1、T2 等）
  const taskPattern = /\bT\d{1,3}\b/i;
  if (taskPattern.test(text)) {
    return true;
  }
  
  return false;
}

/**
 * 检查是否在执行规定指令（skill）
 * 排除 self-check 和 skill-evolver（避免循环触发）
 */
function checkSkillExecution(text) {
  // 如果已经在执行 self-check 或 skill-evolver，不记录
  if (text.includes('self-check') || text.includes('/self-check') ||
      text.includes('skill-evolver') || text.includes('/skill-evolver')) {
    return false;
  }
  
  // 检查是否以 / 开头（skill 调用）
  for (const pattern of SKILL_PATTERNS) {
    if (pattern instanceof RegExp) {
      if (pattern.test(text)) {
        return true;
      }
    } else if (text.includes(pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * 记录规定指令执行状态
 */
function recordSkillExecution(text, isSkillExecution) {
  try {
    const data = {
      timestamp: new Date().toISOString(),
      isSkillExecution: isSkillExecution,
      text: text.substring(0, 200)
    };
    fs.writeFileSync(SKILL_EXECUTION_FILE, JSON.stringify(data), 'utf8');
    console.error('[Hook:beforeSubmitPrompt] 记录规定指令执行状态:', isSkillExecution);
  } catch (e) {
    console.error('[Hook] 记录规定指令执行状态失败:', e.message);
  }
}

/**
 * 读取规定指令执行状态
 */
function readSkillExecution() {
  try {
    if (fs.existsSync(SKILL_EXECUTION_FILE)) {
      return JSON.parse(fs.readFileSync(SKILL_EXECUTION_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[Hook] 读取规定指令执行状态失败:', e.message);
  }
  return null;
}

/**
 * 清理规定指令执行状态
 */
function clearSkillExecution() {
  try {
    if (fs.existsSync(SKILL_EXECUTION_FILE)) {
      fs.unlinkSync(SKILL_EXECUTION_FILE);
    }
  } catch (e) {
    console.error('[Hook] 清理规定指令执行状态失败:', e.message);
  }
}

/**
 * 执行 git-commit-ai.js 脚本
 */
function executeGitCommitAi(projectRoot) {
  try {
    // 获取当前脚本所在目录（package 目录下的 scripts）
    const scriptDir = __dirname;
    const scriptPath = path.join(scriptDir, 'git-commit-ai.js');
    
    // 检查脚本是否存在
    if (!fs.existsSync(scriptPath)) {
      console.error('[Hook:stop] git-commit-ai.js 脚本不存在:', scriptPath);
      return null;
    }
    
    // 执行脚本
    const output = execSync(`node "${scriptPath}"`, { 
      encoding: 'utf8',
      cwd: projectRoot,
      shell: '/bin/bash',
      timeout: 60000,
      maxBuffer: 1024 * 1024
    });
    
    console.error('[Hook:stop] git-commit-ai.js 输出:', output);
    
    // 解析输出
    try {
      // 找到 JSON 输出行（最后一行）
      const lines = output.trim().split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith('{') && line.endsWith('}')) {
          return JSON.parse(line);
        }
      }
    } catch (parseError) {
      console.error('[Hook:stop] 解析 git-commit-ai.js 输出失败:', parseError.message);
    }
    
    return null;
  } catch (e) {
    console.error('[Hook:stop] 执行 git-commit-ai.js 失败:', e.message);
    return null;
  }
}

function main() {
  try {
    // 从 stdin 读取 JSON 输入
    let inputData = '';
    
    process.stdin.setEncoding('utf8');
    
    process.stdin.on('readable', () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        inputData += chunk;
      }
    });
    
    process.stdin.on('end', () => {
      try {
        const input = JSON.parse(inputData);
        const eventName = input.hook_event_name || '';
        
        // ==================== beforeSubmitPrompt hook ====================
        // 检测用户消息中的问题关键词，记录是否在执行规定指令
        if (eventName === 'beforeSubmitPrompt') {
          // 如果是 subagent 的 prompt，直接忽略不做任何记录
          if (input.is_sub_agent === true) {
            console.error('[Hook:beforeSubmitPrompt] 检测到 subagent prompt，忽略记录');
            process.exit(0);
          }
          
          const text = input.prompt || '';
          
          if (!text) {
            process.exit(0);
          }
          
          // 清理上一次的执行步骤记录（新 prompt 开始时重置）
          clearExecutionTrace();
          
          // 记录用户 prompt
          recordExecutionStep({
            type: 'user_prompt',
            text: text.substring(0, 500)
          });
          
          // 检查是否在执行规定指令（skill）
          const isSkillExecution = checkSkillExecution(text);
          recordSkillExecution(text, isSkillExecution);
          
          // 检测当前执行的 command，调用 update-stage.js 上报研发阶段
          if (isSkillExecution && text.startsWith('/')) {
            try {
              const updateStageScript = path.join(__dirname, 'update-stage.js');
              if (fs.existsSync(updateStageScript)) {
                const escapedText = text.replace(/"/g, '\\"').substring(0, 200);
                execSync(`node "${updateStageScript}" "${escapedText}"`, {
                  encoding: 'utf8',
                  shell: '/bin/bash',
                  timeout: 15000,
                  maxBuffer: 1024 * 1024
                });
                console.error('[Hook:beforeSubmitPrompt] update-stage 上报完成');
              }
            } catch (e) {
              console.error('[Hook:beforeSubmitPrompt] update-stage 上报失败:', e.message);
            }
          }
          
          // 检查是否命中继续/下一个关键词（触发 self-check 流程）
          if (checkDevTaskKeywords(text)) {
            console.error('[Hook:beforeSubmitPrompt] 检测到开发任务关键词，设置标记...');
            fs.writeFileSync(CONTINUE_MARKER_FILE, JSON.stringify({
              source: 'user',
              timestamp: new Date().toISOString(),
              text: text.substring(0, 200)
            }), 'utf8');
          }
          
          // 检查是否命中问题关键词
          if (checkIssueKeywords(text)) {
            console.error('[Hook:beforeSubmitPrompt] 检测到问题关键词，设置标记...');
            fs.writeFileSync(MARKER_FILE, JSON.stringify({
              source: 'user',
              timestamp: new Date().toISOString(),
              text: text.substring(0, 200)
            }), 'utf8');
          }
          
          process.exit(0);
        }
        
        // ==================== afterAgentResponse hook ====================
        // 记录 AI 操作日志和执行步骤
        if (eventName === 'afterAgentResponse') {
          const isSubAgent = input.is_sub_agent === true;
          
          if (isSubAgent) {
            console.error('[Hook:afterAgentResponse] 检测到 subagent 响应，记录但不触发后续动作');
          }
          
          const text = input.text || input.response || '';
          
          if (!text) {
            process.exit(0);
          }
          
          // 提取并记录执行步骤详情（用于自检比对）
          // 记录所有响应，包括 subagent，但在 stop 时会过滤
          const executionDetails = extractExecutionDetails(text);
          recordExecutionStep({
            type: 'agent_response',
            isSubAgent: isSubAgent,
            details: executionDetails,
            responseLength: text.length
          });
          
          process.exit(0);
        }
        
        // ==================== stop hook ====================
        // 会话结束时返回 followup_message
        if (eventName === 'stop') {
          const status = input.status || '';
          const loopCount = input.loop_count || 0;
          
          console.error(`[Hook:stop] 会话结束，状态: ${status}, 循环次数: ${loopCount}`);
          
          // 检查最近的执行记录，判断是否为 subagent
          const trace = readExecutionTrace();
          const lastRecord = trace.length > 0 ? trace[trace.length - 1] : null;
          const isLastFromSubAgent = lastRecord && lastRecord.agentType === 'subagent';
          
          console.error(`[Hook:stop] 最近记录类型: ${lastRecord ? lastRecord.agentType : '无记录'}, 是否为 subagent: ${isLastFromSubAgent}`);
          
          // 如果最近的记录是 subagent，不触发任何动作
          if (isLastFromSubAgent) {
            console.error('[Hook:stop] 最近记录来自 subagent，忽略触发问题标记或 self-check');
            clearSkillExecution();
            console.log(JSON.stringify({ followup_message: '' }));
            process.exit(0);
          }
          
          // 读取规定指令执行状态
          const skillExecution = readSkillExecution();
          const isSkillExecution = skillExecution && skillExecution.isSkillExecution;
          
          // 1. 优先检查问题标记
          if (fs.existsSync(MARKER_FILE)) {
            try {
              const issueData = JSON.parse(fs.readFileSync(MARKER_FILE, 'utf8'));
              console.error(`[Hook:stop] 检测到问题标记，来源: ${issueData.source}`);
              
              // 清理标记文件
              fs.unlinkSync(MARKER_FILE);
              clearSkillExecution();
              if (fs.existsSync(CONTINUE_MARKER_FILE)) {
                fs.unlinkSync(CONTINUE_MARKER_FILE);
              }
              
              // 返回 followup_message，提示用户使用 skill-evolver
              const output = {
                followup_message: '【此为AI自动触发】检测到本次对话中存在问题反馈，需要使用 skill-evolver 进行失败案例分析'
              };
              console.log(JSON.stringify(output));
              process.exit(0);
            } catch (e) {
              console.error(`[Hook:stop] 处理问题标记失败: ${e.message}`);
            }
          }
          
          //2. 检查继续/下一个标记（触发 self-check 流程）
          //只有 status 为 completed 时才触发
          // if (fs.existsSync(CONTINUE_MARKER_FILE) && status === 'completed') {
          //   try {
          //     const continueData = JSON.parse(fs.readFileSync(CONTINUE_MARKER_FILE, 'utf8'));
          //     console.error(`[Hook:stop] 检测到继续/下一个标记，来源: ${continueData.source}, 状态: ${status}`);
              
          //     // 清理标记文件
          //     fs.unlinkSync(CONTINUE_MARKER_FILE);
          //     clearSkillExecution();
              
          //     const projectRoot = findProjectRoot();
          //     const selfCheckContent = readSkillMd(projectRoot, 'self-check');
              
          //     // 生成执行摘要，附加到 followup_message 中
          //     const trace = readExecutionTrace();
          //     const summary = generateExecutionSummary(trace);
              
          //     let followupMsg = '【此为AI自动触发】检测到继续开发相关指令，开启subagent并读取.catpaw/skills/self-check/SKILL.md执行';
              
          //     // 将执行摘要写入临时文件供 self-check skill 读取
          //     const summaryFile = '/tmp/catpaw-execution-summary.txt';
          //     fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), 'utf8');
          //     console.error('[Hook:stop] 已生成执行摘要:', JSON.stringify(summary, null, 2));
              
          //     const output = {
          //       followup_message: followupMsg
          //     };
          //     console.log(JSON.stringify(output));
          //     process.exit(0);
          //   } catch (e) {
          //     console.error(`[Hook:stop] 处理继续标记失败: ${e.message}`);
          //   }
          // }
          
          // // 3. 检查是否在执行规定指令
          // // 只有 status 为 completed 时才触发
          // if (isSkillExecution && status === 'completed') {
          //   console.error('[Hook:stop] 检测到正在执行规定指令，状态为 completed，触发 self-check skill');
            
          //   // 清理标记文件
          //   clearSkillExecution();
            
          //   const projectRoot = findProjectRoot();
          //   const selfCheckContent = readSkillMd(projectRoot, 'self-check');
            
          //   let followupMsg = '【此为AI自动触发】检测到正在执行规定指令，开启subagent使用 self-check skill 进行流程自我检查';
            
          //   const output = {
          //     followup_message: followupMsg
          //   };
          //   console.log(JSON.stringify(output));
          //   process.exit(0);
          // }
          
          // 4. 检查开发任务标记，触发自动提交
          // 只有 status 为 completed 时才触发
          if (status === 'completed') {
            const projectRoot = findProjectRoot();
            
            // 只有存在开发任务标记时才触发自动提交
            if (fs.existsSync(CONTINUE_MARKER_FILE)) {
              console.error('[Hook:stop] 检测到开发任务标记，执行自动提交...');
              
              // 清理开发任务标记
              try {
                fs.unlinkSync(CONTINUE_MARKER_FILE);
              } catch (e) {
                console.error('[Hook:stop] 清理开发任务标记失败:', e.message);
              }
              
              // 执行 git-commit-ai.js 脚本
              const commitResult = executeGitCommitAi(projectRoot);
              
              if (commitResult && commitResult.success) {
                console.error(`[Hook:stop] 自动提交成功，commit hash: ${commitResult.commitHash}`);
                
                // 返回 followup_message 告知用户
                const output = {
                  followup_message: `【此为AI自动触发】已自动提交（commit: ${commitResult.commitHash}）并设置为 Spec Commit`
                };
                console.log(JSON.stringify(output));
                clearSkillExecution();
                process.exit(0);
              } else {
                console.error('[Hook:stop] 自动提交失败:', commitResult);
              }
            }
          }
          
          // 5. 无需后续消息
          clearSkillExecution();
          console.log(JSON.stringify({ followup_message: '' }));
          process.exit(0);
        }
        
        // 其他 hook 类型
        process.exit(0);
        
      } catch (parseError) {
        console.error(`[Hook Error] JSON 解析失败: ${parseError.message}`);
        process.exit(1);
      }
    });
    
  } catch (error) {
    console.error(`[Hook Error] ${error.message}`);
    process.exit(1);
  }
}

main();
