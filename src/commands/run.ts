import path from 'path';
import { diffCommand } from './diff';
import { browseCommand } from './browse';
import { executeCommand } from './execute';
import { reportCommand } from './report';
import type { ImpactAnalysis } from '../types';

export interface RunCommandOptions {
  project: string;
  base: string;
  target: string;
  baseUrl: string;
  headed?: boolean;
  output?: string;
  pages?: string[];
}

/**
 * Full pipeline: diff → (AI analysis → browse → AI test gen) → execute → report
 *
 * Steps 2 and 4 (AI analysis & test generation) are handled by Claude Code,
 * which reads the intermediate files and writes structured JSON.
 * This command handles the deterministic engineering steps (1, 3, 5, 6).
 */
export async function runCommand(options: RunCommandOptions): Promise<void> {
  const outputRoot = options.output || path.join(process.cwd(), 'test-output');
  const diffDir = path.join(outputRoot, 'diff');
  const analysisDir = path.join(outputRoot, 'analysis');
  const pagesDir = path.join(outputRoot, 'pages');
  const testsDir = path.join(outputRoot, 'tests');
  const resultsDir = path.join(outputRoot, 'results');

  console.log('╔══════════════════════════════════════╗');
  console.log('║   E2E Change-Impact Test Pipeline   ║');
  console.log('╚══════════════════════════════════════╝\n');

  // ---- Step 1: Extract Git Diff ----
  console.log('━━━ Step 1/6: Extracting Git Diff ━━━');
  await diffCommand({
    project: options.project,
    base: options.base,
    target: options.target,
    output: diffDir,
  });

  console.log(`\n📋 Step 2/6: AI Impact Analysis`);
  console.log('   This step requires Claude Code to analyze the diff.');
  console.log(`   Diff data is at: ${diffDir}`);
  console.log(`   Please ask Claude Code to read the diff files and`);
  console.log(`   generate an impact analysis JSON at: ${analysisDir}/impact.json`);
  console.log(`   (Or run 'e2e-test analyze' to do this interactively)`);

  // Pause: Claude Code needs to do the analysis
  console.log(`\n   ⏸️  Waiting for AI analysis... (press Enter to continue after analysis is done)`);

  // ---- Step 3: Browse Affected Pages ----
  const impactPath = path.join(analysisDir, 'impact.json');
  const fs = await import('fs');

  let pagesToBrowse = options.pages || [];
  if (pagesToBrowse.length === 0 && fs.existsSync(impactPath)) {
    const analysis: ImpactAnalysis = JSON.parse(fs.readFileSync(impactPath, 'utf-8'));
    pagesToBrowse = analysis.affectedPages.map(p => p.route);
  }

  if (pagesToBrowse.length > 0) {
    console.log(`\n━━━ Step 3/6: Browsing Affected Pages ━━━`);
    await browseCommand({
      baseUrl: options.baseUrl,
      pages: pagesToBrowse,
      output: pagesDir,
      headed: options.headed,
    });
  } else {
    console.log(`\n⏭️  Step 3/6: Skipped (no pages to browse)`);
  }

  // ---- Step 4: AI Test Generation ----
  console.log(`\n📋 Step 4/6: AI Test Generation`);
  console.log('   This step requires Claude Code to generate Playwright tests.');
  console.log(`   Page data is at: ${pagesDir}`);
  console.log(`   Analysis is at: ${analysisDir}/impact.json`);
  console.log(`   Please ask Claude Code to generate tests at: ${testsDir}/`);
  console.log(`   (Or run 'e2e-test generate' to do this interactively)`);

  // ---- Step 5: Execute Tests ----
  if (fs.existsSync(testsDir)) {
    console.log(`\n━━━ Step 5/6: Executing Tests ━━━`);
    await executeCommand({
      testDir: testsDir,
      baseUrl: options.baseUrl,
      headed: options.headed,
      output: outputRoot,
    });
  } else {
    console.log(`\n⏭️  Step 5/6: Skipped (no tests to execute)`);
  }

  // ---- Step 6: Generate Report ----
  console.log(`\n━━━ Step 6/6: Generating Report ━━━`);
  reportCommand({
    results: path.join(resultsDir, 'results.json'),
    analysis: impactPath,
    output: path.join(outputRoot, 'reports'),
    project: options.project,
    baseRef: options.base,
    targetRef: options.target,
    baseUrl: options.baseUrl,
  });

  console.log(`\n✅ Pipeline complete!`);
  console.log(`   Report: ${path.join(outputRoot, 'reports', 'change-report.md')}`);
}
