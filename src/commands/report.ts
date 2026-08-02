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

  // Load analysis
  let analysis: ImpactAnalysis = { summary: 'No analysis found', affectedPages: [], riskLevel: 'low', recommendation: '' };
  if (options.analysis && fs.existsSync(options.analysis)) {
    analysis = JSON.parse(fs.readFileSync(options.analysis, 'utf-8'));
  } else {
    // Try default path
    const defaultAnalysis = path.join(process.cwd(), 'test-output', 'analysis', 'impact.json');
    if (fs.existsSync(defaultAnalysis)) {
      analysis = JSON.parse(fs.readFileSync(defaultAnalysis, 'utf-8'));
    }
  }

  // Load results
  let results: ExecutionResult[] = [];
  if (options.results && fs.existsSync(options.results)) {
    results = JSON.parse(fs.readFileSync(options.results, 'utf-8'));
  } else {
    const defaultResults = path.join(process.cwd(), 'test-output', 'results', 'results.json');
    if (fs.existsSync(defaultResults)) {
      results = JSON.parse(fs.readFileSync(defaultResults, 'utf-8'));
    }
  }

  // Load diff stats
  let diff: DiffStats = { additions: 0, deletions: 0, filesChanged: 0 };
  const diffPath = path.join(process.cwd(), 'test-output', 'diff', 'files.json');
  if (fs.existsSync(diffPath)) {
    const files = JSON.parse(fs.readFileSync(diffPath, 'utf-8'));
    diff = {
      additions: files.reduce((s: number, f: { additions: number }) => s + f.additions, 0),
      deletions: files.reduce((s: number, f: { deletions: number }) => s + f.deletions, 0),
      filesChanged: files.length,
    };
  }

  const report: ChangeReport = {
    meta: {
      project: options.project || 'unknown',
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
