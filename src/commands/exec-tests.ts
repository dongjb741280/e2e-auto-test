import fs from 'fs';
import path from 'path';
import { executeTests } from '../runner/executor';
import type { ExecutionResult } from '../types';

export interface ExecuteCommandOptions {
  testDir: string;
  baseUrl: string;
  headed?: boolean;
  output?: string;
}

export async function execTestsCommand(options: ExecuteCommandOptions): Promise<ExecutionResult[]> {
  const { testDir, baseUrl, headed = false } = options;
  const outputDir = options.output || path.join(process.cwd(), 'test-output');

  // Auto-detect test directory if not explicitly provided
  const actualTestDir = fs.existsSync(testDir)
    ? testDir
    : path.join(process.cwd(), 'test-output', 'tests');

  const results = await executeTests({
    testDir: actualTestDir,
    baseUrl,
    headed,
    outputDir,
  });

  // Save results
  fs.mkdirSync(path.join(outputDir, 'results'), { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, 'results', 'results.json'),
    JSON.stringify(results, null, 2)
  );

  // Summary
  const passed = results.filter(r => r.status === 'passed').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const skipped = results.filter(r => r.status === 'skipped').length;

  console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`Results written to: ${path.join(outputDir, 'results', 'results.json')}`);

  return results;
}
