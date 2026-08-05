import fs from 'fs';
import path from 'path';
import type { ImpactAnalysis } from '../types';

/**
 * Reads diff and trace data, builds a structured analysis prompt for Claude Code.
 * The prompt follows the 4-stage methodology defined in e2e-analyze.md.
 */

interface PromptInput {
  diffDir: string;
  traceDir?: string;
}

interface PromptOutput {
  /** The full markdown prompt for Claude Code */
  prompt: string;
  /** Context summary for pipeline display */
  summary: {
    fileCount: number;
    commitCount: number;
    diffSizeBytes: number;
    traceChains: number;
    traceLowConfidence: number;
    traceHighPages: number;
  };
}

function safeJSON<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { /* corrupt */ }
  return fallback;
}

/**
 * Build a structured analysis prompt from diff and trace data.
 */
export function buildAnalyzePrompt(input: PromptInput): PromptOutput {
  const { diffDir, traceDir } = input;

  // Load diff data
  const projectsPath = path.join(diffDir, 'projects.json');
  const isMultiProject = fs.existsSync(projectsPath);

  let fileCount = 0;
  let commitCount = 0;
  let diffBlocks: string[] = [];

  if (isMultiProject) {
    const projects = safeJSON<any[]>(projectsPath, []);
    for (const proj of projects) {
      fileCount += proj.stats?.filesChanged || 0;
      const projName = path.basename(proj.projectPath || 'unknown');
      diffBlocks.push(`### Project: ${projName} (${proj.baseRef} → ${proj.targetRef})`);
      diffBlocks.push(`Files: ${proj.stats?.filesChanged || 0} (+${proj.stats?.additions || 0}/-${proj.stats?.deletions || 0})`);

      const files = proj.files || [];
      if (files.length > 0) {
        diffBlocks.push('Changed files:');
        for (const f of files.slice(0, 60)) {
          diffBlocks.push(`  [${f.status}] ${f.path} (+${f.additions || 0}/-${f.deletions || 0})`);
        }
        if (files.length > 60) diffBlocks.push(`  ... and ${files.length - 60} more`);
      }
      diffBlocks.push('');

      // Include first 5000 chars of raw diff
      if (proj.rawDiff) {
        diffBlocks.push('```diff');
        diffBlocks.push(proj.rawDiff.slice(0, 5000));
        if (proj.rawDiff.length > 5000) diffBlocks.push('... (truncated)');
        diffBlocks.push('```');
      }
    }

    // Commits from first project
    if (projects.length > 0 && projects[0].commits) {
      commitCount = projects[0].commits.length;
      diffBlocks.push(`### Commits (${commitCount})`);
      for (const c of projects[0].commits.slice(0, 20)) {
        diffBlocks.push(`  ${c.hash}: ${c.message} (${c.author})`);
      }
    }
  } else {
    const files = safeJSON<any[]>(path.join(diffDir, 'files.json'), []);
    const commits = safeJSON<any[]>(path.join(diffDir, 'commits.json'), []);
    const rawDiff = safeJSON(path.join(diffDir, 'raw.diff'), '');

    fileCount = files.length;
    commitCount = commits.length;

    diffBlocks.push(`### Changed Files (${fileCount})`);
    for (const f of files.slice(0, 100)) {
      diffBlocks.push(`  [${f.status}] ${f.path} (+${f.additions || 0}/-${f.deletions || 0})`);
    }
    diffBlocks.push('');

    diffBlocks.push(`### Commits (${commits.length})`);
    for (const c of commits.slice(0, 30)) {
      diffBlocks.push(`  ${c.hash}: ${c.message} (${c.author})`);
    }
    diffBlocks.push('');

    diffBlocks.push('### Raw Diff');
    diffBlocks.push('```diff');
    diffBlocks.push(rawDiff.slice(0, 8000));
    if (rawDiff.length > 8000) diffBlocks.push('... (truncated)');
    diffBlocks.push('```');
  }

  // Load trace data
  let traceChains = 0;
  let traceLowConfidence = 0;
  let traceHighPages = 0;
  let traceBlocks: string[] = [];

  if (traceDir) {
    const tracePath = path.join(traceDir, 'trace.json');
    const trace = safeJSON<any>(tracePath, null);
    if (trace && trace.chains) {
      traceChains = trace.chains.length;
      traceLowConfidence = trace.chains.filter((c: any) =>
        c.hops?.some((h: any) => h.confidence === 'low')
      ).length;
      traceHighPages = (trace.affectedPages || []).length;

      if (traceChains > 0) {
        traceBlocks.push(`### CodeGraph Trace Results`);
        traceBlocks.push(`Total chains: ${traceChains}`);
        traceBlocks.push(`Low-confidence chains (needs review): ${traceLowConfidence}`);
        traceBlocks.push('');

        // High-confidence chains: list for validation
        const highChains = trace.chains.filter((c: any) =>
          c.hops?.every((h: any) => h.confidence !== 'low')
        );
        if (highChains.length > 0) {
          traceBlocks.push('**High-confidence chains** (validate terminal detection):');
          for (const c of highChains) {
            const pages = c.affectedPages || [];
            traceBlocks.push(`  ${c.sourceFile} → ${pages.join(', ') || '(no frontend pages found)'}`);
          }
          traceBlocks.push('');
        }

        // Low-confidence chains: needs audit
        if (traceLowConfidence > 0) {
          traceBlocks.push('**Low-confidence chains** (audit critically — may be false matches):');
          const lowChains = trace.chains.filter((c: any) =>
            c.hops?.some((h: any) => h.confidence === 'low')
          );
          for (const c of lowChains) {
            const lowHops = (c.hops || []).filter((h: any) => h.confidence === 'low');
            traceBlocks.push(`  ${c.sourceFile}:`);
            for (const h of lowHops) {
              traceBlocks.push(`    [LOW] ${h.relation} → ${h.file} (${h.symbol})`);
            }
          }
          traceBlocks.push('');
        }

        // Affected pages summary
        if (trace.affectedPages?.length > 0) {
          traceBlocks.push('**Candidate affected pages** (from CodeGraph trace):');
          for (const p of trace.affectedPages) {
            traceBlocks.push(`  ${p.route || '?'}  ←  ${p.file}`);
          }
        }
      }
    }
  }

  // Assemble final prompt
  const prompt = [
    '# E2E Change Impact Analysis',
    '',
    'Analyze the following git diff and CodeGraph trace data. Follow the 4-stage methodology:',
    '1. **File Classification**: classify by extension + content (not path prefix)',
    '2. **Code Change Understanding**: read diff structurally, identify new/deleted elements',
    '3. **Feature Impact Derivation**: cross-reference commits, derive affected features',
    '4. **Test Scenario Generation**: P0/P1/P2 priority, specific selectors',
    '',
    '## Diff Data',
    ...diffBlocks,
    '',
    ...(traceBlocks.length > 0 ? ['## Trace Data', ...traceBlocks, ''] : []),
    '## Task',
    isMultiProject
      ? 'Cross-project analysis: consider both frontend AND backend changes together. Backend API changes → which frontend pages? Frontend changes → which backend endpoints? Identify breaking changes.'
      : 'Identify affected frontend features and pages. Focus on user-facing changes.',
    '',
    '## Output',
    'Write a JSON file to `test-output/analysis/impact.json` with this structure:',
    '```json',
    '{',
    '  "summary": "one-sentence summary",',
    '  "affectedPages": [{ "route": "/login", "name": "...", "changeType": "modified", "changeDescription": "...", "impactedFiles": [...], "testScenarios": [{ "name": "...", "priority": "P0", "steps": [...], "expectedResult": "..." }] }],',
    '  "riskLevel": "low|medium|high",',
    '  "recommendation": "deployment advice"',
    '}',
    '```',
    '',
    'Guidance:',
    '- high-confidence trace chains → validate terminal detection accuracy',
    '- low-confidence trace chains → audit critically, check for false matches',
    '- Use impactedFiles from diff analysis, not trace alone',
    '- Add test scenarios even for pages without trace data',
  ].join('\n');

  const diffSizeBytes = Buffer.byteLength(prompt, 'utf-8');

  return {
    prompt,
    summary: {
      fileCount,
      commitCount,
      diffSizeBytes,
      traceChains,
      traceLowConfidence,
      traceHighPages,
    },
  };
}

/**
 * Load an existing impact analysis.
 */
export function loadExistingAnalysis(analysisDir: string): ImpactAnalysis | null {
  const impactPath = path.join(analysisDir, 'impact.json');
  if (fs.existsSync(impactPath)) {
    try {
      return JSON.parse(fs.readFileSync(impactPath, 'utf-8'));
    } catch { /* corrupt */ }
  }
  return null;
}
