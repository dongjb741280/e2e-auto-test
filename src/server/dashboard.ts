import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

let outputRoot = path.join(process.cwd(), 'test-output');

function resolveRoot(url: URL): string {
  const q = url.searchParams.get('output');
  return q ? path.resolve(q) : outputRoot;
}

// ---- Task Config ----

interface TaskConfig {
  id: string;
  name: string;
  project: string;
  base: string;
  target: string;
  baseUrl: string;
  headed?: boolean;
  pages?: string;
  createdAt: string;
}

const TASKS_FILE = path.join(process.cwd(), 'test-output', '.tasks.json');

function loadTasks(): TaskConfig[] {
  try { return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8')); } catch { return []; }
}

function saveTasks(tasks: TaskConfig[]): void {
  const dir = path.dirname(TASKS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

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

function getStatus(dir: string) {
  return [
    { name: 'diff',     label: 'Git Diff',        done: fs.existsSync(path.join(dir, 'diff', 'files.json')) || fs.existsSync(path.join(dir, 'diff', 'projects.json')) },
    { name: 'trace',    label: 'CodeGraph Trace',  done: fs.existsSync(path.join(dir, 'trace', 'trace.json')) },
    { name: 'analyze',  label: 'AI Analysis',      done: fs.existsSync(path.join(dir, 'analysis', 'impact.json')) },
    { name: 'browse',   label: 'Page Browse',      done: fs.existsSync(path.join(dir, 'pages', 'pages.json')) },
    { name: 'generate', label: 'Test Generation',  done: listJSONFiles(path.join(dir, 'tests')).length > 0 },
    { name: 'execute',  label: 'Test Execute',     done: fs.existsSync(path.join(dir, 'results', 'results.json')) },
    { name: 'report',   label: 'Report',           done: fs.existsSync(path.join(dir, 'reports')) },
  ];
}

function handleStatus(res: http.ServerResponse, url: URL): void {
  const dir = url.searchParams.get('output') || outputRoot;
  jsonResponse(res, { steps: getStatus(dir), outputRoot: dir });
}

function handleDiff(res: http.ServerResponse, url: URL): void {
  const root = resolveRoot(url);
  const projectsPath = path.join(root, 'diff', 'projects.json');
  if (fs.existsSync(projectsPath)) {
    jsonResponse(res, readJSON(projectsPath, []));
  } else {
    const files = readJSON(path.join(root, 'diff', 'files.json'), []);
    const commits = readJSON(path.join(root, 'diff', 'commits.json'), []);
    const summary = readJSON(path.join(root, 'diff', 'summary.json'), {});
    jsonResponse(res, { projects: [{ files, commits, stats: summary }] });
  }
}

function handleTrace(res: http.ServerResponse, url: URL): void {
  jsonResponse(res, readJSON(path.join(resolveRoot(url), 'trace', 'trace.json'), { chains: [], affectedPages: [] }));
}

function handleAnalysis(res: http.ServerResponse, url: URL): void {
  jsonResponse(res, readJSON(path.join(resolveRoot(url), 'analysis', 'impact.json'), null));
}

function handleAnalysisPrompt(res: http.ServerResponse, url: URL): void {
  serveFile(res, path.join(resolveRoot(url), 'analysis', 'analyze-prompt.md'), 'text/markdown');
}

function handlePages(res: http.ServerResponse, url: URL): void {
  jsonResponse(res, readJSON(path.join(resolveRoot(url), 'pages', 'pages.json'), []));
}

function handlePageImage(res: http.ServerResponse, url: URL): void {
  const img = url.searchParams.get('path') || '';
  serveFile(res, path.resolve(outputRoot, '..', img), 'image/png');
}

function handleTests(res: http.ServerResponse, url: URL): void {
  const root = resolveRoot(url);
  const testsDir = path.join(root, 'tests');
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

function handleResults(res: http.ServerResponse, url: URL): void {
  jsonResponse(res, readJSON(path.join(resolveRoot(url), 'results', 'results.json'), []));
}

function handleReports(res: http.ServerResponse, url: URL): void {
  const reportsDir = path.join(resolveRoot(url), 'reports');
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

// ---- Task API ----

function handleTasksGet(res: http.ServerResponse): void {
  jsonResponse(res, loadTasks());
}

function handleTasksPost(req: http.IncomingMessage, res: http.ServerResponse): void {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try {
      const task: TaskConfig = JSON.parse(body);
      const tasks = loadTasks();
      task.id = String(Date.now());
      task.createdAt = new Date().toISOString();
      tasks.push(task);
      saveTasks(tasks);
      jsonResponse(res, task, 201);
    } catch (e) { jsonResponse(res, { error: String(e) }, 400); }
  });
}

function handleTasksPut(req: http.IncomingMessage, res: http.ServerResponse, id: string): void {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try {
      const update = JSON.parse(body);
      const tasks = loadTasks();
      const idx = tasks.findIndex(t => t.id === id);
      if (idx < 0) return jsonResponse(res, { error: 'Not found' }, 404);
      tasks[idx] = { ...tasks[idx], ...update, id: tasks[idx].id, createdAt: tasks[idx].createdAt };
      saveTasks(tasks);
      jsonResponse(res, tasks[idx]);
    } catch (e) { jsonResponse(res, { error: String(e) }, 400); }
  });
}

function handleTasksDelete(res: http.ServerResponse, id: string): void {
  let tasks = loadTasks();
  tasks = tasks.filter(t => t.id !== id);
  saveTasks(tasks);
  jsonResponse(res, { ok: true });
}

function handleTasksRun(res: http.ServerResponse, id: string): void {
  const tasks = loadTasks();
  const task = tasks.find(t => t.id === id);
  if (!task) return jsonResponse(res, { error: 'Task not found' }, 404);

  const taskOutput = path.join(process.cwd(), 'test-output', id);
  const args = [
    'dist/cli/main.js', 'run',
    '--project', task.project,
    '--base', task.base,
    '--target', task.target,
    '--base-url', task.baseUrl,
    '--output', taskOutput,
    ...(task.headed ? ['--headed'] : []),
    ...(task.pages ? ['--pages', task.pages] : []),
  ];

  const proc = spawn('node', args, { cwd: process.cwd(), stdio: 'ignore' });
  proc.on('error', () => {});
  jsonResponse(res, { ok: true, pid: proc.pid, taskId: id });
}

function handleTaskStepRun(res: http.ServerResponse, id: string, step: string): void {
  const tasks = loadTasks();
  const task = tasks.find(t => t.id === id);
  if (!task) return jsonResponse(res, { error: 'Task not found' }, 404);

  const taskOutput = path.join(process.cwd(), 'test-output', id);
  const cwd = process.cwd();
  let args: string[];
  const baseArgs = ['dist/cli/main.js'];

  switch (step) {
    case 'diff':
      args = [...baseArgs, 'diff',
        '--project', task.project,
        '--base', task.base,
        '--target', task.target,
        '--output', path.join(taskOutput, 'diff'),
      ];
      break;
    case 'trace':
      args = [...baseArgs, 'trace',
        '--project', task.project,
        '--from-diff', path.join(taskOutput, 'diff'),
        '--output', path.join(taskOutput, 'trace'),
      ];
      break;
    case 'analyze':
      args = [...baseArgs, 'analyze',
        '--diff-dir', path.join(taskOutput, 'diff'),
        '--output', path.join(taskOutput, 'analysis'),
      ];
      break;
    case 'browse': {
      // Read pages from analysis if available
      let pages = task.pages || '';
      const impactPath = path.join(taskOutput, 'analysis', 'impact.json');
      if (!pages && fs.existsSync(impactPath)) {
        try {
          const impact = JSON.parse(fs.readFileSync(impactPath, 'utf-8'));
          pages = (impact.affectedPages || []).map((p: any) => p.route).join(',');
        } catch { /* use empty */ }
      }
      if (!pages) return jsonResponse(res, { error: 'No pages to browse. Run analyze step first or set pages in task config.' }, 400);
      args = [...baseArgs, 'browse',
        '--base-url', task.baseUrl,
        '--pages', pages,
        '--output', path.join(taskOutput, 'pages'),
        ...(task.headed ? ['--headed'] : []),
      ];
      break;
    }
    case 'execute':
      args = [...baseArgs, 'execute',
        '--test-dir', path.join(taskOutput, 'tests'),
        '--base-url', task.baseUrl,
        '--output', taskOutput,
        ...(task.headed ? ['--headed'] : []),
      ];
      break;
    case 'report':
      args = [...baseArgs, 'report',
        '--results', path.join(taskOutput, 'results', 'results.json'),
        '--analysis', path.join(taskOutput, 'analysis', 'impact.json'),
        '--output', path.join(taskOutput, 'reports'),
        '--project', task.project,
        '--base-ref', task.base,
        '--target-ref', task.target,
        '--base-url', task.baseUrl,
      ];
      break;
    default:
      return jsonResponse(res, { error: `Unknown step: ${step}. Valid: diff, trace, analyze, browse, execute, report` }, 400);
  }

  const proc = spawn('node', args, { cwd, stdio: 'ignore' });
  proc.on('error', () => {});
  jsonResponse(res, { ok: true, pid: proc.pid, taskId: id, step });
}

// ---- Router ----

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  // Task API
  if (p === '/api/tasks' && req.method === 'GET')     return handleTasksGet(res);
  if (p === '/api/tasks' && req.method === 'POST')    return handleTasksPost(req, res);
  if (p.startsWith('/api/tasks/') && req.method === 'PUT')  return handleTasksPut(req, res, p.split('/')[3]);
  if (p.startsWith('/api/tasks/') && req.method === 'DELETE') return handleTasksDelete(res, p.split('/')[3]);
  if (p.startsWith('/api/tasks/') && p.endsWith('/run')) return handleTasksRun(res, p.split('/')[3]);
  // POST /api/tasks/:id/step/:step
  const stepMatch = p.match(/^\/api\/tasks\/([^/]+)\/step\/(\w+)$/);
  if (stepMatch && req.method === 'POST') return handleTaskStepRun(res, stepMatch[1], stepMatch[2]);

  // API routes
  if (p === '/api/status')                return handleStatus(res, url);
  if (p === '/api/diff')                  return handleDiff(res, url);
  if (p === '/api/trace')                 return handleTrace(res, url);
  if (p === '/api/analysis')              return handleAnalysis(res, url);
  if (p === '/api/analysis/prompt')       return handleAnalysisPrompt(res, url);
  if (p === '/api/pages')                 return handlePages(res, url);
  if (p === '/api/pages/image')           return handlePageImage(res, url);
  if (p === '/api/tests')                 return handleTests(res, url);
  if (p === '/api/results')               return handleResults(res, url);
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
