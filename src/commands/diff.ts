import path from 'path';
import { extractDiff } from '../git/diff';

export interface DiffCommandOptions {
  project: string;
  base: string;
  target: string;
  output?: string;
}

export async function diffCommand(options: DiffCommandOptions): Promise<void> {
  const { project, base, target } = options;
  const outputDir = options.output || path.join(process.cwd(), 'test-output', 'diff');

  console.log(`Project: ${project}`);
  console.log(`Base: ${base} → Target: ${target}`);

  const result = extractDiff(project, base, target, outputDir);

  console.log(`\nFiles changed: ${result.stats.filesChanged}`);
  console.log(`Additions: +${result.stats.additions}`);
  console.log(`Deletions: -${result.stats.deletions}`);
  console.log(`Commits: ${result.commits.length}`);
  console.log(`\nOutput written to: ${outputDir}`);

  // Print file list
  if (result.files.length > 0) {
    console.log(`\nChanged files:`);
    for (const f of result.files) {
      const icon = f.status === 'added' ? 'A' : f.status === 'deleted' ? 'D' : f.status === 'renamed' ? 'R' : 'M';
      console.log(`  ${icon}  ${f.path}${f.oldPath ? ` (from ${f.oldPath})` : ''}`);
    }
  }
}
