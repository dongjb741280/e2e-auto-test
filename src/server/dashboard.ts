import http from 'http';
import fs from 'fs';
import path from 'path';

let outputRoot = path.join(process.cwd(), 'test-output');

// ---- Helpers ----

function jsonResponse(res: http.ServerResponse, data: any, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function readJSON(filePath: string, fallback: any = null): any {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { /* corrupt */ }
  return fallback;
}

function readFile(filePath: string): string | null {
  try { return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null; } catch { return null; }
}

function serveFile(res: http.ServerResponse, filePath: string, contentType: string): void {
  const content = readFile(filePath);
  if (content) {
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
}

function listJSONFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse();
  } catch { return []; }
}

// ---- API Handlers ----

function handleStatus(res: http.ServerResponse): void {
  const steps = [
    { name: 'diff',     label: 'Git Diff',        done: fs.existsSync(path.join(outputRoot, 'diff', 'files.json')) || fs.existsSync(path.join(outputRoot, 'diff', 'projects.json')) },
    { name: 'trace',    label: 'CodeGraph Trace',  done: fs.existsSync(path.join(outputRoot, 'trace', 'trace.json')) },
    { name: 'analyze',  label: 'AI Analysis',      done: fs.existsSync(path.join(outputRoot, 'analysis', 'impact.json')) },
    { name: 'browse',   label: 'Page Browse',      done: fs.existsSync(path.join(outputRoot, 'pages', 'pages.json')) },
    { name: 'generate', label: 'Test Generation',  done: listJSONFiles(path.join(outputRoot, 'tests')).length > 0 },
    { name: 'execute',  label: 'Test Execute',     done: fs.existsSync(path.join(outputRoot, 'results', 'results.json')) },
    { name: 'report',   label: 'Report',           done: fs.existsSync(path.join(outputRoot, 'reports')) },
  ];

  jsonResponse(res, { steps, outputRoot });
}

function handleDiff(res: http.ServerResponse): void {
  const projectsPath = path.join(outputRoot, 'diff', 'projects.json');
  if (fs.existsSync(projectsPath)) {
    jsonResponse(res, readJSON(projectsPath, []));
  } else {
    const files = readJSON(path.join(outputRoot, 'diff', 'files.json'), []);
    const commits = readJSON(path.join(outputRoot, 'diff', 'commits.json'), []);
    const summary = readJSON(path.join(outputRoot, 'diff', 'summary.json'), {});
    jsonResponse(res, { projects: [{ files, commits, stats: summary }] });
  }
}

function handleTrace(res: http.ServerResponse): void {
  jsonResponse(res, readJSON(path.join(outputRoot, 'trace', 'trace.json'), { chains: [], affectedPages: [] }));
}

function handleAnalysis(res: http.ServerResponse): void {
  jsonResponse(res, readJSON(path.join(outputRoot, 'analysis', 'impact.json'), null));
}

function handleAnalysisPrompt(res: http.ServerResponse): void {
  serveFile(res, path.join(outputRoot, 'analysis', 'analyze-prompt.md'), 'text/markdown');
}

function handlePages(res: http.ServerResponse): void {
  jsonResponse(res, readJSON(path.join(outputRoot, 'pages', 'pages.json'), []));
}

function handlePageImage(res: http.ServerResponse, url: URL): void {
  const img = url.searchParams.get('path') || '';
  serveFile(res, path.resolve(outputRoot, '..', img), 'image/png');
}

function handleTests(res: http.ServerResponse, url: URL): void {
  const testsDir = path.join(outputRoot, 'tests');
  const file = url.searchParams.get('file');
  if (file) {
    serveFile(res, path.join(testsDir, file), 'text/typescript');
  } else {
    try {
      const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.spec.ts'));
      jsonResponse(res, files);
    } catch { jsonResponse(res, []); }
  }
}

function handleResults(res: http.ServerResponse): void {
  jsonResponse(res, readJSON(path.join(outputRoot, 'results', 'results.json'), []));
}

function handleReports(res: http.ServerResponse, url: URL): void {
  const reportsDir = path.join(outputRoot, 'reports');
  const file = url.searchParams.get('file');
  if (file) {
    const ext = file.endsWith('.json') ? 'application/json' : 'text/markdown';
    serveFile(res, path.join(reportsDir, file), ext);
  } else {
    try {
      const all = fs.readdirSync(reportsDir).filter(f => f.endsWith('.md') || f.endsWith('.json'));
      jsonResponse(res, all);
    } catch { jsonResponse(res, []); }
  }
}

// ---- Router ----

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  // API routes
  if (p === '/api/status')                return handleStatus(res);
  if (p === '/api/diff')                  return handleDiff(res);
  if (p === '/api/trace')                 return handleTrace(res);
  if (p === '/api/analysis')              return handleAnalysis(res);
  if (p === '/api/analysis/prompt')       return handleAnalysisPrompt(res);
  if (p === '/api/pages')                 return handlePages(res);
  if (p === '/api/pages/image')           return handlePageImage(res, url);
  if (p === '/api/tests')                 return handleTests(res, url);
  if (p === '/api/results')               return handleResults(res);
  if (p === '/api/reports')               return handleReports(res, url);

  // Serve dashboard HTML
  const dashboardPath = path.join(__dirname, 'dashboard.html');
  if (p === '/' || p === '/index.html') {
    return serveFile(res, dashboardPath, 'text/html; charset=utf-8');
  }

  res.writeHead(404);
  res.end('Not found');
}

// ---- Public API ----

export function startServer(port: number = 3456, output?: string): http.Server {
  if (output) outputRoot = path.resolve(output);

  const server = http.createServer(handleRequest);

  server.listen(port, () => {
    console.log(`\n  E2E Dashboard: http://localhost:${port}`);
    console.log(`  Data root:     ${outputRoot}`);
    console.log(`  Press Ctrl+C to stop\n`);
  });

  return server;
}
