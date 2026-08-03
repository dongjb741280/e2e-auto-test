import path from 'path';
import fs from 'fs';
import { diffCommand } from './diff';
import { browseCommand } from './browse';
import { execTestsCommand } from './exec-tests';
import { reportCommand } from './report';
import { isRemoteUrl, clearCloneCache } from '../git/diff';
import type { ProjectSpec, ImpactAnalysis } from '../types';

export interface PipelineOptions {
  projects: ProjectSpec[];
  baseUrl: string;
  headed?: boolean;
  output?: string;
  pages?: string[];
  cleanup?: boolean;
}

/**
 * Full pipeline: diff → (AI analysis → browse → AI test gen) → execute → report
 */
export async function pipelineCommand(options: PipelineOptions): Promise<void> {
  const { projects, baseUrl, cleanup = true } = options;
  const outputRoot = options.output || path.join(process.cwd(), 'test-output');
  const diffDir = path.join(outputRoot, 'diff');
  const analysisDir = path.join(outputRoot, 'analysis');
  const pagesDir = path.join(outputRoot, 'pages');
  const testsDir = path.join(outputRoot, 'tests');
  const resultsDir = path.join(outputRoot, 'results');
  const cacheDir = path.join(outputRoot, '.repos');

  const hasRemote = projects.some(p => isRemoteUrl(p.path));

  console.log('╔══════════════════════════════════════╗');
  console.log('║   E2E Change-Impact Test Pipeline   ║');
  console.log('╚══════════════════════════════════════╝\n');

  if (hasRemote) {
    console.log(`Remote repo(s) detected — will clone to ${path.resolve(cacheDir)}/`);
    console.log(`Cleanup after pipeline: ${cleanup ? 'yes' : 'no'} (use --no-cleanup to keep)`);
  }

  if (projects.length > 1) {
    console.log(`\nMulti-project mode: ${projects.length} projects`);
  }
  for (const p of projects) {
    const label = isRemoteUrl(p.path) ? `[remote] ${path.basename(p.path, '.git')}` : p.path;
    console.log(`  ${label}: ${p.baseRef} → ${p.targetRef}`);
  }
  console.log('');

  // ---- Step 1: Extract Git Diff (all projects) ----
  console.log('━━━ Step 1/6: Extracting Git Diff ━━━');
  const { output: multiDiff } = await diffCommand({
    projects,
    output: diffDir,
  });

  // ---- Step 2: AI Impact Analysis ----
  console.log(`\n📋 Step 2/6: AI Impact Analysis`);
  console.log('   This step requires Claude Code to analyze the diff.');
  console.log(`   Diff data is at: ${diffDir}/`);

  if (projects.length > 1) {
    console.log(`   Each project has its own subdirectory under ${diffDir}/`);
    console.log(`   Aggregated summary: ${diffDir}/summary.json`);
    console.log(`   Cross-project analysis: consider both frontend AND backend changes together.`);
  }

  console.log(`   Please ask Claude Code to read the diff files and`);
  console.log(`   generate an impact analysis JSON at: ${analysisDir}/impact.json`);

  // ---- Step 3: Browse Affected Pages ----
  const impactPath = path.join(analysisDir, 'impact.json');
  let pagesToBrowse = options.pages || [];
  if (pagesToBrowse.length === 0 && fs.existsSync(impactPath)) {
    const analysis: ImpactAnalysis = JSON.parse(fs.readFileSync(impactPath, 'utf-8'));
    pagesToBrowse = analysis.affectedPages.map(p => p.route);
  }

  if (pagesToBrowse.length > 0) {
    console.log(`\n━━━ Step 3/6: Browsing Affected Pages ━━━`);
    await browseCommand({
      baseUrl,
      pages: pagesToBrowse,
      output: pagesDir,
      headed: options.headed,
    });
  } else {
    console.log(`\n⏭️  Step 3/6: Skipped (no pages to browse)`);
  }

  // ---- Step 4: AI Test Generation ----
  console.log(`\n📋 Step 4/6: AI Test Generation`);
  console.log(`   Page data is at: ${pagesDir}`);
  console.log(`   Analysis is at: ${analysisDir}/impact.json`);
  console.log(`   Generate tests at: ${testsDir}/`);
  if (projects.length > 1) {
    console.log(`   Consider cross-project impacts: backend API changes may affect frontend behavior.`);
  }

  // ---- Step 5: Execute Tests ----
  if (fs.existsSync(testsDir)) {
    console.log(`\n━━━ Step 5/6: Executing Tests ━━━`);
    await execTestsCommand({
      testDir: testsDir,
      baseUrl,
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
    project: projects.length === 1 ? projects[0].path : projects.map(p => p.path).join(','),
    baseRef: projects.length === 1 ? projects[0].baseRef : projects.map(p => `${path.basename(p.path)}@${p.baseRef}`).join(', '),
    targetRef: projects.length === 1 ? projects[0].targetRef : projects.map(p => `${path.basename(p.path)}@${p.targetRef}`).join(', '),
    baseUrl,
  });

  // Cleanup cloned repos
  if (cleanup && hasRemote) {
    console.log(`\n🧹 Cleaning up cloned repos: ${cacheDir}`);
    clearCloneCache(cacheDir);
  }

  console.log(`\n✅ Pipeline complete!`);
  console.log(`   Report: ${path.join(outputRoot, 'reports', 'change-report.md')}`);
}
