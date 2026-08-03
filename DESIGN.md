# E2E Change-Impact Testing Tool — 设计文档

## 1. 概述

### 1.1 项目定位

面向**变更驱动的增量 E2E 测试**。与传统的全量回归测试框架不同，本工具聚焦于两个 Git 版本之间的差异，利用 AI 分析变更影响范围，仅生成和执行与变更相关的测试用例，最终输出一份「变更影响测试报告」。

### 1.2 核心价值

- **精准**：只测变更影响的页面和功能，不浪费执行时间
- **自动化**：从 diff 到报告，全流程一键完成
- **可审查**：AI 生成的分析结果和测试代码均为结构化 JSON/TS，可人工审核修改
- **可集成**：CLI 设计支持嵌入 CI/CD Pipeline

### 1.3 设计原则

| 原则 | 说明 |
|------|------|
| 工程层确定性 | Git 操作、浏览器控制、报告渲染等执行路径 100% 可预测、可复现 |
| 智能层可替换 | AI 分析模块通过输入/输出接口与工程层解耦，可替换模型或改为人工 |
| 最小化抽象 | 不引入 DI 容器、不预设插件总线。三个 interface 即全部扩展点 |
| 文件系统即为协议 | 各 Step 之间通过约定路径的 JSON 文件传递数据，不依赖内存状态 |

---

## 2. 架构总览

### 2.1 分层架构

```
┌──────────────────────────────────────────────────────┐
│                    CLI Layer                          │
│  Commander.js → 命令解析 → 参数校验 → 调用 Command   │
├──────────────────────────────────────────────────────┤
│                  Command Layer                        │
│  diff.ts │ browse.ts │ execute.ts │ report.ts │ run.ts│
│  每个 Command 对应一个 Pipeline Step                   │
├──────────────────────────────────────────────────────┤
│                   Core Layer                          │
│  git/diff.ts  │  browser/*  │  runner/  │  reporter/  │
│  纯函数/类，不依赖 CLI，可独立测试                       │
├──────────────────────────────────────────────────────┤
│                   Types Layer                         │
│  types/index.ts — 所有接口、类型、数据结构               │
└──────────────────────────────────────────────────────┘
```

### 2.2 Pipeline 数据流

```
 Step 1          Step 2           Step 3          Step 4          Step 5         Step 6
┌────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  diff  │    │ AI 分析  │    │  browse  │    │ AI 生成  │    │ execute  │    │  report  │
│        │    │ (Claude) │    │          │    │ (Claude) │    │          │    │          │
└───┬────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘
    │              │               │               │               │               │
    ▼              ▼               ▼               ▼               ▼               ▼
diff/         analysis/        pages/           tests/          results/       reports/
├─files.json  └─impact.json    ├─login.html     ├─*.spec.ts     └─results.json ├─change-report.md
├─raw.diff                     ├─login.png                                    └─change-report.json
└─commits.json                 └─pages.json
```

**关键约束**：每一步只读取前一步的输出，不跨步依赖。任何 Step 可独立执行（只要有上一步的输出文件）。

---

## 3. 核心类型设计

### 3.1 DiffOutput（Step 1 输出）

```typescript
interface DiffOutput {
  baseRef: string;           // 基线版本标识
  targetRef: string;         // 目标版本标识
  files: FileChange[];       // 变更文件列表
  rawDiff: string;           // 完整 unified diff
  commits: CommitInfo[];     // commit 历史
  stats: DiffStats;          // +/-, 文件数统计
}

interface FileChange {
  path: string;              // 文件路径
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;          // 重命名时的原路径
  additions: number;         // 新增行数
  deletions: number;         // 删除行数
  patch: string;             // unified diff 片段
}
```

### 3.2 ImpactAnalysis（Step 2 输出，Claude Code 生成）

```typescript
interface ImpactAnalysis {
  summary: string;              // 一句话概述
  affectedPages: AffectedPage[]; // 受影响页面列表
  riskLevel: 'low' | 'medium' | 'high';
  recommendation: string;       // 合并/部署建议
}

interface AffectedPage {
  route: string;              // 前端路由，如 "/login"
  name: string;               // 人类可读名称
  changeType: 'new' | 'modified' | 'removed';
  changeDescription: string;  // 自然语言变更描述
  impactedFiles: string[];    // 关联源文件
  testScenarios: TestScenario[]; // 建议的测试场景
}

interface TestScenario {
  name: string;               // 场景名
  priority: 'P0' | 'P1' | 'P2';
  steps: string[];            // 自然语言步骤
  expectedResult: string;     // 预期结果
}
```

### 3.3 PageSnapshot（Step 3 输出）

```typescript
interface PageSnapshot {
  route: string;              // 页面路由
  url: string;                // 完整 URL
  title: string;              // 页面标题
  dom: string;                // 简化 DOM 结构 (≤30KB)
  interactiveElements: ElementInfo[]; // 可交互元素列表
  screenshot?: string;        // 截图文件路径
}

interface ElementInfo {
  tag: string;                // 标签名
  text: string;               // 展示文本
  selector: string;           // 推荐 Playwright 选择器
  attributes: Record<string, string>;
  testId?: string;            // data-testid 值（若存在）
}
```

### 3.4 ChangeReport（Step 6 输出）

```typescript
interface ChangeReport {
  meta: {
    project: string;
    baseRef: string;
    targetRef: string;
    baseUrl: string;
    generatedAt: string;       // ISO 8601
  };
  diff: DiffStats;
  analysis: ImpactAnalysis;
  tests: {
    generated: number;
    passed: number;
    failed: number;
    details: ExecutionResult[];
  };
  conclusion: string;          // AI 生成的结论
}
```

---

## 4. 模块设计

### 4.1 Git 模块 (`src/git/diff.ts`)

**职责**：封装 `git` 命令调用，提取两个版本间的差异信息。

**核心函数**：

```typescript
extractDiff(projectPath, baseRef, targetRef, outputDir): DiffOutput
```

**实现细节**：

```
1. git rev-parse --git-dir          → 校验是否为 git 仓库
2. git rev-parse <base>/<target>    → 校验 ref 是否存在
3. git diff --name-status <base>...<target> → 获取变更文件列表
4. git diff --numstat ...           → 获取每个文件的 +/- 行数
5. git diff ...                     → 获取每个文件的 unified diff
6. git log ... --no-merges          → 获取 commit 历史
```

**错误处理**：自定义 `GitDiffError` 类，区分「不是仓库」「ref 不存在」「命令执行失败」三种错误场景。

---

### 4.2 浏览器模块 (`src/browser/`)

#### 4.2.1 manager.ts — 浏览器生命周期

```typescript
launchBrowser(options): BrowserInstance    // 启动浏览器 + 创建 context
closeBrowser(instance): void               // 关闭浏览器
```

`BrowserInstance` 封装了 `Browser` + `BrowserContext` + `Page` 三元组，调用方只需持有这一个对象。context 配置了 `ignoreHTTPSErrors: true` 以兼容内部测试环境的自签名证书。

#### 4.2.2 page-scraper.ts — DOM 提取

```typescript
scrapePage(options): PageSnapshot           // 抓取单个页面
scrapePages(page, routes, baseUrl, dir): PageSnapshot[]  // 批量抓取
```

**DOM 提取策略**：

1. 导航到目标页面，等待 `networkidle`（超时 30s 后继续）
2. 额外 `waitForTimeout(1000)` 等待 JS 渲染完成
3. 提取简化 DOM：移除 `<script>`、`<style>`、`<noscript>`、`<svg>` 等非语义标签，文本节点超过 200 字符处截断，整个 DOM 限制在 30KB 以内
4. 提取交互元素：遍历 `a, button, input, select, textarea, [data-testid], [role="button"]` 等选择器
5. 为每个元素生成推荐选择器，优先级：`data-testid > id > name > aria-label > text content > placeholder`
6. 全页面截图（viewport only）

---

### 4.3 执行器模块 (`src/runner/executor.ts`)

**职责**：动态生成 Playwright 配置文件，执行测试，解析结果。

```typescript
executeTests(options): ExecutionResult[]
```

**流程**：

```
1. 校验 testDir 存在
2. 生成临时 playwright.config.ts (绝对路径 testDir, 30s timeout, 0 retry)
3. npx playwright test --config=<tmp-config>
4. 解析 JSON reporter 输出
5. 删除临时配置文件
6. 返回 ExecutionResult[]
```

**设计考量**：
- 不为测试单独下载浏览器，复用 Playwright 全局安装的浏览器
- 临时 config 文件在测试执行后立即删除，不污染项目
- `ignoreHTTPSErrors: true` 兼容内部环境

---

### 4.4 报告模块 (`src/reporter/index.ts`)

**职责**：将 `ChangeReport` 渲染为 Markdown + JSON 文件。

```typescript
generateMarkdownReport(report): string   // 渲染 Markdown
writeReport(report, outputDir): string   // 写入文件，返回路径
```

**报告结构**：

```
1. 变更概要 — 表格展示 filesChanged / additions / deletions
2. 影响分析 — 风险等级 + 摘要 + 每个受影响页面的详细分析 + 建议测试场景
3. 测试执行结果 — 通过/失败统计 + 用例详情
4. 结论 — AI 生成
```

---

### 4.5 CLI 模块 (`src/cli/main.ts` + `src/commands/`)

**框架**：Commander.js

**命令树**：

```
e2e-test
├── run      全流程
├── diff     提取 diff
├── browse   浏览页面
├── execute  执行测试
├── report   生成报告
└── analyze  AI 分析提示
```

**run 命令的编排逻辑** (`src/commands/run.ts`)：

```
Step 1 → diffCommand()
Step 2 → 提示用户由 Claude Code 完成分析 (输出路径在 impact.json)
Step 3 → browseCommand() (如果 analysis 已存在，自动读取 affectedPages)
Step 4 → 提示用户由 Claude Code 生成测试 (输出路径在 tests/)
Step 5 → executeCommand() (如果 tests/ 目录存在)
Step 6 → reportCommand() (整合所有中间产物)
```

---

## 5. 选择器策略

页面抓取时为每个元素生成推荐选择器，优先级从高到低：

| 优先级 | 选择器 | 示例 |
|--------|--------|------|
| 1 | `data-testid` / `data-test` | `[data-testid="login-button"]` |
| 2 | `id` | `#login-form` |
| 3 | `name` | `[name="username"]` |
| 4 | `aria-label` | `[aria-label="Search"]` |
| 5 | 文本 + 标签 | `button:has-text("登录")` |
| 6 | placeholder | `[placeholder="用户名"]` |

AI 生成测试代码时，优先使用 `data-testid` 选择器（若有），否则回退到 `placeholder` 或 `getByRole`。页面浏览步骤（Step 3）正是为了发现这些真实选择器。

---

## 6. 扩展点

整个系统的扩展通过三个 interface 完成，不设插件注册机制：

### 6.1 新增浏览器类型

修改 `src/browser/manager.ts` 的 `LaunchOptions.browser` 联合类型，添加新的 `launch` 调用。

### 6.2 新增报告格式

在 `src/reporter/index.ts` 中新增渲染函数，如 `generateHtmlReport()`，然后在 `reportCommand()` 中调用。

### 6.3 替换 AI 模型

影响分析和测试生成完全通过 JSON 文件解耦：
- 替换为 OpenAI API：编写新的 client 模块，读取 `diff/` 输出，写入 `analysis/impact.json`
- 替换为人工：直接手动编写 JSON 文件即可

### 6.4 新增命令

在 `src/commands/` 中新增模块，在 `src/cli/main.ts` 中注册。

---

## 7. 目录约定

| 目录 | 用途 | Git |
|------|------|-----|
| `src/` | TypeScript 源码 | ✓ |
| `tests/examples/` | 示例测试用例 | ✓ |
| `templates/` | Handlebars 模板 | ✓ |
| `dist/` | 编译产物 | ✗ |
| `test-output/` | 运行时输出 | ✗ |
| `node_modules/` | 依赖 | ✗ |

---

## 8. 依赖清单

| 包 | 用途 | 必要性 |
|---|---|---|
| `@playwright/test` | 浏览器自动化 | 核心 |
| `commander` | CLI 参数解析 | 核心 |
| `js-yaml` | YAML 配置解析 | 核心 |
| `zod` | 配置校验 | 核心 |
| `chalk` | 终端颜色 | 体验 |
| `ora` | 终端 spinner | 体验 |
| `handlebars` | 报告模板渲染 | 可选 |
| `pino` | 结构化日志 | 可选 |
| `@anthropic-ai/sdk` | Claude API | 可选 |
