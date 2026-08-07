import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { TraceHop, SymbolExport, FileChain, TraceResult } from '../types';

export type { TraceHop, SymbolExport, FileChain, TraceResult };

// ============================================================
// CodeGraph detection
// ============================================================

export function hasCodeGraph(projectPath: string): boolean {
  return fs.existsSync(path.join(projectPath, '.codegraph', 'codegraph.db'));
}

function getDbPath(projectPath: string): string {
  return path.join(projectPath, '.codegraph', 'codegraph.db');
}

// ============================================================
// SQL helpers
// ============================================================

function sqlQuery(dbPath: string, query: string): string {
  try {
    return execSync(`sqlite3 -json "${dbPath}" "${query}"`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch { return '[]'; }
}

function queryJSON(dbPath: string, query: string): any[] {
  const raw = sqlQuery(dbPath, query);
  try { return JSON.parse(raw); } catch { return []; }
}

function queryFirst(dbPath: string, query: string): any | null {
  const rows = queryJSON(dbPath, query);
  return rows.length > 0 ? rows[0] : null;
}

// ============================================================
// Step 1: Extract export symbols from the modified file
// ============================================================

/**
 * Extract all exported symbols from a file.
 * An "export" is a node that other files can depend on:
 *   - class, method, function, component, interface, constant, variable
 *   - Excludes 'import' (inbound dependency) and 'file' (container)
 */
function extractExports(dbPath: string, filePath: string): SymbolExport[] {
  const rows = queryJSON(dbPath, `
    SELECT id, kind, name, qualified_name, signature, start_line
    FROM nodes
    WHERE file_path = '${filePath}'
      AND kind NOT IN ('file', 'import')
    ORDER BY start_line
  `);

  return rows.map(r => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    qualifiedName: r.qualified_name,
    signature: r.signature || null,
    startLine: r.start_line,
  }));
}

// ============================================================
// Step 2: Recursive reverse traversal (find callers of callers)
// ============================================================

/**
 * Find all files that import, call, or reference ANY symbol in the given file.
 * This is the "reverse edge" traversal: who depends on me?
 */
function findCallers(dbPath: string, filePath: string): { file: string; relation: string; viaSymbol: string }[] {
  const rows = queryJSON(dbPath, `
    SELECT DISTINCT
      n2.file_path AS caller_file,
      e.kind      AS relation,
      n2.name     AS caller_symbol
    FROM edges e
    JOIN nodes n1 ON e.target = n1.id       -- n1 = symbol in source file
    JOIN nodes n2 ON e.source = n2.id       -- n2 = caller (depends on n1)
    WHERE n1.file_path = '${filePath}'
      AND e.kind IN ('imports', 'calls', 'references', 'instantiates', 'extends', 'implements')
      AND n2.file_path != '${filePath}'
      AND n2.file_path NOT LIKE '.agents/%'
      AND n2.file_path NOT LIKE '.claude/%'
    ORDER BY n2.file_path
  `);

  return rows.map(r => ({
    file: r.caller_file,
    relation: r.relation,
    viaSymbol: r.caller_symbol || r.caller_file,
  }));
}

// ============================================================
// Step 3: Define "frontend page" (terminal detection)
// ============================================================

/**
 * Three signals to determine if a file is a terminal frontend page:
 *
 * Signal A — Path pattern:
 *   File is in /pages/, /views/ directories, or is App.(vue|tsx|jsx)
 *
 * Signal B — Framework pattern:
 *   - Vue:  file contains a 'component' node with is_exported=1 (page-level export default)
 *   - React: file contains Route definition (path="..." or <Route)
 *   Checked via CodeGraph nodes: kind='component' AND in views/pages dir
 *
 * Signal C — Orphan detection (leaf node):
 *   No other file imports this component → it's a terminal entry point.
 *   Checked via: zero incoming 'imports' edges from other files.
 */
function isFrontendFile(filePath: string): boolean {
  return /\.(vue|tsx|jsx)$/.test(filePath) && !/node_modules/.test(filePath);
}

function detectTerminal(dbPath: string, filePath: string): { isTerminal: boolean; reason: string } {
  // Only frontend files can be terminals.
  // Backend files (Java, Go, Python, etc.) always continue tracing
  // because their consumers (frontend API clients) are what we want.
  if (!isFrontendFile(filePath)) {
    return { isTerminal: false, reason: '' };
  }

  // Signal A: path pattern — in views/ or pages/ directory
  if (/(views|pages)\/.*\.(vue|tsx|jsx)$/.test(filePath)) {
    return { isTerminal: true, reason: 'path: /views/ or /pages/' };
  }
  if (/(App|app)\.(vue|tsx|jsx)$/.test(filePath)) {
    return { isTerminal: true, reason: 'path: App entry point' };
  }
  if (/layout\/.*\.(vue|tsx|jsx)$/.test(filePath)) {
    return { isTerminal: true, reason: 'path: layout entry' };
  }

  // Signal B: framework — is there a 'component' node that's exported?
  const componentNode = queryFirst(dbPath, `
    SELECT is_exported FROM nodes
    WHERE file_path = '${filePath}' AND kind = 'component' LIMIT 1
  `);
  if (componentNode && (componentNode as any).is_exported === 1) {
    if (/src\/.*\.vue$/.test(filePath)) {
      return { isTerminal: true, reason: 'framework: exported component in src/' };
    }
  }

  // Signal C: orphan — no other file imports this file
  const importCount = queryFirst(dbPath, `
    SELECT COUNT(*) as cnt FROM edges e
    JOIN nodes n ON e.target = n.id
    WHERE n.file_path = '${filePath}'
      AND e.kind = 'imports'
      AND e.source NOT IN (SELECT id FROM nodes WHERE file_path = '${filePath}')
  `);
  if (importCount && (importCount as any).cnt === 0) {
    return { isTerminal: true, reason: 'orphan: no other file imports this' };
  }

  return { isTerminal: false, reason: '' };
}

/**
 * Infer route from file path + CodeGraph route nodes.
 */
function inferRoute(dbPath: string, filePath: string): string {
  // Frontend file: check if CodeGraph has a 'route' node
  if (isFrontendFile(filePath)) {
    const routeNode = queryFirst(dbPath, `
      SELECT name FROM nodes
      WHERE file_path = '${filePath}' AND kind = 'route' LIMIT 1
    `);
    if (routeNode) return (routeNode as any).name;
  }

  // Fall back to file path inference (frontend only)
  if (/(views|pages)\/.*\.(vue|tsx|jsx)$/.test(filePath)) {
    const parts = filePath
      .replace(/.*\/(views|pages)\//, '')
      .replace(/\.(vue|tsx|jsx)$/, '')
      .replace(/\/Index$/i, '')
      .replace(/\/index$/i, '');
    return '/' + parts.toLowerCase();
  }

  return filePath;
}

// ============================================================
// Core: recursive reverse traversal
// ============================================================

function traceRecursive(
  dbPath: string,
  filePath: string,
  depth: number,
  visited: Set<string>,
  frontendFileCache?: Map<string, string>,
): { hops: TraceHop[]; pages: string[] } {
  if (depth <= 0 || visited.has(filePath)) return { hops: [], pages: [] };
  visited.add(filePath);

  const callers = findCallers(dbPath, filePath);
  const pages: string[] = [];
  const hops: TraceHop[] = [];

  // Cross-language bridge: backend route → frontend API consumer
  // CodeGraph tracks intra-language edges only. Backend→frontend bridge
  // requires searching the actual file content for API path strings.
  // Uses a pre-loaded content cache to avoid per-file fs.readFileSync calls.
  if (/\.(java|go|py|kt)$/.test(filePath)) {
    const routeNodes = queryJSON(dbPath, `
      SELECT name, signature FROM nodes
      WHERE file_path = '${filePath}' AND kind = 'route'
    `);

    const seenFrontendFiles = new Set<string>();

    for (const route of routeNodes) {
      const apiPath = (route.name as string).replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/i, '');
      // Also try partial paths: "/admin/menu/{menuId}" → "/admin/menu"
      const partialPath = apiPath.replace(/\/\{[^}]+\}/g, '');

      if (frontendFileCache) {
        for (const [file, content] of frontendFileCache) {
          if (seenFrontendFiles.has(file)) continue;
          if (content.includes(apiPath) || (partialPath !== apiPath && content.includes(partialPath))) {
            seenFrontendFiles.add(file);
            callers.push({
              file,
              relation: 'api-consumer',
              viaSymbol: `HTTP ${apiPath}`,
            });
          }
        }
      }
    }
  }

  for (const caller of callers) {
    const { isTerminal, reason } = detectTerminal(dbPath, caller.file);

    const hop: TraceHop = {
      file: caller.file,
      relation: caller.relation,
      symbol: caller.viaSymbol,
      confidence: caller.relation === 'api-consumer' ? 'low' : 'high',
    };

    if (isTerminal) {
      hop.terminal = true;
      hop.terminalReason = reason;
      hops.push(hop);
      pages.push(caller.file);
    } else {
      hops.push(hop);
      const sub = traceRecursive(dbPath, caller.file, depth - 1, visited, frontendFileCache);
      hops.push(...sub.hops);
      pages.push(...sub.pages);
    }
  }

  return { hops, pages };
}

// ============================================================
// Public API
// ============================================================

/**
 * Trace impact for a list of changed files.
 * For each file: extract exports → find callers → recurse → stop at terminals.
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
  const projectRoot = path.dirname(dbPath);

  // Pre-load frontend file contents for cross-language bridge lookups.
  // This avoids O(routes × files) individual fs.readFileSync calls in traceRecursive.
  const frontendFiles = queryJSON(dbPath, `
    SELECT DISTINCT file_path FROM nodes
    WHERE file_path NOT LIKE '%.java' AND file_path NOT LIKE '%.go'
      AND file_path NOT LIKE '%.py' AND file_path NOT LIKE '%.kt'
      AND file_path NOT LIKE '%.xml' AND file_path NOT LIKE '%.properties'
      AND file_path NOT LIKE '.agents/%' AND file_path NOT LIKE '.claude/%'
      AND file_path NOT LIKE 'node_modules/%'
    ORDER BY file_path
  `);

  const frontendFileCache = new Map<string, string>();
  for (const ff of frontendFiles) {
    const fullPath = path.join(projectRoot, ff.file_path);
    try {
      frontendFileCache.set(ff.file_path, fs.readFileSync(fullPath, 'utf-8'));
    } catch { /* file not found, skip */ }
  }

  const chains: FileChain[] = [];
  const pageSet = new Set<string>();

  for (const file of files) {
    // Skip non-code files
    if (/\.(md|txt|png|svg|ico|jpg|gitignore|lock|sum)$/.test(file)) continue;
    if (/(\/|^)\.agents\/|(\/|^)\.claude\/|(\/|^)\.github\//.test(file)) continue;

    const symbols = extractExports(dbPath, file);
    const { hops, pages } = traceRecursive(dbPath, file, traceDepth, new Set(), frontendFileCache);

    if (hops.length > 0 || pages.length > 0) {
      chains.push({
        sourceFile: file,
        symbols,
        hops,
        affectedPages: [...new Set(pages)],
      });
      pages.forEach(p => pageSet.add(p));
    }
  }

  const affectedPages = [...pageSet].map(file => ({
    route: inferRoute(dbPath, file),
    file,
  }));

  return {
    source: 'codegraph',
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
