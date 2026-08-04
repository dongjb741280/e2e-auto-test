import fs from 'fs';
import path from 'path';
import { traceImpact, traceFile, hasCodeGraph } from '../codegraph/tracer';
import type { TraceResult } from '../codegraph/tracer';

export interface TraceCommandOptions {
  project: string;
  files?: string[];
  fromDiff?: string;
  depth?: number;
  output?: string;
}

export async function traceCommand(options: TraceCommandOptions): Promise<TraceResult> {
  const { project, depth = 3 } = options;
  const outputDir = options.output || path.join(process.cwd(), 'test-output', 'trace');

  if (!hasCodeGraph(project)) {
    console.log(`No CodeGraph index found at ${project}/.codegraph/codegraph.db`);
    console.log('Run "codegraph init" in the project first to build the index.');
    return { source: 'unavailable', tracedAt: new Date().toISOString(), chains: [], affectedPages: [] };
  }

  // Determine which files to trace
  let files: string[] = [];

  if (options.fromDiff) {
    console.log(`Reading changed files from: ${options.fromDiff}`);
    const filesJsonPath = path.join(options.fromDiff, 'files.json');
    const summaryPath = path.join(options.fromDiff, 'summary.json');

    if (fs.existsSync(summaryPath)) {
      // Multi-project mode — read projects.json
      const projectsPath = path.join(options.fromDiff, 'projects.json');
      if (fs.existsSync(projectsPath)) {
        const projects = JSON.parse(fs.readFileSync(projectsPath, 'utf-8'));
        for (const p of projects) {
          if (p.files) {
            files.push(...p.files.map((f: any) => f.path));
          }
        }
      }
    } else if (fs.existsSync(filesJsonPath)) {
      const fileList = JSON.parse(fs.readFileSync(filesJsonPath, 'utf-8'));
      files = fileList.map((f: any) => f.path || f);
    }

    console.log(`  ${files.length} files from diff`);
  }

  if (options.files && options.files.length > 0) {
    files = options.files;
  }

  if (files.length === 0) {
    console.log('No files to trace. Use --files or --from-diff to specify files.');
    return { source: 'unavailable', tracedAt: new Date().toISOString(), chains: [], affectedPages: [] };
  }

  // Filter to source code only
  const sourceFiles = files.filter(f =>
    /\.(java|vue|tsx?|jsx?|py|go|kt|swift)$/.test(f) &&
    !f.includes('node_modules/') &&
    !f.includes('/.agents/')
  );

  console.log(`Tracing ${sourceFiles.length} source files (depth=${depth})...`);

  const result = traceImpact(project, sourceFiles, depth);

  // Write output
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, 'trace.json'),
    JSON.stringify(result, null, 2)
  );

  // Summary
  const chainsWithPages = result.chains.filter(c => c.affectedPages.length > 0);
  console.log(`\nTraced ${result.chains.length} chains`);
  console.log(`Chains reaching frontend pages: ${chainsWithPages.length}`);
  console.log(`Affected pages: ${result.affectedPages.length}`);

  if (result.affectedPages.length > 0) {
    console.log('');
    for (const page of result.affectedPages) {
      console.log(`  ${page.route}  ←  ${page.file}`);
    }
  }

  console.log(`\nOutput written to: ${outputDir}/trace.json`);
  return result;
}
