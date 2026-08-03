#!/usr/bin/env node

import { Command } from 'commander';
import { diffCommand } from '../commands/diff';
import { browseCommand } from '../commands/browse';
import { execTestsCommand } from '../commands/exec-tests';
import { reportCommand } from '../commands/report';
import { pipelineCommand } from '../commands/pipeline';
import type { ProjectSpec } from '../types';

function parseProjects(projectRaw: string, baseRaw: string, targetRaw: string): ProjectSpec[] {
  const paths = projectRaw.split(',').map(s => s.trim()).filter(Boolean);
  const bases = baseRaw.split(',').map(s => s.trim()).filter(Boolean);
  const targets = targetRaw.split(',').map(s => s.trim()).filter(Boolean);

  if (paths.length === 0) throw new Error('At least one --project is required');
  if (paths.length !== bases.length) {
    throw new Error(`--project count (${paths.length}) does not match --base count (${bases.length})`);
  }
  if (paths.length !== targets.length) {
    throw new Error(`--project count (${paths.length}) does not match --target count (${targets.length})`);
  }

  return paths.map((p, i) => ({ path: p, baseRef: bases[i], targetRef: targets[i] }));
}

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
  .description('运行完整变更影响测试流程 (支持多项目，逗号分隔)')
  .requiredOption('-p, --project <paths>', '被测项目路径或 Git URL (支持多项目逗号分隔)')
  .requiredOption('-b, --base <refs>', '基线版本 (与 --project 一一对应，逗号分隔)')
  .requiredOption('-t, --target <refs>', '目标版本 (与 --project 一一对应，逗号分隔)')
  .requiredOption('-u, --base-url <url>', '被测应用 URL')
  .option('--headed', '有头模式运行浏览器')
  .option('-o, --output <dir>', '输出目录', 'test-output')
  .option('--pages <routes>', '手动指定页面路由 (逗号分隔)')
  .option('--no-cleanup', '保留远程仓库克隆 (默认 pipeline 结束后自动清理)')
  .action(async (options) => {
    try {
      const projects = parseProjects(options.project, options.base, options.target);
      await pipelineCommand({
        projects,
        baseUrl: options.baseUrl,
        headed: options.headed,
        output: options.output,
        pages: options.pages ? options.pages.split(',').map((s: string) => s.trim()) : undefined,
        cleanup: options.cleanup,
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
  .description('提取 Git Diff (支持多项目)')
  .requiredOption('-p, --project <paths>', '被测项目路径 (多项目逗号分隔)')
  .requiredOption('-b, --base <refs>', '基线版本 (逗号分隔)')
  .requiredOption('-t, --target <refs>', '目标版本 (逗号分隔)')
  .option('-o, --output <dir>', '输出目录', 'test-output/diff')
  .action(async (options) => {
    try {
      const projects = parseProjects(options.project, options.base, options.target);
      await diffCommand({ projects, output: options.output });
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
      await execTestsCommand({
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

    // Check if multi-project (projects.json exists)
    const projectsPath = path.join(diffDir, 'projects.json');
    if (fs.existsSync(projectsPath)) {
      // Multi-project mode
      const projects = JSON.parse(fs.readFileSync(projectsPath, 'utf-8'));
      console.log(`Multi-project analysis: ${projects.length} projects\n`);

      for (const proj of projects) {
        console.log(`### Project: ${path.basename(proj.projectPath)} (${proj.baseRef} → ${proj.targetRef})`);
        console.log(`Files: ${proj.stats.filesChanged} (+${proj.stats.additions}/-${proj.stats.deletions})`);
        if (proj.files.length > 0) {
          for (const f of proj.files.slice(0, 50)) {
            console.log(`  [${f.status}] ${f.path}`);
          }
          if (proj.files.length > 50) console.log(`  ... and ${proj.files.length - 50} more`);
        }
        console.log('');
      }
    } else {
      // Single project mode (backward compatible)
      const filesJson = fs.readFileSync(path.join(diffDir, 'files.json'), 'utf-8');
      const commitsJson = fs.readFileSync(path.join(diffDir, 'commits.json'), 'utf-8');
      const rawDiff = fs.readFileSync(path.join(diffDir, 'raw.diff'), 'utf-8');
      const files = JSON.parse(filesJson);
      const commits = JSON.parse(commitsJson);

      console.log(`## Changed Files (${files.length} files)`);
      console.log(files.map((f: any) => `- [${f.status}] ${f.path} (+${f.additions}/-${f.deletions})`).join('\n'));
      console.log(`\n## Commits (${commits.length} commits)`);
      console.log(commits.map((c: any) => `- ${c.hash}: ${c.message} (${c.author})`).join('\n'));
      console.log(`\n## Raw Diff (first 10000 chars)`);
      console.log(rawDiff.slice(0, 10000));
    }

    if (projectsPath && fs.existsSync(projectsPath)) {
      console.log(`\n## Task (Cross-Project Impact Analysis)`);
      console.log(`Analyze changes across ALL projects. Key considerations:`);
      console.log(`1. Backend API changes → which frontend pages call these APIs?`);
      console.log(`2. Frontend component changes → which backend endpoints are affected?`);
      console.log(`3. Identify cross-project dependencies and breaking changes.`);
    } else {
      console.log(`\n## Task`);
      console.log(`Analyze the changes above and identify affected frontend features.`);
    }

    console.log(`\nWrite impact analysis to: ${outputDir}/impact.json`);
  });

program.parse();
