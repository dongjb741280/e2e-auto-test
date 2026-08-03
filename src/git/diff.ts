import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { DiffOutput, FileChange, CommitInfo, DiffStats } from '../types';

export class GitDiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitDiffError';
  }
}

function runGit(projectPath: string, args: string): string {
  try {
    return execSync(`git -C "${projectPath}" ${args}`, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024, // 50MB
    }).trim();
  } catch (err) {
    const msg = (err as Error).message;
    throw new GitDiffError(`Git command failed: git ${args}\n${msg}`);
  }
}

function parseFileList(projectPath: string, baseRef: string, targetRef: string): FileChange[] {
  // Get files changed between two refs with stats
  const output = runGit(
    projectPath,
    `diff --name-status ${baseRef}...${targetRef}`
  );

  if (!output) return [];

  const files: FileChange[] = [];
  const lines = output.split('\n').filter(Boolean);

  for (const line of lines) {
    const parts = line.split('\t');
    const statusCode = parts[0];

    let status: FileChange['status'];
    let filePath: string;
    let oldPath: string | undefined;

    if (statusCode.startsWith('R')) {
      status = 'renamed';
      oldPath = parts[1];
      filePath = parts[2];
    } else {
      const code = statusCode[0];
      const statusMap: Record<string, FileChange['status']> = {
        A: 'added',
        M: 'modified',
        D: 'deleted',
      };
      status = statusMap[code] || 'modified';
      filePath = parts[1];
    }

    // Get numstat for this file
    let additions = 0;
    let deletions = 0;
    if (status !== 'deleted') {
      try {
        const numstat = runGit(
          projectPath,
          `diff --numstat ${baseRef}...${targetRef} -- "${filePath}"`
        );
        if (numstat) {
          const [add, del] = numstat.split('\t');
          additions = parseInt(add, 10) || 0;
          deletions = parseInt(del, 10) || 0;
        }
      } catch {
        // numstat failed, keep zeros
      }
    }

    // Get the actual patch
    let patch = '';
    try {
      patch = runGit(
        projectPath,
        `diff ${baseRef}...${targetRef} -- "${filePath}"`
      );
    } catch {
      patch = '';
    }

    files.push({ path: filePath, status, oldPath, additions, deletions, patch });
  }

  return files;
}

function parseCommits(projectPath: string, baseRef: string, targetRef: string): CommitInfo[] {
  const output = runGit(
    projectPath,
    `log ${baseRef}..${targetRef} --format="%H|||%s|||%an|||%aI" --no-merges`
  );

  if (!output) return [];

  return output.split('\n').filter(Boolean).map(line => {
    const [hash, message, author, date] = line.split('|||');
    return { hash: hash.slice(0, 8), message, author, date };
  });
}

export function extractDiff(
  projectPath: string,
  baseRef: string,
  targetRef: string,
  outputDir: string
): DiffOutput {
  // Validate it's a git repo
  try {
    runGit(projectPath, 'rev-parse --git-dir');
  } catch {
    throw new GitDiffError(`${projectPath} is not a git repository`);
  }

  // Resolve refs to verify they exist
  try {
    runGit(projectPath, `rev-parse ${baseRef}`);
  } catch {
    throw new GitDiffError(`Base ref not found: ${baseRef}`);
  }
  try {
    runGit(projectPath, `rev-parse ${targetRef}`);
  } catch {
    throw new GitDiffError(`Target ref not found: ${targetRef}`);
  }

  const files = parseFileList(projectPath, baseRef, targetRef);
  const commits = parseCommits(projectPath, baseRef, targetRef);

  let rawDiff = '';
  try {
    rawDiff = runGit(projectPath, `diff ${baseRef}...${targetRef}`);
  } catch {
    rawDiff = '';
  }

  const stats: DiffStats = {
    additions: files.reduce((s, f) => s + f.additions, 0),
    deletions: files.reduce((s, f) => s + f.deletions, 0),
    filesChanged: files.length,
  };

  // Write outputs
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, 'files.json'),
    JSON.stringify(files, null, 2)
  );
  fs.writeFileSync(path.join(outputDir, 'raw.diff'), rawDiff);
  fs.writeFileSync(
    path.join(outputDir, 'commits.json'),
    JSON.stringify(commits, null, 2)
  );

  return { projectPath, baseRef, targetRef, files, rawDiff, commits, stats };
}
