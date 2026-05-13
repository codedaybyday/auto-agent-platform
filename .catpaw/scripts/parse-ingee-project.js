#!/usr/bin/env node

/**
 * 解析印迹设计稿项目数据
 * 
 * 用法：node parse-ingee-project.js <inputFile> [outputFile]
 * - inputFile: mtcli 返回的 JSON 文件路径
 * - outputFile: 可选，解析后的设计稿列表输出路径（默认输出到 stdout）
 * 
 * 示例：
 * node parse-ingee-project.js .catpaw/.tmp/ingee-project-212785.json
 * node parse-ingee-project.js .catpaw/.tmp/ingee-project-212785.json .catpaw/.tmp/designs-list.json
 */

const fs = require('fs');
const path = require('path');

// 解析命令行参数
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('用法: node parse-ingee-project.js <inputFile> [outputFile]');
  console.error('示例: node parse-ingee-project.js .catpaw/.tmp/ingee-project-212785.json');
  process.exit(1);
}

const inputFile = args[0];
const outputFile = args[1] || null;

// 检查输入文件是否存在
if (!fs.existsSync(inputFile)) {
  console.error(`错误: 文件不存在 - ${inputFile}`);
  process.exit(1);
}

// 读取并解析 JSON
let data;
try {
  const content = fs.readFileSync(inputFile, 'utf-8');
  data = JSON.parse(content);
} catch (err) {
  console.error(`错误: JSON 解析失败 - ${err.message}`);
  process.exit(1);
}

// 检查返回状态
if (data.status !== 0) {
  console.error(`错误: API 返回失败 - ${data.message || '未知错误'}`);
  process.exit(1);
}

// 提取项目信息
const projectInfo = {
  id: data.data.id,
  name: data.data.name,
  createdAt: data.data.created_at,
  updatedAt: data.data.updated_at
};

// 提取设计稿列表
const groups = data.data.groups || [];
const designs = [];

groups.forEach(group => {
  const images = group.images || [];
  images.forEach(img => {
    designs.push({
      id: img.id,
      name: img.name,
      groupId: group.id,
      groupName: group.name,
      width: img.detail ? JSON.parse(img.detail).width : null,
      height: img.detail ? JSON.parse(img.detail).height : null,
      updatedAt: img.updated_at,
      url: `https://ingee.meituan.com/#/artboard/${img.id}`
    });
  });
});

// 构建输出结果
const result = {
  project: projectInfo,
  summary: {
    totalGroups: groups.length,
    totalDesigns: designs.length
  },
  designs: designs
};

// 输出结果
if (outputFile) {
  // 确保输出目录存在
  const outputDir = path.dirname(outputFile);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`✓ 解析完成，结果已保存到: ${outputFile}`);
}

// 输出摘要到 stdout
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📋 设计稿项目解析结果');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`项目ID: ${projectInfo.id}`);
console.log(`项目名称: ${projectInfo.name}`);
console.log(`分组数量: ${groups.length}`);
console.log(`设计稿总数: ${designs.length}`);
console.log('');
console.log('设计稿列表:');
designs.forEach((d, index) => {
  console.log(`  ${index + 1}. [${d.id}] ${d.name} (${d.groupName})`);
});
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// 如果没有指定输出文件，输出完整 JSON
if (!outputFile) {
  console.log('');
  console.log('完整 JSON 输出:');
  console.log(JSON.stringify(result, null, 2));
}
