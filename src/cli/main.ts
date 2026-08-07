#!/usr/bin/env node

import { Command } from 'commander';
import { diffCommand } from '../commands/diff';
import { browseCommand } from '../commands/browse';
import { execTestsCommand } from '../commands/exec-tests';
import { reportCommand } from '../commands/report';
import { traceCommand } from '../commands/trace';
import { analyzeCommand } from '../commands/analyze';
import { serveCommand } from '../commands/serve';
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
  .description('运行完整变更影响测试流程 (支持 --resume 从 Step 2 续跑)')
  .option('-p, --project <paths>', '被测项目路径或 Git URL (--resume 时不需要)')
  .option('-b, --base <refs>', '基线版本 (与 --project 一一对应)')
  .option('-t, --target <refs>', '目标版本 (与 --project 一一对应)')
  .requiredOption('-u, --base-url <url>', '被测应用 URL')
  .option('--headed', '有头模式运行浏览器')
  .option('-o, --output <dir>', '输出目录', 'test-output')
  .option('--pages <routes>', '手动指定页面路由 (逗号分隔)')
  .option('--no-cleanup', '保留远程仓库克隆 (默认 pipeline 结束后自动清理)')
  .option('--no-clean', '保留上次运行的中间数据 (默认清除 diff/analysis/pages/results)')
  .option('--resume', '跳过 Step 1 (diff 已存在)，从 Step 2 续跑')
  .option('--no-wait', '不等待 Claude Code 写入文件，暂停后直接退出 (默认等待 600s)')
  .option('--wait-timeout <seconds>', '等待超时秒数', '600')
  .action(async (options) => {
    try {
      if (!options.resume) {
        if (!options.project || !options.base || !options.target) {
          throw new Error('--project, --base, --target are required (unless --resume)');
        }
      }
      const projects = options.resume
        ? []
        : parseProjects(options.project || '', options.base || '', options.target || '');
      await pipelineCommand({
        projects,
        baseUrl: options.baseUrl,
        headed: options.headed,
        output: options.output,
        pages: options.pages ? options.pages.split(',').map((s: string) => s.trim()) : undefined,
        cleanup: options.cleanup,
        clean: options.clean,
        resume: options.resume,
        wait: options.wait,
        waitTimeout: parseInt(options.waitTimeout, 10),
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
// trace — CodeGraph-powered impact tracing
// ============================================================
program
  .command('trace')
  .description('通过 CodeGraph 知识库追溯文件到前端页面的调用链')
  .requiredOption('-p, --project <path>', '被测项目路径')
  .option('--files <paths>', '要追溯的文件 (逗号分隔)')
  .option('--from-diff <dir>', '从 diff 目录读取变更文件列表')
  .option('--depth <n>', '追溯深度', '3')
  .option('-o, --output <dir>', '输出目录', 'test-output/trace')
  .action(async (options) => {
    try {
      await traceCommand({
        project: options.project,
        files: options.files ? options.files.split(',').map((s: string) => s.trim()) : undefined,
        fromDiff: options.fromDiff,
        depth: parseInt(options.depth, 10),
        output: options.output,
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
    analyzeCommand({
      diffDir: options.diff,
      output: options.output,
    });
  });

// ============================================================
// serve — Start visual dashboard server
// ============================================================
program
  .command('serve')
  .description('启动可视化 Dashboard (查看 Pipeline 进度和中间结果)')
  .option('-p, --port <n>', 'HTTP 端口', '3456')
  .option('-o, --output <dir>', '数据根目录', 'test-output')
  .option('--open', '自动打开浏览器')
  .action((options) => {
    serveCommand({ port: options.port, output: options.output, open: options.open });
  });

program.parse();
