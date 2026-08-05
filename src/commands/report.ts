import fs from 'fs';
import path from 'path';
import { writeReport } from '../reporter';
import type { ChangeReport, ImpactAnalysis, DiffStats, ExecutionResult } from '../types';

export interface ReportCommandOptions {
  results?: string;
  analysis?: string;
  output?: string;
  project?: string;
  baseRef?: string;
  targetRef?: string;
  baseUrl?: string;
}

export function reportCommand(options: ReportCommandOptions): string {
  const outputDir = options.output || path.join(process.cwd(), 'test-output', 'reports');

  function safeJSON<T>(filePath: string, fallback: T): T {
    try {
      if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch { /* corrupt JSON — use fallback */ }
    return fallback;
  }

  // Load analysis
  const defaultAnalysis = path.join(process.cwd(), 'test-output', 'analysis', 'impact.json');
  const analysis: ImpactAnalysis = safeJSON(options.analysis || defaultAnalysis, {
    summary: 'No analysis found', affectedPages: [], riskLevel: 'low' as const, recommendation: '',
  });

  // Load results
  const defaultResults = path.join(process.cwd(), 'test-output', 'results', 'results.json');
  const results: ExecutionResult[] = safeJSON(options.results || defaultResults, []);

  // Load diff stats (supports multi-project summary.json)
  let diff: DiffStats = { additions: 0, deletions: 0, filesChanged: 0 };
  const summaryPath = path.join(process.cwd(), 'test-output', 'diff', 'summary.json');
  const filesJsonPath = path.join(process.cwd(), 'test-output', 'diff', 'files.json');
  if (fs.existsSync(summaryPath)) {
    diff = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
  } else if (fs.existsSync(filesJsonPath)) {
    const files = JSON.parse(fs.readFileSync(filesJsonPath, 'utf-8'));
    diff = {
      additions: files.reduce((s: number, f: { additions: number }) => s + f.additions, 0),
      deletions: files.reduce((s: number, f: { deletions: number }) => s + f.deletions, 0),
      filesChanged: files.length,
    };
  }

  const report: ChangeReport = {
    meta: {
      projects: options.project ? options.project.split(',') : ['unknown'],
      baseRef: options.baseRef || 'unknown',
      targetRef: options.targetRef || 'unknown',
      baseUrl: options.baseUrl || 'unknown',
      generatedAt: new Date().toISOString(),
    },
    diff,
    analysis,
    tests: {
      generated: results.length,
      passed: results.filter(r => r.status === 'passed').length,
      failed: results.filter(r => r.status === 'failed').length,
      details: results,
    },
    conclusion: generateConclusion(analysis, results),
  };

  const mdPath = writeReport(report, outputDir);
  console.log(`Report written to: ${mdPath}`);
  return mdPath;
}

function generateConclusion(analysis: ImpactAnalysis, results: ExecutionResult[]): string {
  const failed = results.filter(r => r.status === 'failed').length;
  const allPassed = results.length > 0 && failed === 0;

  if (results.length === 0) {
    return '未生成增量测试用例。建议根据影响分析手动验证受影响页面的功能。';
  }

  if (allPassed) {
    return `所有 ${results.length} 个增量测试用例均已通过。变更风险等级: ${analysis.riskLevel}。建议合并前进行 Code Review。`;
  }

  return `${results.length} 个测试用例中有 ${failed} 个失败。` +
    `变更风险等级: ${analysis.riskLevel}。` +
    `建议修复失败的测试用例后重新验证。` +
    `${analysis.recommendation ? `\n\n建议: ${analysis.recommendation}` : ''}`;
}
