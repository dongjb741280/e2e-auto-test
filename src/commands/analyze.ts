import fs from 'fs';
import path from 'path';
import { buildAnalyzePrompt, loadExistingAnalysis } from '../ai/prompt';

export interface AnalyzeCommandOptions {
  diffDir?: string;
  traceDir?: string;
  output?: string;
}

export function analyzeCommand(options: AnalyzeCommandOptions): string {
  const diffDir = options.diffDir || path.join(process.cwd(), 'test-output', 'diff');
  const traceDir = options.traceDir || path.join(process.cwd(), 'test-output', 'trace');
  const outputDir = options.output || path.join(process.cwd(), 'test-output', 'analysis');

  if (!fs.existsSync(diffDir)) {
    console.error(`Diff directory not found: ${diffDir}`);
    console.error('Run "e2e-test diff" first.');
    process.exit(1);
  }

  // Check for existing analysis
  const existing = loadExistingAnalysis(outputDir);
  if (existing) {
    console.log(`Analysis already exists (${existing.affectedPages?.length || 0} affected pages).`);
    console.log(`To regenerate, delete: ${path.join(outputDir, 'impact.json')}`);
    return path.join(outputDir, 'impact.json');
  }

  const { prompt, summary } = buildAnalyzePrompt({
    diffDir,
    traceDir: fs.existsSync(path.join(traceDir, 'trace.json')) ? traceDir : undefined,
  });

  // Save the prompt for Claude Code
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'analyze-prompt.md'), prompt);

  // Print summary
  console.log(`Files: ${summary.fileCount} | Commits: ${summary.commitCount}`);
  if (summary.traceChains > 0) {
    console.log(`Trace chains: ${summary.traceChains} (${summary.traceLowConfidence} low-confidence)`);
    console.log(`Candidate pages: ${summary.traceHighPages}`);
  }
  console.log(`Prompt saved: ${path.join(outputDir, 'analyze-prompt.md')} (${(summary.diffSizeBytes / 1024).toFixed(1)} KB)`);
  console.log(`Output expected: ${path.join(outputDir, 'impact.json')}`);

  // Also print the prompt to stdout for inline Claude Code use
  console.log('\n' + '='.repeat(60));
  console.log(prompt);

  return path.join(outputDir, 'impact.json');
}
