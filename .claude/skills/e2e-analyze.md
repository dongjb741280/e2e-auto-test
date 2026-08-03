# E2E Change Impact Analysis

Analyze git diff data to identify affected frontend features and pages, then generate a structured impact analysis JSON.

## Input

Read from `test-output/diff/`:
- `projects.json` (multi-project) or `files.json` (single project)
- `raw.diff`
- `commits.json`
- `summary.json`

## Output

Write to `test-output/analysis/impact.json` with this structure:

```json
{
  "summary": "one-sentence summary of overall changes",
  "affectedPages": [
    {
      "route": "/login",
      "name": "User login page",
      "changeType": "modified",
      "changeDescription": "Added email field validation with error messages",
      "impactedFiles": ["src/pages/Login.tsx", "src/utils/validate.ts"],
      "testScenarios": [
        {
          "name": "Empty email shows validation error",
          "priority": "P0",
          "steps": ["Navigate to /login", "Leave email empty", "Click submit"],
          "expectedResult": "Error message 'Email is required' appears"
        }
      ]
    }
  ],
  "riskLevel": "low|medium|high",
  "recommendation": "Actions before deploy (testing, monitoring, rollback plan)"
}
```

## Analysis Method

Follow these four stages:

### Stage 1: File Classification

Classify every changed file by path prefix:

| Path prefix | Category | Action |
|-------------|----------|--------|
| `frontend/src/views/` | Frontend page | Core analysis |
| `frontend/src/layout/` | Frontend layout | Core analysis |
| `frontend/src/components/` | Frontend component | Core analysis |
| `frontend/src/api/` | Frontend API layer | Core analysis |
| `frontend/src/utils/` | Frontend utility | Core analysis |
| `frontend/src/router/` | Frontend routing | Core analysis |
| `frontend/public/` | Static assets | Note if new |
| `src/main/java/.../controller/` | Backend API | Cross-reference |
| `src/main/java/.../service/` | Backend logic | Cross-reference |
| `*.xml`, `*.properties`, `*.yaml` | Config | Skip unless security |
| `*.md`, `.gitignore`, CI files | Docs/config | Skip |
| `tests/`, `*.test.*`, `*.spec.*` | Tests | Skip |
| Agent skills, scripts, schemas | Tools | Skip |

### Stage 2: Code Change Understanding

Read the unified diff structurally, not line-by-line:

1. **Template/view layer**: Look for `@@ ... @@` hunk headers to locate changed regions. Identify:
   - New/deleted DOM elements (new cards, buttons, inputs, dialogs)
   - Changed attributes (placeholders, labels, disabled states)
   - New/deleted imports (components, utilities)

2. **Script layer**: Focus on import changes and new function definitions:
   - New imports → new dependencies or refactored modules
   - Deleted imports → removed features
   - New function/event handlers → new user interactions
   - Changed function signatures → API contract changes

3. **Build each observation into an inference table**:

| What changed | What it means |
|-------------|---------------|
| New button "监听" added | New feature: call monitoring |
| `import CallSdk` added, `loadVoice9Sdk` removed | SDK refactored from dynamic to ES module |
| `fsHost` input removed | No longer configures FS address manually |

### Stage 3: Feature Impact Derivation

Cross-reference commit messages with file changes:

1. For each commit, match its files to the commit message
2. Group related files into feature-level changes
3. Determine the affected page route from the file path:
   - `frontend/src/views/Login.vue` → route `/login`
   - `frontend/src/views/call/IvrReport.vue` → route `/call/ivr-report`
   - `frontend/src/layout/Index.vue` → route `/layout` (affects all pages)

4. Assign `changeType`:
   - `new` — file status is "added"
   - `removed` — file status is "deleted"
   - `modified` — file status is "modified"

5. Assess `riskLevel`:
   - `high` — SDK/API contract changes, auth flow changes, data model changes
   - `medium` — new features, UI refactoring, bug fixes in core pages
   - `low` — style-only changes, minor text updates, config changes

### Stage 4: Test Scenario Generation

For each affected page, generate test scenarios following priority rules:

**P0** — Core functionality:
- New feature's primary interaction path
- Critical bug fix verification
- SDK/API integration points

**P1** — Boundary conditions:
- Disabled state verification (buttons disabled when not connected)
- Form validation (empty fields, format errors, mismatch errors)
- Error state display

**P2** — Visual/UX details:
- Logo/image replacement
- Layout/styling changes
- Table column width adjustments

**Scenario template**:
```
name: "What the user should see or do"
steps: ["Step 1", "Step 2", "Step 3"]
expectedResult: "Specific expected outcome"
```

## Multi-Project Mode

When `projects.json` exists (frontend + backend both changed):

1. Analyze each project separately first
2. Cross-reference: backend API changes → which frontend pages call those endpoints?
3. Frontend component changes → which backend endpoints are affected?
4. Mark cross-project dependencies in `changeDescription`
5. Note breaking changes: backend API contract changes that frontend depends on
6. The `recommendation` should mention deployment order if needed
