# E2E Test Generator

Generate Playwright test code from impact analysis and page DOM snapshots. Each affected page gets a `.spec.ts` file with test scenarios mapped to real selectors.

## Input

Read from `test-output/`:
- `analysis/impact.json` — affected pages with test scenarios
- `trace/trace.json` — CodeGraph dependency chains (if available, prioritize these pages)
- `pages/pages.json` — DOM snapshots with interactive elements and selectors
- `pages/*.html` — full DOM for selector verification
- `pages/*.png` — screenshots for visual reference

## Output

Write to `test-output/tests/`:
- `<page-name>.spec.ts` — one file per affected page
- Naming: `page-route.spec.ts` where route `/login` → `login.spec.ts`, `/call/ivr-report` → `call-ivr-report.spec.ts`

## Generation Method

### Step 1: Map pages to DOM data

For each `affectedPage` in impact.json, find its corresponding page snapshot:

```typescript
// impact.json:  { route: "/login", name: "登录页", testScenarios: [...] }
// pages.json:   { route: "/login", interactiveElements: [...], screenshot: "..." }
```

If a page has no DOM snapshot (e.g., needs auth), note it as "cannot generate — page requires login" and skip.

### Step 2: Match scenarios to selectors

For each test scenario, identify which interactive elements are involved and pick the best selector:

```
Scenario: "输入用户名和密码后点击登录"
  → Input:  username → find element with placeholder="用户名" → selector: input[placeholder="用户名"]
  → Input:  password → find element with placeholder="密码" → selector: input[placeholder="密码"]
  → Button: submit   → find button with text "登 录"       → selector: button:has-text("登 录")
```

**Selector priority** (highest to lowest):

| Rank | Selector type | Example | When to use |
|------|--------------|---------|-------------|
| 1 | `data-testid` | `[data-testid="login-button"]` | Always if available |
| 2 | `placeholder` | `input[placeholder="用户名"]` | Form inputs |
| 3 | `getByRole` exact | `page.getByRole('button', { name: '登录', exact: true })` | Buttons with unique text |
| 4 | `getByRole` partial | `page.getByRole('button', { name: '登录' })` | Buttons when text is unique enough |
| 5 | `has-text` | `button:has-text("登 录")` | Fallback when text is unique |
| 6 | `:text-is` avoided | N/A | Never use — not a valid Playwright selector |

**Important rules**:
- Never use `button:text-is(...)` — it's not a valid Playwright pseudo-selector
- When text could match multiple elements (e.g., "咨询" vs "咨询转"), use `getByRole('button', { name: '咨询', exact: true })`
- When a scenario involves login, include a `beforeEach` that fills username/password and clicks the login button
- Use the actual selectors found in the DOM snapshot, never guess

### Step 3: Generate the test file

Template:

```typescript
import { test, expect } from '@playwright/test';

test.describe('<page name> — <feature description>', () => {

  test.beforeEach(async ({ page }) => {
    // Login if needed
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[placeholder="用户名"]', 'admin');
    await page.fill('input[placeholder="密码"]', '12345678');
    await page.click('button:has-text("登 录")');
    await page.waitForTimeout(2000);
    await page.goto('<page-route>');
    await page.waitForLoadState('networkidle');
  });

  test('<scenario name>', async ({ page }) => {
    // Arrange: navigate / set up state
    // Act: perform the user actions
    // Assert: verify the expected result
  });
});
```

### Step 4: Write each test case

For each scenario in the impacted page, generate a test case:

```
Scenario: "班长监控卡片包含目标坐席输入和三个监控按钮"
  Priority: P0
  Steps: [查看班长监控卡片, 检查输入框和按钮]
  Expected: "显示目标坐席输入框+监听/强插/耳语三个按钮"

  → Generated code:
  test('班长监控卡片包含目标坐席输入和三个监控按钮', async ({ page }) => {
    await expect(page.locator('input[placeholder="目标坐席"]')).toBeVisible();
    await expect(page.getByRole('button', { name: '监听' })).toBeVisible();
    await expect(page.getByRole('button', { name: '强插' })).toBeVisible();
    await expect(page.getByRole('button', { name: '耳语' })).toBeVisible();
  });
```

**Patterns for common scenario types**:

**Visibility check** (element should be visible):
```typescript
await expect(page.locator('<selector>')).toBeVisible();
```

**Disabled state check** (button should be disabled before connect):
```typescript
await expect(page.getByRole('button', { name: '<name>', exact: true })).toBeDisabled();
```

**Text content check** (message log shows expected text):
```typescript
await expect(page.locator('text=<expected text>')).toBeVisible();
```

**Negative check** (old element should NOT be present):
```typescript
await expect(page.locator('text=<old text>')).not.toBeVisible();
```

**Form fill + submit**:
```typescript
await page.fill('input[placeholder="<placeholder>"]', '<value>');
await page.click('button:has-text("<button text>")');
```

**Input value check**:
```typescript
await expect(page.locator('input[placeholder="<placeholder>"]')).toHaveValue('<expected>');
```

**Navigation check**:
```typescript
await expect(page).toHaveURL(/<expected-path>/);
```

**Count check** (e.g., three cards present):
```typescript
const cards = page.locator('.card-header');
await expect(cards).toHaveCount(3);
```

### Step 5: Group by page and write files

1. Group scenarios by page route
2. For each page, create one `.spec.ts` file
3. If a page has >5 scenarios, split into multiple describe blocks by feature area
4. Name the file from the route: `/login` → `login.spec.ts`, `/softphone` → `softphone.spec.ts`

### Step 6: Generate a test index

Write `test-output/tests/index.json` summarizing what was generated:

```json
{
  "generatedAt": "2026-08-04T12:00:00Z",
  "files": [
    {
      "file": "login.spec.ts",
      "page": "/login",
      "scenarios": 3,
      "priorities": { "P0": 0, "P1": 0, "P2": 3 }
    },
    {
      "file": "softphone-ui.spec.ts",
      "page": "/softphone",
      "scenarios": 10,
      "priorities": { "P0": 2, "P1": 6, "P2": 2 }
    }
  ],
  "totalScenarios": 17,
  "totalFiles": 3
}
```

## Pages Without DOM Snapshots

When a page has scenarios in impact.json but no DOM snapshot (e.g., requires login to access):

1. Mark as `skipReason: "no DOM data — page requires authentication"`
2. Generate placeholder test that navigates to login, fills credentials, then navigates to the target page
3. Use generic selectors from the scenario descriptions (less reliable, mark with `// FIXME: selector needs manual verification`)

## Multi-Project Mode

When pages.json shows pages from different project contexts:
- Prefer the pages/ DOM data for selector generation (real, verified)
- Fall back to impact.json scenario descriptions for pages without DOM data
- Add a comment at the top of each generated file: `// Generated from: frontend/ (DOM verified) + backend/ (API trace)`

## After Generation

Print a summary:

```
Generated 3 test files with 17 scenarios:
  test-output/tests/login.spec.ts          (3 scenarios)
  test-output/tests/softphone-ui.spec.ts    (10 scenarios)
  test-output/tests/softphone-monitor.spec.ts (4 scenarios)

Next: e2e-test run --resume -u <base-url>
```
