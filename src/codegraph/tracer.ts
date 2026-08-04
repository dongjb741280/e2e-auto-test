import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// ---- Types ----

export interface TraceHop {
  file: string;
  relation: string;    // calls | imports | references | instantiates | extends
  symbol: string;
  terminal?: boolean;
}

export interface FileChain {
  sourceFile: string;
  symbols: string[];
  hops: TraceHop[];
  affectedPages: string[];
}

export interface TraceResult {
  source: 'codegraph' | 'sql-fallback' | 'unavailable';
  tracedAt: string;
  chains: FileChain[];
  affectedPages: { route: string; file: string }[];
}

// ---- CodeGraph detection ----

export function hasCodeGraph(projectPath: string): boolean {
  return fs.existsSync(path.join(projectPath, '.codegraph', 'codegraph.db'));
}

function getDbPath(projectPath: string): string {
  return path.join(projectPath, '.codegraph', 'codegraph.db');
}

// ---- CLI-based tracing ----

function codegraphAvailable(): boolean {
  try {
    execSync('npx codegraph --version', { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function runCodegraph(projectPath: string, args: string): string {
  try {
    return execSync(`npx codegraph ${args}`, {
      encoding: 'utf-8',
      cwd: projectPath,
      stdio: 'pipe',
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Trace a symbol's callers using codegraph CLI.
 */
function traceCallersCLI(projectPath: string, file: string): string[] {
  // Get the main symbol from the file (first class/function name)
  const output = runCodegraph(projectPath, `callers "${file}"`);
  if (!output) return [];
  return output.split('\n').filter(Boolean).map(l => l.trim());
}

/**
 * Get the impact radius of a symbol using codegraph CLI.
 */
function traceImpactCLI(projectPath: string, file: string, depth: number): string {
  return runCodegraph(projectPath, `impact "${file}" --depth ${depth}`);
}

// ---- SQL-based fallback tracing ----

function sqlQuery(dbPath: string, query: string): string {
  try {
    return execSync(`sqlite3 -json "${dbPath}" "${query}"`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch {
    return '[]';
  }
}

function queryJSON(dbPath: string, query: string): any[] {
  const raw = sqlQuery(dbPath, query);
  try { return JSON.parse(raw); } catch { return []; }
}

/**
 * Get all symbols exported from a file.
 */
function getFileSymbols(dbPath: string, filePath: string): any[] {
  return queryJSON(dbPath, `
    SELECT id, kind, name, qualified_name, signature
    FROM nodes
    WHERE file_path = '${filePath}'
      AND kind NOT IN ('file', 'import')
    ORDER BY start_line
  `);
}

/**
 * Find files that depend on the given file (import/call/reference its symbols).
 */
function getDependents(dbPath: string, filePath: string): any[] {
  return queryJSON(dbPath, `
    SELECT DISTINCT
      n2.file_path AS dependent_file,
      e.kind AS relationship,
      n2.kind AS target_kind,
      n2.name AS target_name
    FROM edges e
    JOIN nodes n1 ON e.target = n1.id
    JOIN nodes n2 ON e.source = n2.id
    WHERE n1.file_path = '${filePath}'
      AND e.kind IN ('imports', 'calls', 'references', 'instantiates', 'extends', 'implements')
      AND n2.file_path != '${filePath}'
      AND n2.file_path NOT LIKE '.agents/%'
      AND n2.file_path NOT LIKE '.claude/%'
    ORDER BY n2.file_path
  `);
}

/**
 * Check if a file is a frontend page (terminal).
 */
function isFrontendPage(filePath: string): boolean {
  // Vue/React pages in views/ or pages/ directories
  if (/(views|pages)\/.*\.(vue|tsx|jsx)$/.test(filePath)) return true;
  // Layout files
  if (/layout\/.*\.(vue|tsx|jsx)$/.test(filePath)) return true;
  return false;
}

/**
 * Infer route from file path.
 */
function inferRoute(filePath: string): string {
  const parts = filePath.replace(/.*\/(views|pages)\//, '').replace(/\.(vue|tsx|jsx)$/, '');
  return '/' + parts.replace(/\/Index$/i, '').replace(/\/index$/i, '').toLowerCase();
}

/**
 * Recursive trace from a file to frontend pages using SQL.
 */
function traceFileSQL(
  dbPath: string,
  filePath: string,
  depth: number,
  visited: Set<string>
): { hops: TraceHop[]; pages: string[] } {
  if (depth <= 0 || visited.has(filePath)) return { hops: [], pages: [] };
  visited.add(filePath);

  const symbols = getFileSymbols(dbPath, filePath);
  const symbolNames = symbols.map(s => s.name);
  const dependents = getDependents(dbPath, filePath);

  const pages: string[] = [];
  const hops: TraceHop[] = [];

  for (const dep of dependents) {
    const depFile = dep.dependent_file;
    const hop: TraceHop = {
      file: depFile,
      relation: dep.relationship,
      symbol: dep.target_name || depFile,
    };

    if (isFrontendPage(depFile)) {
      hop.terminal = true;
      hops.push(hop);
      pages.push(depFile);
    } else {
      hops.push(hop);
      const sub = traceFileSQL(dbPath, depFile, depth - 1, visited);
      hops.push(...sub.hops);
      pages.push(...sub.pages);
    }
  }

  return { hops, pages };
}

// ---- Public API ----

/**
 * Trace impact for a list of changed files.
 */
export function traceImpact(projectPath: string, files: string[], traceDepth: number = 3): TraceResult {
  if (!hasCodeGraph(projectPath)) {
    return {
      source: 'unavailable',
      tracedAt: new Date().toISOString(),
      chains: [],
      affectedPages: [],
    };
  }

  const dbPath = getDbPath(projectPath);
  const chains: FileChain[] = [];
  const pageSet = new Set<string>();

  for (const file of files) {
    // Skip non-code files
    if (/\.(md|txt|png|svg|ico|jpg|gitignore|lock|sum)$/.test(file)) continue;
    if (file.includes('/.agents/') || file.includes('/.claude/') || file.includes('/.github/')) continue;

    const symbols = getFileSymbols(dbPath, file);
    const { hops, pages } = traceFileSQL(dbPath, file, traceDepth, new Set());

    if (hops.length > 0 || pages.length > 0) {
      chains.push({
        sourceFile: file,
        symbols: symbols.map(s => s.name).slice(0, 10),
        hops,
        affectedPages: [...new Set(pages)],
      });
      pages.forEach(p => pageSet.add(p));
    }
  }

  const affectedPages = [...pageSet].map(file => ({
    route: inferRoute(file),
    file,
  }));

  return {
    source: 'sql-fallback',
    tracedAt: new Date().toISOString(),
    chains,
    affectedPages,
  };
}

/**
 * Trace a single file to its frontend pages.
 */
export function traceFile(projectPath: string, file: string, depth: number = 3): FileChain | null {
  const result = traceImpact(projectPath, [file], depth);
  return result.chains[0] || null;
}
