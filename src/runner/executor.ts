import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { ExecutionResult, ScenarioResult } from '../types';

export interface ExecuteOptions {
  testDir: string;
  baseUrl: string;
  headed?: boolean;
  outputDir: string;
}

/**
 * Generates a minimal Playwright config for running the generated tests.
 */
function generatePlaywrightConfig(testDir: string, baseUrl: string, resultsDir: string, headed: boolean): string {
  fs.mkdirSync(resultsDir, { recursive: true });
  const absTestDir = path.resolve(testDir);
  const absResultsDir = path.resolve(resultsDir);

  return `
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '${absTestDir.replace(/\\/g, '\\\\')}',
  testMatch: '**/*.spec.ts',
  use: {
    baseURL: '${baseUrl}',
    headless: ${!headed},
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    video: 'off',
  },
  reporter: [
    ['list'],
    ['json', { outputFile: '${absResultsDir.replace(/\\/g, '\\\\')}/results.json' }],
  ],
  timeout: 30000,
  retries: 0,
});
`;
}

/**
 * Parse Playwright test stdout lines into ExecutionResult[].
 * Relies on the 'list' reporter format: "  ✓  N  file › suite › test (duration)"
 */
function parseStdout(stdout: string): ExecutionResult[] {
  const results: ExecutionResult[] = [];
  const lines = stdout.split('\n');
  const testLineRe = /^  ([✓✘✖○])\s+\d+\s+(.+?)\s+\(([\d.]+s)\)/;

  for (const line of lines) {
    const m = line.match(testLineRe);
    if (!m) continue;
    const icon = m[1];
    const fullTitle = m[2];
    const durationStr = m[3];

    const status: ExecutionResult['status'] =
      icon === '✓' ? 'passed' : icon === '✘' ? 'failed' : 'skipped';

    const durationMs = parseFloat(durationStr) * 1000;
    const filePart = fullTitle.split(' › ')[0] || 'unknown';

    const scenario: ScenarioResult = {
      name: fullTitle,
      status: status === 'passed' ? 'passed' : 'failed',
      duration: durationMs,
    };

    results.push({
      testFile: path.basename(filePart),
      status,
      duration: durationMs,
      scenarios: [scenario],
    });
  }

  return results;
}

/**
 * Executes all Playwright test files in the given directory.
 */
export async function executeTests(options: ExecuteOptions): Promise<ExecutionResult[]> {
  const { testDir, baseUrl, headed = false, outputDir } = options;

  if (!fs.existsSync(testDir)) {
    throw new Error(`Test directory not found: ${testDir}`);
  }

  const resultsDir = path.join(outputDir, 'results');
  const configPath = path.join(outputDir, 'playwright.config.ts');
  const config = generatePlaywrightConfig(testDir, baseUrl, resultsDir, headed);
  fs.writeFileSync(configPath, config);

  console.log(`Running tests from: ${testDir}`);
  console.log(`Base URL: ${baseUrl}\n`);

  let stdout = '';

  try {
    stdout = execSync(`npx playwright test --config="${configPath}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
      cwd: process.cwd(),
    });
  } catch (err: any) {
    // Playwright exits non-zero on test failures — expected
    stdout = err.stdout || '';
    if (err.stderr) console.error(err.stderr);
  }

  // Print the output so the user can see test progress
  console.log(stdout);

  // Cleanup config
  try { fs.unlinkSync(configPath); } catch { /* ignore */ }

  // Parse results from stdout
  const results = parseStdout(stdout);

  // Save parsed results
  fs.writeFileSync(path.join(resultsDir, 'results.json'), JSON.stringify(results, null, 2));

  return results;
}
