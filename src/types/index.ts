// ============================================================
// Git Diff Types (Step 1)
// ============================================================

export interface DiffStats {
  additions: number;
  deletions: number;
  filesChanged: number;
}

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;
  additions: number;
  deletions: number;
  patch: string;
}

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface DiffOutput {
  projectPath: string;
  baseRef: string;
  targetRef: string;
  files: FileChange[];
  rawDiff: string;
  commits: CommitInfo[];
  stats: DiffStats;
}

/** One project + its version pair */
export interface ProjectSpec {
  path: string;
  baseRef: string;
  targetRef: string;
}

/** Aggregated diff across all projects */
export interface MultiDiffOutput {
  projects: DiffOutput[];
  stats: DiffStats;
}

// ============================================================
// Impact Analysis Types (Step 2, Claude Code generates)
// ============================================================

export interface TestScenario {
  name: string;
  priority: 'P0' | 'P1' | 'P2';
  steps: string[];
  expectedResult: string;
}

export interface AffectedPage {
  route: string;
  name: string;
  changeType: 'new' | 'modified' | 'removed';
  changeDescription: string;
  impactedFiles: string[];
  testScenarios: TestScenario[];
}

export interface ImpactAnalysis {
  summary: string;
  affectedPages: AffectedPage[];
  riskLevel: 'low' | 'medium' | 'high';
  recommendation: string;
}

// ============================================================
// Page Snapshot Types (Step 3)
// ============================================================

export interface ElementInfo {
  tag: string;
  text: string;
  selector: string;
  attributes: Record<string, string>;
  testId?: string;
}

export interface PageSnapshot {
  route: string;
  url: string;
  title: string;
  dom: string;
  interactiveElements: ElementInfo[];
  screenshot?: string;
}

// ============================================================
// CodeGraph Trace Types (Step 1.5)
// ============================================================

export interface TraceHop {
  file: string;
  relation: string;      // calls | imports | references | instantiates | extends | api-consumer
  symbol: string;
  terminal?: boolean;
  terminalReason?: string;
}

export interface SymbolExport {
  id: string;
  kind: string;
  name: string;
  qualifiedName: string;
  signature: string | null;
  startLine: number;
}

export interface FileChain {
  sourceFile: string;
  symbols: SymbolExport[];
  hops: TraceHop[];
  affectedPages: string[];
}

export interface TraceResult {
  source: 'codegraph' | 'unavailable';
  tracedAt: string;
  chains: FileChain[];
  affectedPages: { route: string; file: string }[];
}

// ============================================================
// Generated Test Types (Step 4)
// ============================================================

export interface GeneratedTest {
  page: string;
  fileName: string;
  code: string;
  scenarios: string[];
}

// ============================================================
// Execution Result Types (Step 5)
// ============================================================

export interface ScenarioResult {
  name: string;
  status: 'passed' | 'failed';
  duration: number;
  error?: string;
  screenshot?: string;
}

export interface ExecutionResult {
  testFile: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  scenarios: ScenarioResult[];
}

// ============================================================
// Change Report Types (Step 6)
// ============================================================

export interface ChangeReport {
  meta: {
    projects: string[];         // project paths
    baseRef: string;            // 多项目统一基线，或逗号分隔
    targetRef: string;
    baseUrl: string;
    generatedAt: string;
  };
  diff: DiffStats;
  analysis: ImpactAnalysis;
  tests: {
    generated: number;
    passed: number;
    failed: number;
    details: ExecutionResult[];
  };
  conclusion: string;
}

// ============================================================
// Config Types (for project-level e2e.config.yaml)
// ============================================================

export interface ProjectConfig {
  name?: string;
  baseUrl?: string;
  login?: {
    url: string;
    selectors: {
      username: string;
      password: string;
      submit: string;
    };
    credentials: {
      username: string;
      password: string;
    };
  };
  browsers?: {
    headless?: boolean;
    viewport?: { width: number; height: number };
  };
}
