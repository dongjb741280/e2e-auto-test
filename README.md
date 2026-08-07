# E2E Change-Impact Testing Tool

基于 Playwright + Claude Code + CodeGraph 的**变更影响自动化测试工具**。

指定项目 + 两个 Git 版本号 → 自动提取 diff → CodeGraph 追溯调用链 → AI 分析影响 → 浏览页面 → 生成增量 Playwright 测试 → 执行 → 输出变更报告。

## 核心流程

```
Step 1:  Git Diff        → 提取变更文件
Step 1.5: CodeGraph Trace → 变更文件 → 调用链 → 前端页面 (AST 级精确追溯)
Step 2:  AI 影响分析      → 识别受影响功能 + 测试场景 (Claude Code Skill)
Step 3:  页面浏览         → 提取真实 DOM + 选择器 + 截图
Step 4:  AI 用例生成      → 生成 Playwright .spec.ts (Claude Code Skill)
Step 5:  Playwright 执行  → 运行增量测试
Step 6:  变更报告         → Markdown + JSON 报告
```

## 快速开始

```bash
npm install
npm run build

# 完整流程
npx e2e-test run \
  --project /path/to/your-project \
  --base v1.0.0 \
  --target v1.1.0 \
  --base-url http://localhost:3000

# 远程 Git 仓库（自动 clone，结束后自动清理）
npx e2e-test run \
  --project "https://github.com/user/repo.git" \
  --base v1.0.0 \
  --target v1.1.0 \
  --base-url http://localhost:3000

# 前后端分离（逗号分隔，按索引配对）
npx e2e-test run \
  --project /path/to/frontend,/path/to/backend \
  --base v1.0.0,v2.0.0 \
  --target v1.1.0,v2.1.0 \
  --base-url http://localhost:3000
```

Pipeline 在 Step 2 和 Step 4 暂停（等待 Claude Code 写入分析/测试），通过 `--resume` 续跑：

```bash
e2e-test run ...                   # Step 1 + 1.5 完成，暂停
# Claude Code 写入 impact.json
e2e-test run --resume -u <url>     # Step 2-3 完成，暂停
# Claude Code 写入 tests/*.spec.ts
e2e-test run --resume -u <url>     # Step 4-6 完成
```

## 命令参考

### `run` — 完整 Pipeline

| 选项 | 说明 |
|------|------|
| `-p, --project <paths>` | 项目路径或 Git URL（逗号分隔多项目） |
| `-b, --base <refs>` | 基线版本 |
| `-t, --target <refs>` | 目标版本 |
| `-u, --base-url <url>` | 被测应用 URL（必需） |
| `--headed` | 有头模式 |
| `-o, --output <dir>` | 输出目录（默认 `test-output`） |
| `--pages <routes>` | 手动指定页面路由 |
| `--no-cleanup` | 保留远程仓库 clone 缓存 |
| `--no-clean` | 保留上次运行的中间数据 |
| `--resume` | 跳过 Step 0+1，从 Step 2 续跑 |

### `diff` — 提取 Git Diff

```bash
npx e2e-test diff \
  -p, --project <paths>   # 项目路径或 URL（逗号分隔）
  -b, --base <refs>       # 基线版本
  -t, --target <refs>     # 目标版本
  [-o, --output <dir>]    # 默认 test-output/diff
```

### `trace` — CodeGraph 依赖链追溯

```bash
npx e2e-test trace \
  -p, --project <path>    # 项目路径（必需）
  [--files <paths>]       # 追溯的文件（逗号分隔）
  [--from-diff <dir>]     # 从 diff 目录读取变更文件
  [--depth <n>]           # 追溯深度（默认 3）
  [-o, --output <dir>]    # 默认 test-output/trace
```

### `browse` — 浏览页面提取 DOM

```bash
npx e2e-test browse \
  -u, --base-url <url>
  --pages <routes>        # 逗号分隔
  [--headed]
  [-o, --output <dir>]    # 默认 test-output/pages
```

### `execute` — 执行 Playwright 测试

```bash
npx e2e-test execute \
  -d, --test-dir <dir>    # 测试文件目录
  -u, --base-url <url>
  [--headed]
  [-o, --output <dir>]    # 默认 test-output
```

### `report` — 生成变更报告

```bash
npx e2e-test report \
  [-r, --results <path>]
  [-a, --analysis <path>]
  [-o, --output <dir>]
  [--project <name>] [--base-ref <ref>] [--target-ref <ref>] [--base-url <url>]
```

报告以时间戳命名（`change-report-YYYYMMDD-HHmmss.md`），多次运行不覆盖。

### `analyze` — 输出 AI 分析提示

```bash
npx e2e-test analyze \
  [-d, --diff-dir <dir>]  # 默认 test-output/diff
  [-o, --output <dir>]    # 默认 test-output/analysis
```

读取 diff 数据，输出结构化分析提示（含文件列表、commits、raw diff），供 Claude Code 使用。

### `serve` — 可视化 Dashboard + 任务管理

```bash
npx e2e-test serve \
  [-p, --port <n>]       # HTTP 端口 (默认 3456)
  [-o, --output <dir>]   # 数据根目录 (默认 test-output)
  [--open]               # 自动打开浏览器
```

启动 Web Dashboard，提供 Pipeline 可视化、中间结果查询、任务配置管理。

**任务管理**（页面顶部下拉选择器）：
- 创建/删除任务 → 持久化 `.tasks.json`
- 选择任务 → 所有标签页自动切换为该任务的输出目录
- 点击「运行」→ 后台执行 Pipeline，输出到 `test-output/<任务ID>/`

**9 个标签页**：任务 / 概览 / Diff / Trace / 分析 / 页面 / 测试 / 结果 / 报告

```bash
# 前台运行 (Ctrl+C 停止)
e2e-test serve --port 3456 --open

# 后台运行
e2e-test serve --port 3456 &
kill %1   # 停止
```

## 目录结构

```
e2e-auto-test/
├── src/
│   ├── cli/main.ts              # CLI 入口
│   ├── commands/
│   │   ├── pipeline.ts          # 全流程编排 (7-Step)
│   │   ├── diff.ts              # Git diff 提取
│   │   ├── trace.ts             # CodeGraph 依赖链追溯
│   │   ├── analyze.ts           # AI 分析 prompt 构建
│   │   ├── browse.ts            # 页面 DOM 提取
│   │   ├── exec-tests.ts        # 测试执行
│   │   ├── report.ts            # 报告生成
│   │   └── serve.ts             # Dashboard 服务
│   ├── git/diff.ts              # Git 操作封装（远程 clone 支持）
│   ├── ai/prompt.ts             # AI 分析 prompt 构建器
│   ├── codegraph/tracer.ts      # CodeGraph SQL 追溯器
│   ├── browser/
│   │   ├── manager.ts           # Playwright 浏览器管理
│   │   └── page-scraper.ts      # 页面 DOM + 选择器提取
│   ├── server/
│   │   ├── dashboard.ts         # HTTP 服务器 + REST API
│   │   └── dashboard.html       # 单文件 SPA 前端
│   ├── runner/executor.ts       # Playwright 测试执行器
│   ├── reporter/index.ts        # Markdown 报告生成
│   └── types/index.ts           # 20 个核心类型定义
├── .claude/skills/              # Claude Code Skill 定义
│   ├── e2e-analyze.md           # Step 2: 变更影响分析
│   ├── e2e-generate.md          # Step 4: 测试代码生成
│   └── e2e-trace.md             # 辅助: 单文件影响追溯
├── scripts/
│   └── codegraph-to-obsidian.sh # CodeGraph DB → Obsidian Vault 转换
├── tests/examples/              # 示例测试用例
└── test-output/                 # 运行时输出 (gitignore)
    ├── .tasks.json              # 任务配置持久化
    └── <task-id>/               # 每个任务独立输出目录
```

## 输出结构

```
test-output/
├── diff/                     # Step 1: Git diff
│   ├── projects.json         # 多项目汇总
│   ├── summary.json          # 合并统计
│   ├── <project>/files.json  # 单项目变更文件
│   └── <project>/commits.json
├── trace/                    # Step 1.5: CodeGraph 追溯
│   └── trace.json            # 调用链 + 受影响页面
├── analysis/                 # Step 2: AI 影响分析
│   └── impact.json
├── pages/                    # Step 3: 页面快照
│   ├── pages.json            # 所有页面摘要
│   └── <route>.html / .png   # DOM + 截图
├── tests/                    # Step 4: 生成测试（保留，用户资产）
│   └── *.spec.ts
├── results/                  # Step 5: 执行结果
│   └── results.json
└── reports/                  # Step 6: 报告（保留，历史累积）
    ├── change-report-YYYYMMDD-HHmmss.md
    └── change-report-YYYYMMDD-HHmmss.json
```

**生命周期**：每次运行清除 `diff/`, `trace/`, `analysis/`, `pages/`, `results/`。保留 `tests/` 和 `reports/`。`--no-clean` 保留中间数据，`--resume` 跳过清除。

## Claude Code Skill 集成

| Skill | Step | 输入 → 输出 |
|-------|------|-------------|
| `/e2e-analyze` | 2 | `diff/` + `trace/` → `analysis/impact.json` |
| `/e2e-generate` | 4 | `impact.json` + `pages/` → `tests/*.spec.ts` |
| `/e2e-trace` | 辅助 | 文件路径 → 前端页面依赖链 (CodeGraph AST 级) |

## CodeGraph 辅助工具

```bash
# CodeGraph DB → Obsidian Vault（在图视图中查看代码关系网络）
./scripts/codegraph-to-obsidian.sh <codegraph.db> <output-dir>
```

## 测试用例格式

```typescript
import { test, expect } from '@playwright/test';

test.describe('软电话工作台 — 班长监控功能', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[placeholder="用户名"]', 'admin');
    await page.fill('input[placeholder="密码"]', '12345678');
    await page.click('button:has-text("登 录")');
    await page.goto('/softphone');
  });

  test('班长监控卡片包含目标坐席输入和三个监控按钮', async ({ page }) => {
    await expect(page.locator('input[placeholder="目标坐席"]')).toBeVisible();
    await expect(page.getByRole('button', { name: '监听' })).toBeVisible();
    await expect(page.getByRole('button', { name: '强插' })).toBeVisible();
    await expect(page.getByRole('button', { name: '耳语' })).toBeVisible();
  });
});
```
