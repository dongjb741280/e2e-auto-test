# E2E Impact Trace

Given a single modified file, trace the dependency chain to find all frontend pages that are affected.

**Division of labor**:
- `src/codegraph/tracer.ts` handles **bulk scanning** in Pipeline Step 1.5 — SQL queries, high-confidence edges, batch processing
- This skill (`/e2e-trace`) is for **manual deep-dive** — when you need to understand WHY a specific chain exists, validate terminal detection, or trace when CodeGraph is unavailable

**Prefer CodeGraph** when `.codegraph/codegraph.db` exists — it provides AST-level precise relationships. Fall back to grep only when CodeGraph is unavailable.

## Input

- **Changed file path** (relative to project root), e.g. `src/main/java/com/example/service/OrderService.java`
- **Project root** (default: cwd)
- **Max depth** (default: 5, prevents infinite loops)
- **CodeGraph DB path** (auto-detected: `<project>/.codegraph/codegraph.db`)

## CodeGraph-First Tracing

When `.codegraph/codegraph.db` exists, use SQL queries for all dependency lookups. The database schema provides precise AST-level edges.

### Step 1: Identify symbols in the changed file

```sql
SELECT id, kind, name, qualified_name, signature, start_line
FROM nodes
WHERE file_path = '<changed-file-path>'
  AND kind NOT IN ('file', 'import')
ORDER BY start_line;
```

### Step 2: Find direct dependents (files that import/call/reference this file's symbols)

```sql
-- Files that import/call/reference ANY symbol in the changed file
SELECT DISTINCT
    n2.file_path AS dependent_file,
    e.kind AS relationship,
    n2.kind AS target_kind,
    n2.name AS target_name
FROM edges e
JOIN nodes n1 ON e.target = n1.id       -- n1 = symbol in the changed file
JOIN nodes n2 ON e.source = n2.id       -- n2 = symbol that depends on it
WHERE n1.file_path = '<changed-file-path>'
  AND e.kind IN ('imports', 'calls', 'references', 'instantiates', 'extends', 'implements')
  AND n2.file_path != '<changed-file-path>'
  AND n2.file_path NOT LIKE '.agents/%'
ORDER BY n2.file_path;
```

### Step 3: Classify dependent file role

```sql
-- Check file language and node kinds within it
SELECT DISTINCT f.language, n.kind
FROM files f
JOIN nodes n ON n.file_path = f.path
WHERE f.path = '<dependent-file>';
```

Classification from query results:

| Language | Contains node kind | Role | Terminal? |
|----------|-------------------|------|-----------|
| vue | `component` | Frontend page/component | If in `views/` or `pages/` dir → terminal |
| vue | `component` in `components/` | Reusable component | Recurse |
| java | `route` (has `@RequestMapping`) | Backend controller | Recurse to find frontend API consumers |
| java | `class`/`interface` (no route) | Backend service/repo | Recurse to controllers |
| javascript/typescript | `function`/`class` in `api/` | Frontend API client | Recurse |
| javascript/typescript | `function` in `utils/` | Utility | Usually stop |
| javascript/typescript | `class` in `stores/` | State management | Recurse |

### Step 4: Recurse

For each non-terminal dependent, repeat Step 1-3 with the dependent's file path. Maintain a `visited` set. Stop at terminals or max depth.

### Full trace SQL (for common patterns)

**Backend → API consumers** (find frontend files calling a specific API path):

```sql
-- Given a route path like '/api/order', find frontend files referencing it
SELECT DISTINCT n.file_path
FROM nodes n
WHERE n.file_path LIKE 'frontend/%'
  AND n.file_path NOT LIKE '%/node_modules/%'
  AND (
    n.name LIKE '%/api/order%'
    OR n.qualified_name LIKE '%/api/order%'
    OR n.signature LIKE '%/api/order%'
  );
```

**Component → Pages** (find pages that import a given component):

```sql
-- Given a component file, find pages that import it
SELECT DISTINCT n2.file_path
FROM edges e
JOIN nodes n1 ON e.target = n1.id
JOIN nodes n2 ON e.source = n2.id
WHERE n1.file_path = '<component-file>'
  AND e.kind = 'imports'
  AND n2.file_path LIKE 'frontend/src/views/%';
```

## Grep-Based Tracing (fallback)

Use only when no CodeGraph database exists.

## Output

A dependency trace tree in JSON at `test-output/trace/trace.json`:

```json
{
  "sourceFile": "src/main/java/com/example/service/OrderService.java",
  "fileType": "backend-service",
  "summary": "OrderService → OrderController → frontend/api/order.ts → pages/OrderList.vue, pages/OrderDetail.vue",
  "chains": [
    {
      "path": "src/main/java/.../OrderService.java",
      "role": "business logic",
      "exported": ["createOrder", "cancelOrder", "getOrderList"],
      "importedBy": [
        {
          "path": "src/main/java/.../OrderController.java",
          "role": "REST controller",
          "exported": ["POST /api/orders", "DELETE /api/orders/{id}", "GET /api/orders"],
          "importedBy": [
            {
              "path": "frontend/src/api/order.ts",
              "role": "API client",
              "exported": ["createOrder()", "cancelOrder()", "fetchOrders()"],
              "importedBy": [
                {
                  "path": "frontend/src/pages/OrderList.vue",
                  "role": "frontend page (terminal)",
                  "importedBy": []
                },
                {
                  "path": "frontend/src/pages/OrderDetail.vue",
                  "role": "frontend page (terminal)",
                  "importedBy": []
                }
              ]
            }
          ]
        }
      ]
    }
  ],
  "affectedPages": [
    { "route": "/orders", "file": "frontend/src/pages/OrderList.vue" },
    { "route": "/orders/:id", "file": "frontend/src/pages/OrderDetail.vue" }
  ]
}
```

## Tracing Method

### Step 1: Identify what the file exports

Read the changed file and extract its public symbols:

**Backend files (.java, .go, .py)**:

| Language | Extract |
|----------|---------|
| Java | Class name, public methods, `@RequestMapping`/`@PostMapping`/`@GetMapping` paths |
| Go | Exported functions (capitalized), `http.HandleFunc`/`mux.HandleFunc` route patterns |
| Python | `def` functions (non-`_`-prefixed), `@app.route`/`@router.get` decorators |
| Kotlin | Class name, `fun` methods, `@RequestMapping` paths |

**Frontend files (.js, .ts, .jsx, .tsx)**:

| Type | Extract |
|------|---------|
| Module | `export default`, `export function`, `export const`, `export class` |
| API client | URL patterns in `fetch()`, `axios.get()`, `this.$http` |
| Vue composable | `export function use*` |
| React hook | `export function use*` |

**Frontend pages (.vue, .jsx, .tsx in pages/routes)**:

These are terminals — stop tracing here. Note the page's route (from file path or router config).

### Step 2: Search for direct dependents

Find every file that imports or calls something from the source file:

**Search patterns by language**:

```
Java:    import com.example.service.OrderService  (class import)
         orderService.createOrder(               (Spring injection)
         @Autowired OrderService                 (field injection)

Go:      import "example.com/service"            (package import)
         service.CreateOrder(                    (usage)

Python:  from service.order import OrderService  (module import)
         order_service.create_order()            (usage)

JS/TS:   import { createOrder } from '@/api/order'  (named import)
         import OrderService from '@/api/order'      (default import)
         require('./service/order')                  (CommonJS)
         const orderApi = useOrderApi()              (composable usage)

Vue:     import OrderList from '@/components/OrderList.vue'  (component import)
         <OrderList />                                    (template usage)
         import { useOrderStore } from '@/stores/order'   (store usage)
```

**How to search** (use grep or code search):

1. Get the **file basename** (without extension): `OrderService` from `OrderService.java`
2. Get the **import path segments**: `com/example/service` from package declaration
3. Search for:
   - Exact filename: `grep -r "OrderService" --include="*.java" --include="*.kt" src/`
   - Import patterns: `grep -r "import.*OrderService" src/`
   - Frontend references: `grep -r "OrderService\|/api/order" --include="*.vue" --include="*.ts" --include="*.js" frontend/`

### Step 3: Classify each dependent's role

| Role | Signal | Terminal? | Action |
|------|--------|-----------|--------|
| **Frontend page** | File in pages/routes/views dir, contains `<template>` or JSX page layout, matches route path | ✅ Stop | Add to affectedPages |
| **Frontend component** | `.vue`/`.tsx` that imports pages, `components/` dir | ❌ | Recurse |
| **Frontend modal/dialog** | `.vue` with `el-dialog`/`Modal`, imported by pages | ❌ | Recurse 1 more level |
| **Frontend composable/hook** | `use*()` export, `composables/` dir | ❌ | Recurse |
| **Frontend API client** | Has `fetch()`/`axios()`/`this.$http` calls | ❌ | Recurse (usually imported by pages directly) |
| **Frontend store** | Pinia/Vuex/Redux/Zustand store | ❌ | Recurse |
| **Backend controller** | `@RestController`/`@Controller`, `func.*Handle` | ❌ | Recurse to find API consumers |
| **Backend service** | `@Service`, business logic | ❌ | Recurse to controllers |
| **Backend repository** | `@Repository`, `JpaRepository`, DB queries | ✅ Usually stop | Note data model change |
| **Config/utility** | Constants, config, plain utilities | ✅ Usually stop | Note if public API changed |

### Step 4: Recurse until terminals

For each non-terminal dependent, repeat Step 1-3. Maintain a `visited` set to prevent cycles.

```
visited = Set()

function trace(file, depth):
    if file in visited or depth > maxDepth: return
    visited.add(file)
    exports = extractExports(file)
    dependents = searchDependents(file, exports)
    for dep in dependents:
        if isTerminal(dep):
            affectedPages.add(dep)
        else:
            trace(dep, depth + 1)
```

### Step 5: Infer page routes

For frontend page terminals, infer their route:

1. Read the **router config** (`router/index.ts`, `router/index.js`, `routes.ts`): find the route path that matches the page component file.
2. If no router file, infer from **file path**: `pages/order/detail.vue` → `/order/detail`.
3. For React: check for `<Route path="/orders" component={OrderList} />`.

## Multi-Project Mode

When `projects.json` exists in the diff directory (frontend + backend repos):

1. The changed file's project determines whether to **forward-trace** or **cross-trace**:
   - **Backend file** → trace through the backend chain to the API endpoint, then search the frontend repo for API consumers of that endpoint.
   - **Frontend file** → trace only within the frontend repo (components → composables → pages).
2. Use the API path as the bridge: `@PostMapping("/api/orders")` → search frontend for `"/api/orders"`.

## Quick-Trace Mode

For fast impact assessment without full depth tracing:

1. Identify the file type and role
2. Search for direct imports only (1 level)
3. For backend: search frontend for matching API path strings
4. Return immediate dependents — enough for a quick "what might break" answer

Use when: the user asks "what does this file affect?" and wants a quick answer, not an exhaustive trace.
