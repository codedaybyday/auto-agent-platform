#!/usr/bin/env node
// git-commit-ai.js
// 自动执行 git commit（标记 AI 提交），并调用 ai-coding-stats setSpecCommit
// 检测 git diff 中是否有符合 spec-config.json 配置的目录和文件类型的变更

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * 查找项目根目录
 */
function findProjectRoot() {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

/**
 * 读取 spec-config.json 配置
 * @returns {{ base_branch: string, fileExtensions: string[], includeDirectories: string[] } | null}
 */
function readSpecConfig(projectRoot) {
  const configPath = path.join(projectRoot, 'spec-config.json');
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error('[git-commit-ai] 解析 spec-config.json 失败:', e.message);
    return null;
  }
}

/**
 * 获取 git diff 中的变更文件列表（包括暂存、未暂存和未跟踪的文件）
 */
function getChangedFiles() {
  const files = new Set();

  // 暂存的文件
  try {
    const staged = execSync('git diff --cached --name-only', { encoding: 'utf8', shell: '/bin/bash' }).trim();
    if (staged) staged.split('\n').forEach(f => f && files.add(f));
  } catch (e) { /* ignore */ }

  // 未暂存的文件
  try {
    const unstaged = execSync('git diff --name-only', { encoding: 'utf8', shell: '/bin/bash' }).trim();
    if (unstaged) unstaged.split('\n').forEach(f => f && files.add(f));
  } catch (e) { /* ignore */ }

  // 未跟踪的文件
  try {
    const untracked = execSync('git ls-files --others --exclude-standard', { encoding: 'utf8', shell: '/bin/bash' }).trim();
    if (untracked) untracked.split('\n').forEach(f => f && files.add(f));
  } catch (e) { /* ignore */ }

  return Array.from(files);
}

/**
 * 检查变更文件是否符合 spec-config.json 配置
 * @param {string[]} changedFiles - 变更文件列表
 * @param {{ fileExtensions: string[], includeDirectories: string[] }} config - spec 配置
 * @returns {{ hasMatch: boolean, matchedFiles: string[] }}
 */
function checkChangedFiles(changedFiles, config) {
  const fileExtensions = config.fileExtensions || [];
  const includeDirectories = config.includeDirectories || [];

  const matchedFiles = [];

  for (const file of changedFiles) {
    let matchesDir = true;
    let matchesExt = true;

    // 检查目录过滤
    if (includeDirectories.length > 0) {
      matchesDir = includeDirectories.some(dir => file.startsWith(dir));
    }

    // 检查文件扩展名过滤
    if (fileExtensions.length > 0) {
      const ext = path.extname(file);
      matchesExt = fileExtensions.includes(ext);
    }

    if (matchesDir && matchesExt) {
      matchedFiles.push(file);
    }
  }

  return {
    hasMatch: matchedFiles.length > 0,
    matchedFiles
  };
}

/**
 * 只添加符合配置的文件到 git 暂存区
 * @param {string[]} files - 要添加的文件列表
 */
function gitAddFiles(files) {
  try {
    for (const file of files) {
      execSync(`git add "${file}"`, { encoding: 'utf8', shell: '/bin/bash' });
    }
    return true;
  } catch (e) {
    console.error('[git-commit-ai] git add 失败:', e.message);
    return false;
  }
}

/**
 * 添加所有变更到 git 暂存区
 */
function gitAddAll() {
  try {
    execSync('git add -A', { encoding: 'utf8', shell: '/bin/bash' });
    return true;
  } catch (e) {
    console.error('[git-commit-ai] git add 失败:', e.message);
    return false;
  }
}

/**
 * 执行 git commit（标记 AI 提交）
 */
function gitCommitAi(message) {
  const commitMessage = message || '[AI Generated] Spec Coding 自动提交';

  try {
    execSync(`git commit --no-verify -m "${commitMessage.replace(/"/g, '\\"')}"`, {
      encoding: 'utf8',
      shell: '/bin/bash',
      timeout: 30000,
      maxBuffer: 1024 * 1024
    });
    return true;
  } catch (e) {
    console.error('[git-commit-ai] git commit 失败:', e.message);
    return false;
  }
}

/**
 * 获取最新的 commit hash
 */
function getLatestCommitHash() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', shell: '/bin/bash' }).trim();
  } catch (e) {
    return null;
  }
}

/**
 * 执行 ai-coding-stats setSpecCommit
 */
function setSpecCommit(commits) {
  return new Promise((resolve) => {
    const commitStr = Array.isArray(commits) ? commits.join(',') : commits;
    
    const child = spawn('ai-coding-stats', ['setSpecCommit', '--commits', commitStr], {
      stdio: 'inherit',
      shell: true
    });

    child.on('error', (error) => {
      console.error('[git-commit-ai] setSpecCommit 执行错误:', error.message);
      resolve(false);
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.error('[git-commit-ai] setSpecCommit 执行成功');
        resolve(true);
      } else {
        console.error('[git-commit-ai] setSpecCommit 退出码:', code);
        resolve(false);
      }
    });
  });
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  const projectRoot = findProjectRoot();

  console.error('[git-commit-ai] 项目根目录:', projectRoot);
  console.error('[git-commit-ai] 参数:', args);

  // 读取 spec-config.json 配置
  const specConfig = readSpecConfig(projectRoot);
  if (specConfig) {
    console.error('[git-commit-ai] spec-config.json 配置:', JSON.stringify(specConfig, null, 2));
  } else {
    console.error('[git-commit-ai] spec-config.json 不存在，不过滤文件');
  }

  // 获取变更文件列表
  const changedFiles = getChangedFiles();
  if (changedFiles.length === 0) {
    console.error('[git-commit-ai] 没有需要提交的变更');
    console.log(JSON.stringify({ 
      success: false, 
      reason: 'no_changes',
      message: '没有需要提交的变更'
    }));
    process.exit(0);
  }

  console.error(`[git-commit-ai] 检测到 ${changedFiles.length} 个变更文件`);

  // 检查变更文件是否符合 spec-config 配置
  const filterConfig = specConfig || { fileExtensions: [], includeDirectories: [] };
  const { hasMatch, matchedFiles } = checkChangedFiles(changedFiles, filterConfig);

  if (!hasMatch) {
    console.error('[git-commit-ai] 变更文件不符合 spec-config.json 配置的目录或文件类型，跳过提交');
    console.log(JSON.stringify({ 
      success: false, 
      reason: 'no_matching_changes',
      message: '变更文件不符合配置的目录或文件类型',
      changedFiles,
      config: filterConfig
    }));
    process.exit(0);
  }

  console.error(`[git-commit-ai] 符合配置的变更文件 (${matchedFiles.length}/${changedFiles.length}):`);
  matchedFiles.forEach(f => console.error(`  - ${f}`));

  // 添加符合配置的文件到暂存区
  console.error('[git-commit-ai] 执行 git add...');
  if (!gitAddFiles(matchedFiles)) {
    console.log(JSON.stringify({ 
      success: false, 
      reason: 'git_add_failed',
      message: 'git add 失败'
    }));
    process.exit(1);
  }

  // 解析自定义提交消息
  let commitMessage = null;
  const msgIndex = args.indexOf('-m');
  const msgIndexLong = args.indexOf('--message');
  if (msgIndex !== -1 && args[msgIndex + 1]) {
    commitMessage = args[msgIndex + 1];
  } else if (msgIndexLong !== -1 && args[msgIndexLong + 1]) {
    commitMessage = args[msgIndexLong + 1];
  }

  // 执行 git commit
  console.error('[git-commit-ai] 执行 git commit...');
  if (!gitCommitAi(commitMessage)) {
    console.log(JSON.stringify({ 
      success: false, 
      reason: 'git_commit_failed',
      message: 'git commit 失败'
    }));
    process.exit(1);
  }

  // 获取新的 commit hash
  const commitHash = getLatestCommitHash();
  console.error('[git-commit-ai] 提交成功，commit hash:', commitHash);

  // 执行 ai-coding-stats setSpecCommit
  if (commitHash) {
    console.error('[git-commit-ai] 执行 ai-coding-stats setSpecCommit...');
    await setSpecCommit(commitHash);
  }

  // 返回成功结果
  const result = {
    success: true,
    commitHash: commitHash,
    matchedFiles: matchedFiles,
    totalChangedFiles: changedFiles.length,
    message: 'AI 代码提交成功'
  };

  console.log(JSON.stringify(result));
  process.exit(0);
}

main().catch((error) => {
  console.error('[git-commit-ai] 执行错误:', error.message);
  process.exit(1);
});
