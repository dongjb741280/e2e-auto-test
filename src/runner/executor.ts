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
function generatePlaywrightConfig(testDir: string, baseUrl: string, outputDir: string, headed: boolean): string {
  const absTestDir = path.resolve(testDir);
  const resultsDir = path.resolve(path.join(outputDir, 'results'));
  fs.mkdirSync(resultsDir, { recursive: true });

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
    ['json', { outputFile: '${resultsDir.replace(/\\/g, '\\\\')}/results.json' }],
    ['list'],
  ],
  timeout: 30000,
  retries: 0,
});
`;
}

/**
 * Parses Playwright's JSON reporter output into ExecutionResult[].
 */
function parsePlaywrightResults(resultsJsonPath: string): ExecutionResult[] {
  if (!fs.existsSync(resultsJsonPath)) return [];

  const raw = JSON.parse(fs.readFileSync(resultsJsonPath, 'utf-8'));
  const results: ExecutionResult[] = [];

  for (const suite of raw.suites || []) {
    for (const spec of suite.specs || []) {
      const tests = spec.tests || [];
      for (const test of tests) {
        const results_data = test.results || [];
        // Use the first result (no retries)
        const lastResult = results_data[results_data.length - 1];
        if (!lastResult) continue;

        const status: ExecutionResult['status'] =
          lastResult.status === 'passed' ? 'passed'
          : lastResult.status === 'skipped' ? 'skipped'
          : 'failed';

        const scenarios: ScenarioResult[] = [
          {
            name: test.title,
            status: status === 'passed' ? 'passed' : 'failed',
            duration: lastResult.duration || 0,
            error: lastResult.error?.message,
          },
        ];

        results.push({
          testFile: path.basename(spec.file),
          status,
          duration: lastResult.duration || 0,
          scenarios,
        });
      }
    }
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

  const configPath = path.join(outputDir, 'playwright.config.ts');
  const config = generatePlaywrightConfig(testDir, baseUrl, outputDir, headed);
  fs.writeFileSync(configPath, config);

  console.log(`Running tests from: ${testDir}`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Config: ${configPath}\n`);

  try {
    execSync(`npx playwright test --config="${configPath}"`, {
      encoding: 'utf-8',
      stdio: 'inherit',
      cwd: process.cwd(),
    });
  } catch (err) {
    // Playwright exits non-zero on test failures — that's expected
    console.log('Some tests failed (expected behavior).');
  }

  // Cleanup config
  try { fs.unlinkSync(configPath); } catch { /* ignore */ }

  const resultsJsonPath = path.resolve(path.join(outputDir, 'results', 'results.json'));
  return parsePlaywrightResults(resultsJsonPath);
}
