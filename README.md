# E2E Change-Impact Testing Tool

基于 Playwright + Claude Code 的**变更影响自动化测试工具**。指定项目 + 两个 Git 版本号，自动分析变更、推导受影响的前台功能、生成增量 Playwright 测试用例、执行测试、输出变动报告。

## 核心流程

```
Git Diff → AI 影响分析 → AI 用例生成 → Playwright 执行 → 变更报告
```

## 快速开始

```bash
npm install
npm run build

# 单项目
npx e2e-test run \
  --project /path/to/your-project \
  --base v1.0.0 \
  --target v1.1.0 \
  --base-url http://localhost:3000

# 前后端分离项目（逗号分隔，按索引一一对应）
npx e2e-test run \
  --project /path/to/frontend,/path/to/backend \
  --base v1.0.0,v2.0.0 \
  --target v1.1.0,v2.1.0 \
  --base-url http://localhost:3000
```

## 命令参考

### `run` — 完整 Pipeline

```bash
npx e2e-test run \
  -p, --project <path>    # 被测项目路径 (git repo)
  -b, --base <ref>        # 基线版本 (commit/branch/tag)
  -t, --target <ref>      # 目标版本
  -u, --base-url <url>    # 被测应用 URL
  [--headed]              # 有头模式运行浏览器
  [-o, --output <dir>]    # 输出目录 (默认: test-output)
  [--pages <routes>]      # 手动指定页面路由 (逗号分隔)
```

### `diff` — 提取 Git Diff

```bash
npx e2e-test diff \
  -p, --project <path>
  -b, --base <ref>
  -t, --target <ref>
  [-o, --output <dir>]
```

输出：`test-output/diff/`（单项目: `files.json/raw.diff/commits.json`；多项目: `<project-name>/` 子目录 + `projects.json/summary.json`）

### `browse` — 浏览页面提取 DOM

```bash
npx e2e-test browse \
  -u, --base-url <url>
  --pages <routes>        # 逗号分隔，如 /,/login,/dashboard
  [--headed]
  [-o, --output <dir>]
```

输出：`test-output/pages/` (页面 DOM 快照 + 交互元素列表 + 截图)

### `execute` — 执行 Playwright 测试

```bash
npx e2e-test execute \
  -d, --test-dir <dir>    # 测试文件目录
  -u, --base-url <url>
  [--headed]
  [-o, --output <dir>]
```

### `report` — 生成变更报告

```bash
npx e2e-test report \
  [-r, --results <path>]    # 测试结果 JSON
  [-a, --analysis <path>]   # 影响分析 JSON
  [-o, --output <dir>]
  [--project <name>]
  [--base-ref <ref>] [--target-ref <ref>]
  [--base-url <url>]
```

输出：`test-output/reports/change-report.md` + `change-report.json`

### `analyze` — 输出 AI 分析提示

```bash
npx e2e-test analyze \
  [-d, --diff-dir <dir>]
  [-o, --output <dir>]
```

## 目录结构

```
e2e-auto-test/
├── src/
│   ├── cli/main.ts           # CLI 入口
│   ├── commands/
│   │   ├── diff.ts           # Git diff 提取
│   │   ├── browse.ts         # 页面 DOM 提取
│   │   ├── exec-tests.ts     # 测试执行
│   │   ├── report.ts         # 报告生成
│   │   └── pipeline.ts       # 全流程编排
│   ├── git/diff.ts           # Git 操作封装
│   ├── browser/
│   │   ├── manager.ts        # Playwright 浏览器管理
│   │   └── page-scraper.ts   # 页面 DOM 提取
│   ├── runner/executor.ts    # Playwright 测试执行器
│   ├── reporter/index.ts     # Markdown 报告生成
│   └── types/index.ts        # 核心类型定义
├── templates/report.hbs      # 报告模板
├── tests/examples/           # 示例测试用例
└── test-output/              # 运行时输出 (gitignore)
```

## 输出结构

```
test-output/
├── diff/                     # Step 1: Git diff
│   ├── files.json            # 变更文件列表
│   ├── raw.diff              # 原始 diff
│   └── commits.json          # commit 历史
├── analysis/                 # Step 2: AI 影响分析
│   └── impact.json
├── pages/                    # Step 3: 页面快照
│   ├── login.html / login.png
│   ├── softphone.html / softphone.png
│   └── pages.json
├── tests/                    # Step 4: 生成测试
│   └── *.spec.ts
├── results/                  # Step 5: 执行结果
│   └── results.json
└── reports/                  # Step 6: 最终报告
    ├── change-report.md
    └── change-report.json
```

## AI 协作模式

Steps 2 和 4 由 Claude Code 完成：

- **Step 2**：Claude Code 读取 `test-output/diff/`，分析变更文件，生成 `test-output/analysis/impact.json`
- **Step 4**：Claude Code 读取影响分析 + 页面 DOM（Step 3 提取），生成 Playwright 测试代码到 `test-output/tests/`

其余 Steps 均由 CLI 工具自动执行。

## 测试用例格式

生成的测试基于 Playwright Test：

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
    await expect(page.locator('button:has-text("监听")')).toBeVisible();
    await expect(page.locator('button:has-text("强插")')).toBeVisible();
    await expect(page.locator('button:has-text("耳语")')).toBeVisible();
  });
});
```
