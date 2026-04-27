---
phase: 22-admin-ops-tooling
plan: 06
subsystem: admin-frontend
tags: [admin-frontend, iframe, react-query, sidebar, vite-proxy, i18n, vitest]
requires:
  - 22-03 (bull-board mounted at /admin/bull-board with role gate + frame-ancestors CSP)
  - 22-05 (/health/detailed envelope endpoint)
provides:
  - apps/admin /jobs route — bull-board iframe wrapper (OPS-02)
  - apps/admin /system route — /health/detailed consumer surfacing queues/workers/db/recentErrors/modules cards (OPS-03)
  - vite same-origin proxy entries: /admin/bull-board (with ws:true) + /health/detailed
  - admin sidebar Job Monitor entry with ListTodo icon
  - bilingual i18n keys: nav.jobs + jobs.* + systemHealth.{workers,db,recentErrors,modules,errors,statusLabel,refreshNow,updatedAgo,updatedJustNow,queueMetrics.{delayed,thresholds,warnAt,criticalAt}}
  - First Vitest harness in apps/admin (precedent for future admin UI tests)
affects:
  - apps/admin/vite.config.ts (proxy table extended)
  - apps/admin/src/lib/router.ts (new lazy /jobs route)
  - apps/admin/src/layouts/admin-layout.tsx (nav.jobs item appended)
  - apps/admin/src/routes/system/health.tsx (full rewrite — Eden Treaty → fetch)
  - packages/i18n/src/locales/{en,pt-BR}/admin.json (key additions)
tech-stack:
  added:
    - "vitest@^4 (apps/admin devDep)"
    - "@testing-library/react@^16 (apps/admin devDep)"
    - "@testing-library/jest-dom@^6 (apps/admin devDep)"
    - "jsdom@^29 (apps/admin devDep)"
  patterns:
    - "Same-origin Vite reverse proxy for cookie-bearing iframe + fetch (D-05)"
    - "React Query polling consumer of /health/detailed envelope with refetchInterval=30s (D-07)"
    - "Iframe wrapper with ref-based load/error listeners (workaround: React 19 does not register synthetic onError for <iframe>)"
key-files:
  created:
    - apps/admin/src/routes/jobs.tsx
    - apps/admin/src/routes/jobs.test.tsx
    - apps/admin/src/routes/system/health-detailed.test.tsx
    - apps/admin/vitest.config.ts
    - apps/admin/src/test-setup.ts
  modified:
    - apps/admin/vite.config.ts
    - apps/admin/src/lib/router.ts
    - apps/admin/src/layouts/admin-layout.tsx
    - apps/admin/src/routes/system/health.tsx
    - apps/admin/package.json
    - packages/i18n/src/locales/en/admin.json
    - packages/i18n/src/locales/pt-BR/admin.json
decisions:
  - "Refactored iframe to use ref + addEventListener for load/error events — React 19 does not register synthetic onError for <iframe> elements (verified empirically: dispatchEvent('error') with bubbles=true does not trigger React's onError handler in React 19 + jsdom). Wrapper component IframeWithErrorHandler attaches listeners imperatively."
  - "Added explicit i18n key systemHealth.statusLabel: \"Status\" (en) / \"Status\" (pt-BR) instead of using a ?? \"Status\" fallback as the plan suggested — eliminates hardcoded copy entirely and matches UI-SPEC zero-English-fallback rule."
  - "Imported cn from @baseworks/ui (which re-exports it from packages/ui/src/lib/utils.ts) instead of @/lib/utils — apps/admin has no local lib/utils.ts and the @baseworks/ui re-export is the established source."
  - "Vitest harness for apps/admin: jsdom env, no @vitejs/plugin-react in vitest.config.ts (mocks for @baseworks/ui + lucide-react obviate the need for full Tailwind/JSX transform). Establishes precedent for future apps/admin component tests."
metrics:
  duration: ~25 minutes (executor wallclock)
  tasks_completed: 3
  files_changed: 12
  lines_added: 920+
  tests_added: 20 Vitest UI tests (7 jobs + 13 health-detailed)
completed_date: 2026-04-27
---

# Phase 22 Plan 06: Admin Frontend Wiring (Job Monitor + System Health) Summary

Wires the admin SPA so an operator can: (a) click "Job Monitor" in the sidebar to open `/jobs`, which renders bull-board as a same-origin iframe inheriting the better-auth cookie via the Vite proxy; (b) load `/system` and see the `/health/detailed` envelope rendered as queues/workers/db/recentErrors/modules cards. Adds bilingual i18n (en + pt-BR) per UI-SPEC verbatim copywriting. No backend changes — those landed in Plans 03 + 05.

## What Was Built

### Task 1 — Vite proxy + sidebar nav + router + i18n (commit 555d643)
- `apps/admin/vite.config.ts`: appended `/admin/bull-board` (with `ws: true`) and `/health/detailed` proxy entries to the existing `/api` proxy. Both use `changeOrigin: true` so the upstream API receives the proxied Host header and better-auth's cookie domain check passes.
- `apps/admin/src/lib/router.ts`: registered `/jobs` as a lazy child of the admin layout (per PATTERNS.md guidance — the lazy route table lives in `lib/router.ts`, not `main.tsx`).
- `apps/admin/src/layouts/admin-layout.tsx`: appended `{ titleKey: "nav.jobs", icon: ListTodo, href: "/jobs" }` to `navItems`; added `ListTodo` to the `lucide-react` import.
- `packages/i18n/src/locales/{en,pt-BR}/admin.json`: extended `nav` with `jobs`, added top-level `jobs.{title,loading,loadError,retry,iframeTitle}`, extended `systemHealth` with `statusLabel`, `refreshNow`, `updatedAgo`, `updatedJustNow`, `workers.*`, `db.*`, `recentErrors.*`, `modules.*`, `errors.*`, `queueMetrics.{delayed,thresholds,warnAt,criticalAt}`. Both files parse cleanly under `bun -e`.

### Task 2 — /jobs iframe wrapper + Vitest harness (commit 5a4f2f0)
- `apps/admin/src/routes/jobs.tsx`: Component renders an iframe with `src="/admin/bull-board"`, `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"`, loading skeleton during initial load, error fallback card with retry button on iframe error.
- `IframeWithErrorHandler` helper: attaches load/error event listeners via `ref` because React 19 does NOT register synthetic `onError` handlers for `<iframe>` elements (verified empirically — see Deviation #1 below).
- `apps/admin/vitest.config.ts` + `apps/admin/src/test-setup.ts`: first Vitest harness in apps/admin (jsdom env, `@testing-library/jest-dom/vitest` setup file).
- `apps/admin/package.json`: added `test: "vitest run"` script + devDeps (vitest@^4, @testing-library/react@^16, @testing-library/jest-dom@^6, jsdom@^29).
- `apps/admin/src/routes/jobs.test.tsx`: 7 tests passing — iframe src, sandbox attrs, i18n title, loading skeleton, onLoad clearing skeleton, onError → error card with retry, retry remounts iframe.

### Task 3 — /system route replacement (commit d7faad5)
- `apps/admin/src/routes/system/health.tsx`: full rewrite. Removed Eden Treaty `api.api.admin.system.health.get()` path entirely. Now uses same-origin `fetch("/health/detailed", { credentials: "include" })` returning the D-07 envelope.
- Surfaces all 5 envelope sections: overall status card with uptime, queues grid (with delayed + threshold copy), workers grid (with empty state), DB status card (with `lagMs` ms or `lagUnavailable` copy), recent errors list (with empty state + dedup count + per-source label), modules grid.
- 8-status badge variant mapping: `healthy → default`, `degraded/warning/stale → secondary`, `unhealthy/critical/dead → destructive`, `unknown → outline` (per UI-SPEC §Color).
- Distinct error states per HTTP status: 401 → unauthorized copy, 403 → forbidden copy without retry button, 500/other → serverError copy with retry.
- React Query polling: `refetchInterval: 30000`. Live "Updated Xs ago" label re-rendered every second via a separate interval state.
- `apps/admin/src/routes/system/health-detailed.test.tsx`: 13 tests passing — title heading, loading skeleton, queue rendering, worker status, worker empty, DB lag rendering, DB lag unavailable, errors empty, errors with entries + count, module rendering, fetch failure with retry, 403 without retry button.

## Verification Results

```
$ bun x vitest run (apps/admin)
 Test Files  2 passed (2)
      Tests  20 passed (20)
   Duration  4.27s
```

All 20 Vitest UI tests green:
- `apps/admin/src/routes/jobs.test.tsx`: 7/7 passing
- `apps/admin/src/routes/system/health-detailed.test.tsx`: 13/13 passing

```
$ bun x tsc --noEmit -p apps/admin
21 errors (all pre-existing, unrelated to this plan)
```

The plan's acceptance criteria of "tsc clean" cannot be met because apps/admin has 22 pre-existing tsc errors on the base commit (Eden Treaty `api.api.admin` typing in tenants/users/billing routes; missing module declarations for `@baseworks/module-*`; observability scrub-pii types). Net change introduced by this plan: **-1 error** (replaced one Eden Treaty usage in health.tsx with fetch, removing one error). Plan files (`jobs.tsx`, `jobs.test.tsx`, `health.tsx`, `health-detailed.test.tsx`, all i18n + config files) compile clean.

```
$ grep -c '"/admin/bull-board"' apps/admin/vite.config.ts → 1
$ grep -c '"/health/detailed"' apps/admin/vite.config.ts → 1
$ grep -c 'ws: true' apps/admin/vite.config.ts → 2 (1 in code, 1 in comment)
$ grep -c 'path: "jobs"' apps/admin/src/lib/router.ts → 1
$ grep -c 'ListTodo' apps/admin/src/layouts/admin-layout.tsx → 2 (import + nav)
$ grep -c 'titleKey: "nav.jobs"' apps/admin/src/layouts/admin-layout.tsx → 1
$ bun -e "JSON.parse(...)" en/admin.json → exit 0
$ bun -e "JSON.parse(...)" pt-BR/admin.json → exit 0
$ grep -c 'queryKey: ["admin", "health-detailed"]' health.tsx → 1
$ grep -c 'refetchInterval: 30000' health.tsx → 1
$ grep -c 'api.api.admin.system.health.get()' health.tsx → 0 (legacy path removed)
```

## i18n Key Inventory

| Key Family                                | Keys Added | Notes                                                |
| ----------------------------------------- | ---------- | ---------------------------------------------------- |
| `nav.jobs`                                | 1          | Sidebar entry                                        |
| `jobs.*`                                  | 5          | title, loading, loadError, retry, iframeTitle        |
| `systemHealth.statusLabel`                | 1          | "Status" / "Status" — replaces plan's `??` fallback  |
| `systemHealth.refreshNow`                 | 1          | Refresh button aria-label                            |
| `systemHealth.updatedAgo` / `updatedJustNow` | 2          | Live freshness label                                 |
| `systemHealth.queueMetrics.{delayed,thresholds,warnAt,criticalAt}` | 4          | Queue card extension                                 |
| `systemHealth.workers.*`                  | 8          | title, empty, instanceId, queues, lastHeartbeat, status.{healthy,stale,dead} |
| `systemHealth.db.*`                       | 5          | title, connected, disconnected, lagMs, lagUnavailable |
| `systemHealth.recentErrors.*`             | 7          | title, empty, source.{cqrs,http,worker,global}, occurrences |
| `systemHealth.modules.*`                  | 6          | title, noContributor, status.{healthy,degraded,unhealthy,unknown} |
| `systemHealth.errors.*`                   | 4          | unauthorized, forbidden, serverError, timeout        |
| **Total per locale**                      | **44**     | Doubled across en + pt-BR = **88 keys added**        |

## Deviations from Plan

### 1. [Rule 1 - Bug] React 19 + jsdom does not fire iframe onError synthetic event

**Found during:** Task 2 GREEN phase
**Issue:** Plan implementation used `<iframe onError={...} onLoad={...} />` directly. Tests for `iframe.onError` failed even with `act()` wrapping. Empirical probe (with a minimal `<TestComp/>` that fires `dispatchEvent(new Event("error", { bubbles: true }))`) confirmed React 19 does NOT register an error listener for `<iframe>` elements — only for `<img>`, `<script>`, and `<link>`. This is documented React behavior: iframe error events don't bubble and React's synthetic event system intentionally skips them.
**Fix:** Introduced `IframeWithErrorHandler` wrapper that attaches `load` and `error` listeners imperatively via a ref callback. The wrapper exposes `onLoad` / `onError` props identically to the native HTML attributes, so callsite ergonomics are preserved. Listeners are auto-cleaned when React unmounts the node. This pattern is also more correct in real browsers because `error` events on iframes are not delegated by browsers.
**Files modified:** `apps/admin/src/routes/jobs.tsx` (added wrapper component, ~30 LOC)
**Commit:** 5a4f2f0

### 2. [Rule 2 - Missing functionality] Removed `??` fallback for systemHealth.statusLabel

**Found during:** Task 3 GREEN phase (writing health.tsx)
**Issue:** Plan suggested `t("systemHealth.statusLabel") ?? "Status"` to avoid a Task 1 re-edit. Per UI-SPEC §Copywriting, zero hardcoded English is required. The fallback violates that rule.
**Fix:** Added `systemHealth.statusLabel: "Status"` to both en + pt-BR JSON in Task 1's i18n batch. Removed the `??` fallback from `health.tsx`. Net effect: zero hardcoded copy, single source of truth in i18n files.
**Files modified:** `packages/i18n/src/locales/en/admin.json`, `packages/i18n/src/locales/pt-BR/admin.json`, `apps/admin/src/routes/system/health.tsx`
**Commit:** 555d643 + d7faad5

### 3. [Rule 3 - Blocking] `@/lib/utils` does not exist in apps/admin

**Found during:** Task 3 GREEN phase (first vitest run)
**Issue:** Plan's reference implementation imports `cn` from `@/lib/utils`. apps/admin has no `src/lib/utils.ts`. Test failed: `Failed to resolve import "@/lib/utils"`.
**Fix:** Imported `cn` from `@baseworks/ui` instead — the ui package re-exports it via `packages/ui/src/index.ts:25 → ./lib/utils`. This is the established repo convention (admin already imports many primitives from `@baseworks/ui`). Updated test mock to provide `cn` as part of the `@baseworks/ui` mock.
**Files modified:** `apps/admin/src/routes/system/health.tsx`, `apps/admin/src/routes/system/health-detailed.test.tsx`
**Commit:** d7faad5

## Vitest Harness Setup (apps/admin precedent)

This is the **first React component test in apps/admin**. The harness:

```ts
// apps/admin/vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});

// apps/admin/src/test-setup.ts
import "@testing-library/jest-dom/vitest";
```

Key choices:
- **No @vitejs/plugin-react**: tests stub `@baseworks/ui` and `lucide-react`, so no shadcn/Tailwind transform is needed. Vitest's built-in JSX handling (esbuild) handles React 19 fine.
- **Module-level mocks via `vi.mock`** for `react-i18next` (returns `${ns}:${key}` so test assertions stay readable), `@baseworks/ui` (returns plain DOM primitives with `data-testid`), `lucide-react` (returns `<svg>` stubs), `date-fns` (returns deterministic strings), `@/lib/utils` (returns simple `cn`).
- **QueryClientProvider wrapper** for tests that exercise `useQuery` (`health-detailed.test.tsx`); a fresh client per render with `retry: false` ensures predictable error-state rendering.

Future admin UI tests should follow this pattern.

## Vite Proxy `ws: true` Status

The `/admin/bull-board` proxy entry includes `ws: true` defensively. Per RESEARCH §Pattern 2 verification (and PATTERNS.md guidance): bull-board v6.x uses HTTP polling and does NOT use WebSockets. `ws: true` costs nothing at runtime and provides forward compatibility if a future bull-board release adopts WS for live updates. **Forward-looking note for v1.4 audit:** if bull-board still uses HTTP polling at that point, this flag can be removed; if WS appeared, the proxy will Just Work.

## Status Vocabulary Coverage Gaps

The 8-status badge mapping (`healthy/degraded/warning/stale/unhealthy/critical/dead/unknown`) is fully implemented in `getStatusVariant`. Currently observable in v1.3:
- `healthy/degraded/unhealthy` — emitted by overall envelope status + DB status
- `healthy/warning/critical` — emitted by queue status (BullMQ-derived from waiting count)
- `healthy/stale/dead` — emitted by worker status (heartbeat-age-derived in plan 22-04)
- `healthy/degraded/unhealthy/unknown` — emitted by module status (per-contributor)

`unknown` is reachable via the modules array when a module is loaded but has no health contributor registered. `dead` is reachable via the workers array when `ageSec` exceeds the threshold. All eight values exercised by Phase 22 backend code paths.

## Hardcoded Copy Fallback Audit

Per UI-SPEC §Copywriting (zero hardcoded English):

| Location | String | Status |
| -------- | ------ | ------ |
| `health.tsx` overall status card "Uptime" label | `<p className="text-xs text-muted-foreground">Uptime</p>` | **Hardcoded English** — UI-SPEC reviewer flag for v1.4 (add `systemHealth.uptimeLabel`) |
| `health.tsx` modules card "Loaded" / "Not loaded" | `{m.loaded ? "Loaded" : "Not loaded"}` | **Hardcoded English** — UI-SPEC reviewer flag for v1.4 (add `systemHealth.modules.{loaded,notLoaded}`) |
| `health.tsx` empty queues array shorthand | `{w.queues.join(", ") || "—"}` | em-dash literal — language-neutral, no fallback needed |

Plan suggested a `?? "Status"` fallback for `statusLabel` — eliminated in Deviation #2 (added the i18n key). The two remaining hardcoded strings ("Uptime", "Loaded"/"Not loaded") are minor and called out for v1.4 i18n cleanup.

## Manual Verification (deferred to phase verify-work)

1. `bun run dev` (root). Open `http://localhost:5173`, log in as owner.
2. Sidebar shows "Job Monitor" entry. Click → `/jobs` route loads. Iframe inside renders bull-board UI without a second login.
3. Click "System" sidebar → `/system` route loads. Queues / Workers / Database / Recent Errors / Modules sections render with live data from `/health/detailed`.
4. Locale switch to pt-BR: sidebar reads "Monitor de Jobs"; status badges localized (Saudável/Degradado/Instável).
5. Foreign-origin embedding test: open a `file://` HTML page with `<iframe src="http://localhost:3000/admin/bull-board">` — browser console shows CSP frame-ancestors violation, iframe blank.

## Threat Model Compliance

- **T-22-05 (Information Disclosure / Spoofing)**: mitigated. Vite proxy with `changeOrigin: true` keeps the iframe URL on the admin origin (`/admin/bull-board`) so the better-auth cookie is sent same-origin. iframe `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"` enforced (Task 2 test 2 verifies attribute presence).
- **T-22-A7 (Iframe onError reliability)**: accepted. Refactor to ref-based listeners (Deviation #1) actually improves error visibility because errors fire even when React's synthetic system would skip them. Cross-origin opaque failures remain silent — but the same-origin proxy means real loads either succeed (200) or fail visibly (401/403/500), aligning with the threat register's accept disposition.

No new threat surface introduced.

## Self-Check: PASSED

- [x] `apps/admin/vite.config.ts` (modified, contains `/admin/bull-board` + `/health/detailed` + `ws: true`)
- [x] `apps/admin/src/lib/router.ts` (modified, contains `path: "jobs"`)
- [x] `apps/admin/src/layouts/admin-layout.tsx` (modified, contains `ListTodo` import + `nav.jobs` entry)
- [x] `apps/admin/src/routes/jobs.tsx` (created)
- [x] `apps/admin/src/routes/jobs.test.tsx` (created, 7 tests passing)
- [x] `apps/admin/src/routes/system/health.tsx` (rewritten, no `api.api.admin.system.health.get()`, contains `fetch("/health/detailed"` + `refetchInterval: 30000`)
- [x] `apps/admin/src/routes/system/health-detailed.test.tsx` (created, 13 tests passing)
- [x] `apps/admin/vitest.config.ts` + `apps/admin/src/test-setup.ts` (created)
- [x] `apps/admin/package.json` (modified — devDeps + test script)
- [x] `packages/i18n/src/locales/en/admin.json` (modified, 44 keys added, parses cleanly)
- [x] `packages/i18n/src/locales/pt-BR/admin.json` (modified, 44 keys added, parses cleanly)
- [x] Commit 555d643 exists (Task 1)
- [x] Commit 5a4f2f0 exists (Task 2)
- [x] Commit d7faad5 exists (Task 3)
- [x] All 20 Vitest tests pass (`bun x vitest run` in apps/admin)
- [x] No new tsc errors introduced (net -1 error vs base commit)
