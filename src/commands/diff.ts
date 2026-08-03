import path from 'path';
import fs from 'fs';
import { extractDiff } from '../git/diff';
import type { ProjectSpec, DiffOutput, MultiDiffOutput } from '../types';

export interface DiffCommandOptions {
  projects: ProjectSpec[];
  output?: string;
}

function projectDirName(spec: ProjectSpec): string {
  // Derive a safe directory name from the project path
  const basename = path.basename(spec.path);
  return basename || 'project';
}

export async function diffCommand(options: DiffCommandOptions): Promise<MultiDiffOutput> {
  const { projects } = options;
  const outputRoot = options.output || path.join(process.cwd(), 'test-output', 'diff');

  const results: DiffOutput[] = [];

  for (let i = 0; i < projects.length; i++) {
    const spec = projects[i];
    const label = projects.length > 1 ? `[${projectDirName(spec)}] ` : '';
    const subDir = path.join(outputRoot, projectDirName(spec));

    console.log(`${label}Project: ${spec.path}`);
    console.log(`${label}Base: ${spec.baseRef} → Target: ${spec.targetRef}`);

    const result = extractDiff(spec.path, spec.baseRef, spec.targetRef, subDir);

    console.log(`${label}Files changed: ${result.stats.filesChanged}`);
    console.log(`${label}Additions: +${result.stats.additions}`);
    console.log(`${label}Deletions: -${result.stats.deletions}`);
    console.log(`${label}Commits: ${result.commits.length}\n`);

    results.push(result);
  }

  console.log(`Output written to: ${outputRoot}/`);

  // Print consolidated file list
  for (const r of results) {
    const label = projects.length > 1 ? `[${projectDirName(projects[results.indexOf(r)])}] ` : '';
    if (r.files.length > 0) {
      console.log(`\n${label}Changed files:`);
      for (const f of r.files) {
        const icon = f.status === 'added' ? 'A' : f.status === 'deleted' ? 'D' : f.status === 'renamed' ? 'R' : 'M';
        console.log(`  ${icon}  ${f.path}${f.oldPath ? ` (from ${f.oldPath})` : ''}`);
      }
    }
  }

  // Write consolidated summary
  const consolidatedStats = {
    additions: results.reduce((s, r) => s + r.stats.additions, 0),
    deletions: results.reduce((s, r) => s + r.stats.deletions, 0),
    filesChanged: results.reduce((s, r) => s + r.stats.filesChanged, 0),
  };

  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(
    path.join(outputRoot, 'projects.json'),
    JSON.stringify(results, null, 2)
  );
  fs.writeFileSync(
    path.join(outputRoot, 'summary.json'),
    JSON.stringify(consolidatedStats, null, 2)
  );

  return { projects: results, stats: consolidatedStats };
}
