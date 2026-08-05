# E2E Change Impact Analysis

Analyze git diff data to identify affected frontend features and pages, then generate a structured impact analysis JSON.

## Input

Read from `test-output/diff/`:
- `projects.json` (multi-project) or `files.json` (single project)
- `raw.diff`
- `commits.json`
- `summary.json`

Also check `test-output/trace/trace.json` — if it exists, CodeGraph has pre-traced the dependency chains. **Code does bulk, you do quality**:

| Confidence | Source | Your role |
|-----------|--------|------------|
| `high` | SQL edges (imports/calls/references) — AST-level precision | **Validate**: confirm the chain is semantically correct. The SQL is rarely wrong, but verify the terminal detection (is it really a page, or just a component?) |
| `low` | Cross-language bridge (backend route → frontend string match) — may have false positives | **Audit critically**: check each low-confidence hop. Is the API path actually consumed by the claimed frontend file? Are there false matches? |

Each chain in trace.json provides:
- `sourceFile` — the changed file
- `symbols[]` — exported symbols (methods, classes, functions)
- `hops[]` — each hop with `{ file, relation, symbol, confidence, terminal, terminalReason }`
- `affectedPages[]` — terminal frontend pages

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

Classify every changed file using a **multi-dimensional** approach — path alone is unreliable because each project has its own naming conventions.

#### Step 1.1: Detect project type and structure

Read the project's build/config files to understand its technology stack and directory layout:

```
package.json    → Node.js project. Check "dependencies" for vue/react/next/nuxt → SPA frontend or fullstack
pom.xml         → Java/Maven. Check artifactId, parent POM, module names → backend service
build.gradle    → Java/Kotlin/Gradle
go.mod          → Go project
requirements.txt / setup.py → Python project
Cargo.toml      → Rust project
```

From these, infer the project's role:

| Signal | Inference |
|--------|-----------|
| `package.json` has `vue`/`react`/`@angular/core` + no server deps | Frontend SPA |
| `package.json` has `next`/`nuxt`/`express`/`fastify` + `react`/`vue` | Fullstack JS |
| `pom.xml` + `*-api`/`*-service` module names | Java microservice |
| `package.json` has only `express`/`koa`/`fastify` (no react/vue) | Backend API (Node) |
| Multiple top-level dirs with their own build files | Monorepo |

#### Step 1.2: Classify each file by extension + content

Use **file extension** as the primary signal, then verify with **file content**:

**Layer: Frontend — UI (core analysis)**

| Extension | Content signals |
|-----------|----------------|
| `.vue` | `<template>` + `<script>` → Vue SFC, core UI change |
| `.jsx`, `.tsx` | `import React`/`from 'react'` → React component. If exports JSX → UI. If only hooks/utils → Frontend logic |
| `.html` | `<div>`, `<form>`, `<button>` → template/page |
| `.css`, `.scss`, `.less` | Style rules → visual change, note but don't deep-analyze |

**Layer: Frontend — Logic (core analysis)**

| Extension | Content signals |
|-----------|----------------|
| `.js`, `.ts` (inside frontend module) | `import axios`/`fetch(` → API client. `export function`/`export const` → utility. `createRouter` → routing. `createStore`/`createPinia` → state management. `import { ref }`/`import { useState }` → composable/hook |

**Layer: Backend — API (cross-reference)**

| Extension | Content signals |
|-----------|----------------|
| `.java` | `@RestController`/`@Controller` → API endpoint. `@Service`/`@Component` → business logic. `@Repository`/`@Entity` → data layer. `interface` → contract/API surface |
| `.go` | `func (s *Server) handle`/`http.HandleFunc` → HTTP handler. `func (s *Service)` → business logic |
| `.py` | `@app.route`/`@router.get` → API endpoint. `def test_` → test |
| `.kt` | `@RestController`/`fun` in controller package → API |

**Layer: Config/Infra (skip unless changed)**

| Extension | Content signals | Action |
|-----------|----------------|--------|
| `.xml`, `.yaml`, `.yml`, `.properties`, `.env` | DB connection strings, ports → infrastructure. Security rules → flag. Feature flags → note |
| `Dockerfile`, `docker-compose*.yml` | Container config → skip |
| `.json` (config) | `package.json`, `tsconfig.json` → skip. `.eslintrc` → skip |

**Layer: Docs/Tools/Assets (skip)**

| Signal | Action |
|--------|--------|
| `.md`, `.txt`, `LICENSE` | Skip |
| `.png`, `.svg`, `.ico`, `.jpg` | Note new asset, skip deep analysis |
| Path contains `test/`/`tests/`/`__tests__`/`spec/` | Skip |
| `.agents/`, `.claude/`, `.github/`, CI configs | Skip |
| `.xsd`, grammar files, schema definitions | Skip |
| Lock files (`package-lock.json`, `yarn.lock`, `go.sum`) | Skip |

#### Step 1.3: Associate backend API changes with frontend pages

When backend API files change, search the frontend code for API calls to the same endpoint paths:

```
Backend: @PostMapping("/api/user/login")  in UserController.java
  → Search frontend .js/.ts/.vue files for: "/api/user/login" or "user/login"
  → Found in frontend/src/api/auth.js: post('/user/login', ...)
  → This API is consumed by: Login.vue
```

This gives you cross-project impact when both frontend and backend diffs are provided.

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
