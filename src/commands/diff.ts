import path from 'path';
import fs from 'fs';
import { extractDiff, isRemoteUrl, cloneRepo } from '../git/diff';
import type { ProjectSpec, DiffOutput, MultiDiffOutput } from '../types';

export interface DiffCommandOptions {
  projects: ProjectSpec[];
  output?: string;
  cleanup?: boolean;
}

function projectDirName(spec: ProjectSpec): string {
  const basename = path.basename(spec.path.replace(/\.git$/, ''));
  return basename || 'project';
}

export async function diffCommand(options: DiffCommandOptions): Promise<{ output: MultiDiffOutput; resolvedProjects: ProjectSpec[] }> {
  const { projects, cleanup = true } = options;
  const outputRoot = options.output || path.join(process.cwd(), 'test-output', 'diff');

  const resolvedProjects: ProjectSpec[] = [];
  const results: DiffOutput[] = [];

  for (let i = 0; i < projects.length; i++) {
    const spec = projects[i];
    let projectPath = spec.path;

    // Resolve remote URL: clone to cache
    if (isRemoteUrl(spec.path)) {
      const cacheDir = path.join(process.cwd(), 'test-output', '.repos');
      console.log(`Cloning: ${spec.path} ...`);
      projectPath = cloneRepo(spec.path, cacheDir);
      console.log(`  → ${projectPath}\n`);
    }

    resolvedProjects.push({ path: projectPath, baseRef: spec.baseRef, targetRef: spec.targetRef });

    const label = projects.length > 1 ? `[${projectDirName(spec)}] ` : '';
    const subDir = path.join(outputRoot, projectDirName(spec));

    console.log(`${label}Project: ${projectPath}`);
    console.log(`${label}Base: ${spec.baseRef} → Target: ${spec.targetRef}`);

    const result = extractDiff(projectPath, spec.baseRef, spec.targetRef, subDir);

    console.log(`${label}Files changed: ${result.stats.filesChanged}`);
    console.log(`${label}Additions: +${result.stats.additions}`);
    console.log(`${label}Deletions: -${result.stats.deletions}`);
    console.log(`${label}Commits: ${result.commits.length}\n`);

    results.push(result);
  }

  console.log(`Output written to: ${outputRoot}/`);

  // Print consolidated file list
  for (const r of results) {
    const idx = results.indexOf(r);
    const label = projects.length > 1 ? `[${projectDirName(projects[idx])}] ` : '';
    if (r.files.length > 0) {
      console.log(`\n${label}Changed files:`);
      for (const f of r.files.slice(0, 100)) {
        const icon = f.status === 'added' ? 'A' : f.status === 'deleted' ? 'D' : f.status === 'renamed' ? 'R' : 'M';
        console.log(`  ${icon}  ${f.path}${f.oldPath ? ` (from ${f.oldPath})` : ''}`);
      }
      if (r.files.length > 100) {
        console.log(`  ... and ${r.files.length - 100} more files`);
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

  return { output: { projects: results, stats: consolidatedStats }, resolvedProjects };
}
