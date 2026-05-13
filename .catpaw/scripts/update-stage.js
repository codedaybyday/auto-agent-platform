#!/usr/bin/env node
// update-stage.js
// 根据当前执行的 command 映射到研发阶段，调用 ai-coding-stats updateStage 上报

const { execSync } = require('child_process');

// 命令到阶段的映射配置
// stage 值与 ai-coding-stats updateStage --stage 参数保持一致
const STAGE_MAPPING = {
  // 需求分析阶段
  '需求分析': {
    commands: ['/01 仅需求解析', '/02 仅需求评审'],
    stage: '需求分析'
  },
  // 方案设计阶段
  '方案设计': {
    commands: ['/04 仅技术方案生成', '/05 仅技术方案评审'],
    stage: '方案设计'
  },
  // 编码阶段
  '编码': {
    commands: ['/03 UI设计稿确认', '/06 单测生成', '/07 任务拆分', '/08 代码开发', '/09 监控埋点上报'],
    stage: '编码'
  },
  // 测试阶段
  '测试': {
    commands: ['/10 代码CR'],
    stage: '测试'
  },
  // 归档阶段
  '归档': {
    commands: ['/11 知识库同步', '/12 AI编码统计上报', '/13 PR发起', '/14 环境部署'],
    stage: '归档'
  }
};

/**
 * 根据命令文本匹配阶段
 * @param {string} commandText - 用户输入的命令文本
 * @returns {{ stage: string, label: string } | null}
 */
function matchStage(commandText) {
  for (const [, config] of Object.entries(STAGE_MAPPING)) {
    for (const cmd of config.commands) {
      if (commandText.includes(cmd)) {
        return { stage: config.stage };
      }
    }
  }
  return null;
}

/**
 * 调用 ai-coding-stats updateStage 上报阶段信息
 * @param {string} stage - 阶段名称（需求分析|方案设计|编码|测试|归档）
 * @param {string} command - 触发的命令
 */
function updateStage(stage, command) {
  try {
    const cmd = `ai-coding-stats updateStage --stage "${stage}" --type "command" --value "${command}" --tips "执行${stage}阶段命令: ${command}" --submit`;
    execSync(cmd, {
      encoding: 'utf8',
      shell: '/bin/bash',
      timeout: 15000,
      maxBuffer: 1024 * 1024
    });
    console.error(`[update-stage] 上报成功: stage=${stage}, command=${command}`);
    return true;
  } catch (e) {
    console.error('[update-stage] 上报失败:', e.message);
    return false;
  }
}

/**
 * 主函数
 */
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('[update-stage] 缺少参数，用法: node update-stage.js <command>');
    process.exit(1);
  }

  const commandText = args.join(' ');
  console.error('[update-stage] 输入命令:', commandText);

  const matched = matchStage(commandText);
  if (!matched) {
    console.error('[update-stage] 未匹配到任何阶段，跳过上报');
    console.log(JSON.stringify({ success: false, reason: 'no_matching_stage' }));
    process.exit(0);
  }

  console.error(`[update-stage] 匹配到阶段: ${matched.stage}`);

  const success = updateStage(matched.stage, commandText);
  const result = {
    success,
    stage: matched.stage,
    command: commandText
  };

  console.log(JSON.stringify(result));
  process.exit(success ? 0 : 1);
}

main();
