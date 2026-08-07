import path from 'path';
import fs from 'fs';
import { diffCommand } from './diff';
import { browseCommand } from './browse';
import { execTestsCommand } from './exec-tests';
import { reportCommand } from './report';
import { isRemoteUrl, clearCloneCache } from '../git/diff';
import { hasCodeGraph, traceImpact } from '../codegraph/tracer';
import { buildAnalyzePrompt, loadExistingAnalysis } from '../ai/prompt';
import { resolveConfig } from '../core/config';
import type { ProjectSpec, ImpactAnalysis } from '../types';

export interface PipelineOptions {
  projects: ProjectSpec[];
  baseUrl: string;
  headed?: boolean;
  output?: string;
  pages?: string[];
  cleanup?: boolean;
  /** Skip Step 1 (diff already extracted), start from Step 2 */
  resume?: boolean;
  /** Clear intermediate data from previous runs (default: true, ignored with --resume) */
  clean?: boolean;
  /** Wait for Claude Code to write impact.json / tests (default: true). Use --no-wait for old exit-on-pause behavior. */
  wait?: boolean;
  /** Timeout in seconds for --wait (default: 600 = 10 min) */
  waitTimeout?: number;
}

// Directories cleared between runs (intermediate data only — tests/ and reports/ are never cleared)
const INTERMEDIATE_DIRS = ['diff', 'analysis', 'pages', 'results', 'trace'];

function clearIntermediateDirs(outputRoot: string): void {
  for (const dir of INTERMEDIATE_DIRS) {
    const full = path.join(outputRoot, dir);
    if (fs.existsSync(full)) {
      fs.rmSync(full, { recursive: true, force: true });
    }
  }
}

/** Poll for a file to appear. Returns true if found, false on timeout. */
async function waitForFile(
  filePath: string,
  description: string,
  timeoutSec: number,
): Promise<boolean> {
  const start = Date.now();
  const timeoutMs = timeoutSec * 1000;
  console.log(`\n⏸️  Pipeline paused — waiting for ${description}`);
  console.log(`   File: ${filePath}`);
  console.log(`   Polling every 3s (Ctrl+C to stop, then resume later with --resume)`);
  console.log(`   Timeout: ${timeoutSec}s\n`);

  let lastProgress = 0;
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 3000));
    if (fs.existsSync(filePath)) {
      console.log(`   ✅ ${description} detected, continuing...\n`);
      return true;
    }
    const elapsed = Math.round((Date.now() - start) / 1000);
    const bucket = Math.floor(elapsed / 30);
    if (bucket > lastProgress) {
      lastProgress = bucket;
      console.log(`   ⏳ Still waiting... (${elapsed}s elapsed, ${timeoutSec - elapsed}s remaining)`);
    }
  }
  console.log(`   ⏰ Timeout (${timeoutSec}s) waiting for ${description}`);
  console.log(`   Run again with --resume to continue.\n`);
  return false;
}

/** Poll for at least one .spec.ts file to appear in a directory. */
async function waitForTestFiles(
  testsDir: string,
  timeoutSec: number,
): Promise<boolean> {
  const start = Date.now();
  const timeoutMs = timeoutSec * 1000;
  console.log(`\n⏸️  Pipeline paused — waiting for test files`);
  console.log(`   Dir:  ${testsDir}`);
  console.log(`   Polling every 3s (Ctrl+C to stop, then resume later with --resume)`);
  console.log(`   Timeout: ${timeoutSec}s\n`);

  let lastProgress = 0;
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.spec.ts'));
      if (files.length > 0) {
        console.log(`   ✅ ${files.length} test file(s) detected, continuing...\n`);
        return true;
      }
    } catch { /* dir not created yet */ }
    const elapsed = Math.round((Date.now() - start) / 1000);
    const bucket = Math.floor(elapsed / 30);
    if (bucket > lastProgress) {
      lastProgress = bucket;
      console.log(`   ⏳ Still waiting... (${elapsed}s elapsed, ${timeoutSec - elapsed}s remaining)`);
    }
  }
  console.log(`   ⏰ Timeout (${timeoutSec}s) waiting for test files`);
  console.log(`   Run again with --resume to continue.\n`);
  return false;
}

/**
 * Full pipeline:
 *   1. diff        (deterministic, CLI)
 *   2. AI analysis (Claude Code skill: /e2e-analyze)
 *   3. browse      (deterministic, CLI)
 *   4. AI generate (Claude Code)
 *   5. execute     (deterministic, CLI)
 *   6. report      (deterministic, CLI)
 */
export async function pipelineCommand(options: PipelineOptions): Promise<void> {
  const { projects, baseUrl, cleanup = true, resume = false, clean = true, wait = true, waitTimeout = 600 } = options;
  const outputRoot = options.output || path.join(process.cwd(), 'test-output');
  const diffDir = path.join(outputRoot, 'diff');
  const analysisDir = path.join(outputRoot, 'analysis');
  const pagesDir = path.join(outputRoot, 'pages');
  const testsDir = path.join(outputRoot, 'tests');
  const resultsDir = path.join(outputRoot, 'results');
  const cacheDir = path.join(outputRoot, '.repos');
  const impactPath = path.join(analysisDir, 'impact.json');

  const hasRemote = projects.some(p => isRemoteUrl(p.path));

  // Resolve project config (from first local project; CLI options take precedence)
  const localProject = projects.find(p => !isRemoteUrl(p.path));
  const resolved = localProject
    ? resolveConfig(localProject.path, { baseUrl, pages: options.pages, headed: options.headed })
    : { baseUrl, login: undefined, pages: options.pages, headed: options.headed, viewport: undefined };

  console.log('╔══════════════════════════════════════╗');
  console.log('║   E2E Change-Impact Test Pipeline   ║');
  console.log('╚══════════════════════════════════════╝\n');

  // Clear intermediate data from previous runs
  if (!resume && clean) {
    clearIntermediateDirs(outputRoot);
  }

  if (hasRemote) {
    console.log(`Remote repo(s) detected — will clone to ${path.resolve(cacheDir)}/`);
    console.log(`Cleanup after pipeline: ${cleanup ? 'yes' : 'no'} (use --no-cleanup to keep)`);
  }

  for (const p of projects) {
    const label = isRemoteUrl(p.path) ? `[remote] ${path.basename(p.path, '.git')}` : p.path;
    console.log(`  ${label}: ${p.baseRef} → ${p.targetRef}`);
  }
  console.log('');

  // ---- Step 1: Extract Git Diff ----
  if (!resume) {
    console.log('━━━ Step 1/6: Extracting Git Diff ━━━');
    await diffCommand({ projects, output: diffDir });
  } else {
    console.log('⏭️  Step 1/6: Skipped (--resume)');
    if (!fs.existsSync(diffDir)) {
      console.error(`Error: --resume requires existing diff data at ${diffDir}/`);
      console.error('Run without --resume first.');
      process.exit(1);
    }
    console.log(`   Using existing diff: ${diffDir}/`);
  }

  // ---- Step 1.5: CodeGraph Impact Trace ----
  const traceDir = path.join(outputRoot, 'trace');
  if (!resume) {
    const filesJson = path.join(diffDir, 'files.json');
    if (fs.existsSync(filesJson) || fs.existsSync(path.join(diffDir, 'projects.json'))) {
      // Collect changed files from diff output
      const changedFiles: string[] = [];
      if (fs.existsSync(path.join(diffDir, 'projects.json'))) {
        const diffProjects = JSON.parse(fs.readFileSync(path.join(diffDir, 'projects.json'), 'utf-8'));
        for (const p of diffProjects) {
          for (const f of p.files || []) changedFiles.push(f.path);
        }
      } else if (fs.existsSync(filesJson)) {
        for (const f of JSON.parse(fs.readFileSync(filesJson, 'utf-8'))) changedFiles.push(f.path || f);
      }

      // Check if any project has CodeGraph
      const cgProjects = projects.filter(p => hasCodeGraph(p.path));
      if (cgProjects.length > 0) {
        console.log(`\n━━━ Step 1.5/6: CodeGraph Impact Trace ━━━`);
        for (const p of cgProjects) {
          const projFiles = changedFiles.filter((f: string) => f && !f.startsWith('.') && /\.(java|vue|tsx?|jsx?|py|go|kt)$/.test(f));
          console.log(`   Tracing ${projFiles.length} files in ${path.basename(p.path)}...`);
          const result = traceImpact(p.path, projFiles, 3);
          const chainsWithPages = result.chains.filter(c => c.affectedPages.length > 0);
          const lowConfChains = chainsWithPages.filter(c => c.hops.some(h => h.confidence === 'low'));
          const highConfPages = [...new Set(
            chainsWithPages.filter(c => !lowConfChains.includes(c)).flatMap(c => c.affectedPages)
          )];
          console.log(`   → ${chainsWithPages.length} chains reach frontend, ${result.affectedPages.length} pages affected`);
          if (lowConfChains.length > 0) {
            console.log(`   ⚠️  ${lowConfChains.length} chains have low-confidence hops (cross-language bridge)`);
            console.log(`      → needs Claude Code semantic review in Step 2`);
          }
          if (highConfPages.length > 0) {
            console.log(`   ✅ ${highConfPages.length} pages from high-confidence SQL edges`);
          }
          // Fold into existing trace (multi-project accumulates)
          fs.mkdirSync(traceDir, { recursive: true });
          const traceFile = path.join(traceDir, 'trace.json');
          let existing: any = { chains: [], affectedPages: [] };
          if (fs.existsSync(traceFile)) {
            try { existing = JSON.parse(fs.readFileSync(traceFile, 'utf-8')); } catch { /* keep defaults */ }
          }
          existing.chains = [...(existing.chains || []), ...result.chains];
          existing.affectedPages = [...(existing.affectedPages || []), ...result.affectedPages];
          existing.source = 'codegraph';
          existing.tracedAt = new Date().toISOString();
          fs.writeFileSync(traceFile, JSON.stringify(existing, null, 2));
        }
      } else {
        console.log('\n⏭️  Step 1.5/6: CodeGraph Trace skipped (no CodeGraph index found)');
      }
    }
  }

  // ---- Step 2: AI Impact Analysis ----
  if (fs.existsSync(impactPath)) {
    const existing = loadExistingAnalysis(analysisDir);
    console.log(`\n⏭️  Step 2/6: Analysis already exists (${existing?.affectedPages?.length || 0} affected pages)`);
  } else {
    // Auto-build the analysis prompt from diff + trace data
    const { prompt, summary } = buildAnalyzePrompt({
      diffDir,
      traceDir: fs.existsSync(path.join(traceDir, 'trace.json')) ? traceDir : undefined,
    });
    fs.mkdirSync(analysisDir, { recursive: true });
    fs.writeFileSync(path.join(analysisDir, 'analyze-prompt.md'), prompt);

    console.log(`\n━━━ Step 2/6: AI Impact Analysis ━━━`);
    console.log(`   Skill: /e2e-analyze`);
    console.log(`   Files: ${summary.fileCount} | Commits: ${summary.commitCount}`);
    if (summary.traceChains > 0) {
      console.log(`   Trace: ${summary.traceChains} chains (${summary.traceLowConfidence} low-confidence, ${summary.traceHighPages} candidate pages)`);
    }
    console.log(`   Prompt: ${path.join(analysisDir, 'analyze-prompt.md')} (${(summary.diffSizeBytes / 1024).toFixed(1)} KB)`);
    console.log(`   Output: ${impactPath}`);
    console.log(`   Claude Code reads the prompt, applies 4-stage analysis,`);
    console.log(`   and writes the structured impact.json.`);
    if (wait) {
      const found = await waitForFile(impactPath, 'impact.json', waitTimeout);
      if (!found) return;
    } else {
      console.log(`\n   Run /e2e-analyze now, then re-run with --resume to continue.`);
      console.log(`\n⏸️  Pipeline paused — waiting for impact.json`);
      return;
    }
  }

  // ---- Step 3: Browse Affected Pages (optional — skips gracefully if app not running) ----
  let pagesToBrowse = resolved.pages || [];
  let hasDomData = false;
  if (pagesToBrowse.length === 0) {
    const analysis: ImpactAnalysis = JSON.parse(fs.readFileSync(impactPath, 'utf-8'));
    pagesToBrowse = analysis.affectedPages.map(p => p.route);
  }

  if (pagesToBrowse.length > 0) {
    console.log(`\n━━━ Step 3/6: Browsing Affected Pages ━━━`);
    try {
      await browseCommand({
        baseUrl: resolved.baseUrl || baseUrl,
        pages: pagesToBrowse,
        output: pagesDir,
        headed: resolved.headed,
        login: resolved.login,
      });
      hasDomData = true;
    } catch (err) {
      console.log(`   ⚠️  Browse failed (app not running or pages inaccessible): ${(err as Error).message}`);
      console.log(`   → Tests will be generated from impact.json descriptions alone (selectors need manual verification)`);
    }
  } else {
    console.log(`\n⏭️  Step 3/6: Skipped (no pages to browse)`);
  }

  // ---- Step 4: AI Test Generation ----
  const testFiles = fs.existsSync(testsDir) ? fs.readdirSync(testsDir).filter(f => f.endsWith('.spec.ts')) : [];
  if (testFiles.length > 0) {
    console.log(`\n⏭️  Step 4/6: Tests already exist (${testFiles.length} files)`);
  } else {
    console.log(`\n━━━ Step 4/6: AI Test Generation ━━━`);
    console.log(`   Skill: /e2e-generate`);
    console.log(`   Input:  ${analysisDir}/impact.json`);
    if (hasDomData) {
      console.log(`   DOM:    ${pagesDir}/ (real selectors available)`);
    } else {
      console.log(`   DOM:    not available — selectors will be inferred from scenario descriptions`);
    }
    console.log(`   Output: ${testsDir}/*.spec.ts`);
    console.log(`   Claude Code reads the analysis + available DOM data,`);
    console.log(`   and generates self-contained Playwright test files.`);
    if (wait) {
      const found = await waitForTestFiles(testsDir, waitTimeout);
      if (!found) return;
    } else {
      console.log(`\n   Run /e2e-generate to create tests, then re-run with --resume.`);
      console.log(`\n⏸️  Pipeline paused — waiting for test files`);
      return;
    }
  }

  // ---- Step 5: Execute Tests ----
  console.log(`\n━━━ Step 5/6: Executing Tests ━━━`);
  await execTestsCommand({
    testDir: testsDir,
    baseUrl,
    headed: options.headed,
    output: outputRoot,
  });

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
  console.log(`   Reports: ${path.join(outputRoot, 'reports')}/`);
}
