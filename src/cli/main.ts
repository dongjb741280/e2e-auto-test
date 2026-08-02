#!/usr/bin/env node

import { Command } from 'commander';
import { diffCommand } from '../commands/diff';
import { browseCommand } from '../commands/browse';
import { executeCommand } from '../commands/execute';
import { reportCommand } from '../commands/report';
import { runCommand } from '../commands/run';

const program = new Command();

program
  .name('e2e-test')
  .description('E2E Change-Impact Testing Tool — 基于 Git Diff + AI 的增量测试工具')
  .version('0.1.0');

// ============================================================
// run — Full pipeline
// ============================================================
program
  .command('run')
  .description('运行完整变更影响测试流程 (diff → 分析 → 浏览 → 生成 → 执行 → 报告)')
  .requiredOption('-p, --project <path>', '被测项目路径 (git repo)')
  .requiredOption('-b, --base <ref>', '基线版本 (commit/branch/tag)')
  .requiredOption('-t, --target <ref>', '目标版本 (commit/branch/tag)')
  .requiredOption('-u, --base-url <url>', '被测应用 URL')
  .option('--headed', '有头模式运行浏览器')
  .option('-o, --output <dir>', '输出目录', 'test-output')
  .option('--pages <routes>', '手动指定页面路由 (逗号分隔)')
  .action(async (options) => {
    try {
      await runCommand({
        project: options.project,
        base: options.base,
        target: options.target,
        baseUrl: options.baseUrl,
        headed: options.headed,
        output: options.output,
        pages: options.pages ? options.pages.split(',').map((s: string) => s.trim()) : undefined,
      });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ============================================================
// diff — Extract git diff
// ============================================================
program
  .command('diff')
  .description('提取两个版本间的 Git Diff')
  .requiredOption('-p, --project <path>', '被测项目路径 (git repo)')
  .requiredOption('-b, --base <ref>', '基线版本 (commit/branch/tag)')
  .requiredOption('-t, --target <ref>', '目标版本 (commit/branch/tag)')
  .option('-o, --output <dir>', '输出目录', 'test-output/diff')
  .action(async (options) => {
    try {
      await diffCommand({
        project: options.project,
        base: options.base,
        target: options.target,
        output: options.output,
      });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ============================================================
// browse — Scrape page DOM
// ============================================================
program
  .command('browse')
  .description('浏览页面并提取 DOM 结构和交互元素')
  .requiredOption('-u, --base-url <url>', '被测应用 URL')
  .requiredOption('--pages <routes>', '页面路由 (逗号分隔，如 /,/login,/dashboard)')
  .option('--headed', '有头模式')
  .option('-o, --output <dir>', '输出目录', 'test-output/pages')
  .action(async (options) => {
    try {
      await browseCommand({
        baseUrl: options.baseUrl,
        pages: options.pages.split(',').map((s: string) => s.trim()),
        headed: options.headed,
        output: options.output,
      });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ============================================================
// execute — Run Playwright tests
// ============================================================
program
  .command('execute')
  .description('执行 Playwright 测试用例')
  .requiredOption('-d, --test-dir <dir>', '测试文件目录')
  .requiredOption('-u, --base-url <url>', '被测应用 URL')
  .option('--headed', '有头模式')
  .option('-o, --output <dir>', '输出目录', 'test-output')
  .action(async (options) => {
    try {
      await executeCommand({
        testDir: options.testDir,
        baseUrl: options.baseUrl,
        headed: options.headed,
        output: options.output,
      });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ============================================================
// report — Generate change report
// ============================================================
program
  .command('report')
  .description('生成变更影响测试报告')
  .option('-r, --results <path>', '测试结果 JSON 路径')
  .option('-a, --analysis <path>', '影响分析 JSON 路径')
  .option('-o, --output <dir>', '输出目录', 'test-output/reports')
  .option('--project <name>', '项目名称')
  .option('--base-ref <ref>', '基线版本')
  .option('--target-ref <ref>', '目标版本')
  .option('--base-url <url>', '被测应用 URL')
  .action((options) => {
    try {
      reportCommand({
        results: options.results,
        analysis: options.analysis,
        output: options.output,
        project: options.project,
        baseRef: options.baseRef,
        targetRef: options.targetRef,
        baseUrl: options.baseUrl,
      });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ============================================================
// analyze — Output prompt for Claude Code to analyze
// ============================================================
program
  .command('analyze')
  .description('输出 AI 分析提示（供 Claude Code 使用）')
  .option('-d, --diff-dir <dir>', 'Diff 输出目录', 'test-output/diff')
  .option('-o, --output <dir>', '分析结果输出目录', 'test-output/analysis')
  .action((options) => {
    const fs = require('fs');
    const path = require('path');

    const diffDir = options.diff;
    const outputDir = options.output;

    if (!fs.existsSync(diffDir)) {
      console.error(`Diff directory not found: ${diffDir}`);
      console.error('Run "e2e-test diff" first.');
      process.exit(1);
    }

    // Read the diff data
    const filesJson = fs.readFileSync(path.join(diffDir, 'files.json'), 'utf-8');
    const commitsJson = fs.readFileSync(path.join(diffDir, 'commits.json'), 'utf-8');
    const rawDiff = fs.readFileSync(path.join(diffDir, 'raw.diff'), 'utf-8');

    const files = JSON.parse(filesJson);
    const commits = JSON.parse(commitsJson);

    // Create the analysis prompt for Claude Code
    const prompt = `
You are analyzing a git diff to identify affected frontend features and pages.

## Changed Files (${files.length} files)
${files.map((f: any) => `- [${f.status}] ${f.path} (+${f.additions}/-${f.deletions})`).join('\n')}

## Commits (${commits.length} commits)
${commits.map((c: any) => `- ${c.hash}: ${c.message} (${c.author})`).join('\n')}

## Raw Diff (first 10000 chars)
${rawDiff.slice(0, 10000)}

## Task
Analyze the changes above and identify:
1. Which frontend pages/routes are affected
2. What is the nature of each change (new feature, bug fix, UI modification, etc.)
3. What test scenarios should be written for each affected page

## Output Format
Write a JSON file to \`${outputDir}/impact.json\` with this structure:
\`\`\`json
{
  "summary": "One-sentence summary of the overall change",
  "affectedPages": [
    {
      "route": "/login",
      "name": "用户登录页",
      "changeType": "modified",
      "changeDescription": "Added form validation for email field",
      "impactedFiles": ["src/pages/Login.tsx", "src/utils/validate.ts"],
      "testScenarios": [
        {
          "name": "Empty email field should show validation error",
          "priority": "P0",
          "steps": ["Navigate to /login", "Leave email field empty", "Click submit"],
          "expectedResult": "Displays 'Email is required' error message"
        }
      ]
    }
  ],
  "riskLevel": "low|medium|high",
  "recommendation": "Suggested actions before deployment"
}
\`\`\`

Focus on USER-FACING frontend features only. Ignore backend-only, config, or test file changes.
`;

    console.log(prompt);
    console.log(`\n---`);
    console.log(`Save analysis to: ${outputDir}/impact.json`);
  });

program.parse();
