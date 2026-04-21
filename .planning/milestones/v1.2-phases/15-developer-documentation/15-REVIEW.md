---
phase: 15
phase_name: developer-documentation
reviewed: 2026-04-17
depth: standard
status: issues_found
files_reviewed: 18
findings:
  critical: 0
  warning: 4
  info: 7
  total: 11
---

# Phase 15: Code Review Report

**Reviewed:** 2026-04-17
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Phase 15 ships nine markdown documents (getting-started, architecture, add-a-module, configuration, testing, four integration docs, plus README) backed by the `packages/modules/example` source and its three test files, plus a small addition to `apps/api/src/index.ts`. The code is small, clean, and well-tested: ~76 lines of tests across three files exercise the command, the event-bus hook (with mocked Redis), and the job handler, including happy-path, graceful-skip-when-`REDIS_URL`-absent, and error-path branches.

The docs are thorough, well-structured, consistent in tone, and cite source code liberally — exactly the stated strategy. Most line-number citations spot-checked resolve correctly. However, one important inconsistency propagates across `bullmq.md` and `architecture.md`: both documents describe `ctx.enqueue(...)` as the primary way to dispatch jobs from a command handler, but the codebase contains zero usages of `ctx.enqueue` in any module. The actual pattern — event-bus hooks (`registerExampleHooks`, `registerBillingHooks`) — is correctly described in `add-a-module.md` Step 6 and `configuration.md`, but the contradicting guidance in `bullmq.md` Step 4 and `architecture.md`'s CQRS sequence diagram will mis-teach new module authors. Two additional code citations in `add-a-module.md` are factually wrong (a non-existent symbol and a wrong URL path). No security issues, no leaked secrets (all env examples use placeholder prefixes as promised), no runtime bugs in the TypeScript.

## Critical Issues

_None._

## Warnings

### WR-01: bullmq.md and architecture.md promote `ctx.enqueue`, which is not wired in the codebase

**Files:**
- `docs/integrations/bullmq.md:78` (sequence diagram)
- `docs/integrations/bullmq.md:99` (Gotchas bullet)
- `docs/integrations/bullmq.md:120` (Extending Step 4)
- `docs/architecture.md:71` (CQRS sequence diagram)

**Issue:** Both documents instruct readers to enqueue jobs from command handlers via `await ctx.enqueue?.("yourmodule:action", payload)`. `HandlerContext.enqueue` is declared as an optional field in `packages/shared/src/types/cqrs.ts:30`, but it is never populated anywhere in the repo:
- The derive in `apps/api/src/index.ts:104-118` only builds `{ tenantId, userId, db, emit }` — no `enqueue`.
- Grepping `packages/modules/**/*.ts` for `ctx.enqueue` returns zero hits.
- Both existing hook patterns (`packages/modules/billing/src/hooks/on-tenant-created.ts`, `packages/modules/example/src/hooks/on-example-created.ts`) subscribe to domain events and call `queue.add` on a lazily initialized BullMQ queue — never `ctx.enqueue`.

This directly contradicts `add-a-module.md:40`, which states: "Jobs are dispatched separately through a hook file (see Step 6) rather than through an `enqueue` parameter on the context." A new module author following `bullmq.md` Step 4 will write code that silently no-ops (optional chaining swallows the undefined) and wonder why the worker never fires.

**Fix:** Rewrite `bullmq.md` §"Extending" Step 4 and the §"Gotchas" bullet to describe the event-bus hook pattern instead, citing `packages/modules/example/src/hooks/on-example-created.ts::registerExampleHooks` as the canonical reference. Either remove the `ctx.enqueue` arrow in `architecture.md`'s CQRS sequence diagram, or replace it with an event-bus hook step (`Cmd->>EB: ctx.emit("example.created", payload)` already exists one line above; the `Cmd->>Q: ctx.enqueue(...)` line can be deleted or relabeled as a separate `Hook->>Q: queue.add(...)` lane). If `HandlerContext.enqueue` is aspirational (declared in anticipation of a future wire-up), add a one-line note in `architecture.md` §"HandlerContext" stating that `enqueue` is an unwired placeholder today and modules must use event-bus hooks.

### WR-02: add-a-module.md cites a non-existent symbol `scoped-db.ts::injectTenantId`

**File:** `docs/add-a-module.md:25`

**Issue:** The tutorial states: "The scoped database in `packages/db/src/helpers/scoped-db.ts::injectTenantId` auto-injects `tenant_id` on insert...". Grepping `packages/db/src/helpers/scoped-db.ts` for `injectTenantId` returns zero hits. The injection happens inline inside the `scopedDb(...)` factory's `insert` method at `scoped-db.ts:46+`.

**Fix:** Drop the `::injectTenantId` anchor and cite the enclosing function:
```markdown
The scoped database in `packages/db/src/helpers/scoped-db.ts::scopedDb` auto-injects `tenant_id` on insert and auto-applies `WHERE tenant_id = ?` on select, update, and delete.
```

### WR-03: add-a-module.md Step 10 smoke-test URL is wrong for modules copied from the example

**File:** `docs/add-a-module.md:150`

**Issue:** Step 10 shows:
```bash
bun api
# then: curl -X POST http://localhost:3000/api/{your-module} ...
```
But `packages/modules/example/src/routes.ts:12` uses `new Elysia({ prefix: "/examples" })` (no `/api` prefix), and `getModuleRoutes()` in `apps/api/src/core/registry.ts:151-169` does not add one either. The example module's routes resolve at `http://localhost:3000/examples`, not `/api/examples`. A user who copies the example and then runs the documented curl will hit 404. The billing module happens to use `prefix: "/api/billing"` because it opts into that convention itself.

**Fix:** Either (a) pick a convention explicitly — recommend `prefix: "/api/{module}"` in Step 8 and update the example module's `routes.ts` to match, or (b) match the tutorial to the example's actual prefix:
```bash
bun api
# then: curl -X POST http://localhost:3000/{your-module-plural} ...
```
Option (a) is the cleaner long-term fix because `/api/*` is already the convention for billing, admin, and auth.

### WR-04: configuration.md "module loading" arrays drift by a line

**File:** `docs/configuration.md:69`

**Issue:** The doc states `apps/api/src/index.ts:25-28` declares the module array for the API role. In the actual file, lines 25-28 are the first four lines of the `new ModuleRegistry({...})` call — line 27 is `role: env.INSTANCE_ROLE as "api" | "worker" | "all",` and the `modules:` array is on line 28 alone. The multi-line range 26-29 would be the tightest fit for "the ModuleRegistry config block". Same issue on `architecture.md:13` (cites `apps/api/src/index.ts:27` for "modules array" — line 27 is actually `role:`).

**Fix:** Change both references to `apps/api/src/index.ts:26-29` (or cite `apps/api/src/index.ts::ModuleRegistry constructor arguments` for drift resistance). Update `architecture.md:13`'s inline parenthetical from `:27` to `:28` (the `modules:` line) or drop the line number entirely since the prose already says "the `modules: []` array".

## Info

### IN-01: architecture.md HandlerContext snippet strips JSDoc comments without disclosure

**File:** `docs/architecture.md:80-89`

**Issue:** The snippet header is `// From packages/shared/src/types/cqrs.ts:20-31`, but the actual lines 20-31 contain JSDoc comments between every field. The doc's version has been cleaned up to remove the JSDoc. Per the README code-citation rule ("Inline short snippets verbatim ≤ 10 lines"), the visible version is not verbatim.

**Fix:** Either copy the actual lines 20-31 including the JSDoc (would exceed ~12 lines; acceptable since the README already allows an exception for canonical composition snippets), or widen the cited range to show just the `interface` declaration (lines 20 + 26-31) and label it "Essential fields of HandlerContext — see `cqrs.ts:20-31` for JSDoc field descriptions".

### IN-02: `process-followup.ts` handler contradicts its own documented security guideline

**File:** `packages/modules/example/src/jobs/process-followup.ts:17-18`

**Issue:** The handler does `const payload = data as { exampleId: string; tenantId: string };` with no runtime validation. Both `add-a-module.md:158-159` (Security checklist) and `docs/integrations/bullmq.md:125` state: "Job payloads cross the app ↔ Redis trust boundary. Validate the payload shape at the top of the handler. Never trust that a job retrieved from Redis has the shape your TypeScript types claim." Because this file is literally the referenced example, a careful reader comparing doc to code will notice the demo handler doesn't follow its own advice. The JSDoc comment notes the minimalism is intentional ("log-only demo per Phase 15 RESEARCH Open Question 1"), but the security lesson is lost.

**Fix:** Add a minimal TypeBox or inline check at the top of the handler and a one-line comment pointing at the security pattern:
```ts
export async function processFollowup(data: unknown): Promise<void> {
  // Validate payload shape at the trust boundary (see bullmq.md §Security)
  if (
    typeof data !== "object" || data === null ||
    typeof (data as any).exampleId !== "string" ||
    typeof (data as any).tenantId !== "string"
  ) {
    throw new Error("processFollowup: invalid payload shape");
  }
  const payload = data as { exampleId: string; tenantId: string };
  // ...
}
```
Alternatively, add a paragraph to the handler's JSDoc block acknowledging that a real handler would validate at this seam and pointing the reader to the docs.

### IN-03: `on-example-created.ts` catches errors on the `getFollowupQueue()` path too broadly

**File:** `packages/modules/example/src/hooks/on-example-created.ts:56-73`

**Issue:** The try/catch wraps both `getFollowupQueue()` and `queue.add(...)`. Errors from the lazy-create path (e.g., a malformed `env.REDIS_URL`) get swallowed with the same `[example] Failed to enqueue process-followup` message, which is misleading since no enqueue was attempted. Minor — the hook's best-effort contract is preserved — but operators debugging will see the wrong error frame.

**Fix:** Narrow the try to the enqueue call only, and let `getFollowupQueue()` throw up-front for misconfiguration:
```ts
const queue = getFollowupQueue();
if (!queue) { /* graceful-skip log, return */ }
try {
  await queue.add("example:process-followup", { exampleId: id, tenantId });
} catch (err) {
  console.error(`[example] Failed to enqueue process-followup for ${id}:`, err);
}
```

### IN-04: `on-example-created.test.ts` uses `unknown` in the event-bus stub type while production uses `any`

**File:** `packages/modules/example/src/__tests__/on-example-created.test.ts:51-52`

**Issue:** `eventBus.on(...)` is typed as `(event: string, handler: (data: unknown) => Promise<void>) => void` in the test stub, but `registerExampleHooks` declares the parameter as `handler: (data: any) => Promise<void>` (`on-example-created.ts:51`). Minor type-safety drift — `any` is the laxer type and hides potential issues. The production signature should match the test signature.

**Fix:** Change `on-example-created.ts:51` from:
```ts
on: (event: string, handler: (data: any) => Promise<void>) => void;
```
to:
```ts
on: (event: string, handler: (data: unknown) => Promise<void>) => void;
```
The test and the handler body already treat `data` as `unknown` (both use `data as ExampleCreatedEvent`), so the change is purely type tightening with no runtime impact.

### IN-05: `package.json` of `@baseworks/module-example` declares `drizzle-orm` but doesn't import it

**File:** `packages/modules/example/package.json:15`

**Issue:** `drizzle-orm` is listed as a direct dependency but no file under `packages/modules/example/src/` imports from it directly — all DB types transit through `@baseworks/db`. If the intent is hygiene ("modules may need Drizzle types in schema helpers"), keep it. If not, drop it to keep the starter-module package.json minimal and make the tutorial's "Step 1: Copy the example module" produce a cleaner starting point.

**Fix:** If the tutorial recommends copying this package as a template, either remove the unused `drizzle-orm` dependency or add a concrete usage (e.g., `import { eq } from "drizzle-orm"` inside a query) so users copying the template don't inherit an unused dep.

### IN-06: README.md §Tone hyphenates forbidden filler words

**File:** `docs/README.md:28`

**Issue:** The line uses hyphenated spellings of the forbidden filler words to avoid matching the verify-docs regex. GitHub renders them verbatim, which looks slightly unusual. A reader grepping for "basically" in docs will not find these, so the hyphenation does not enforce anything at the lint layer; it just changes how the words render.

**Fix:** Either un-hyphenate (the words are already in an allowlist by virtue of being the subject of the rule), or leave as is if the hyphenation is an intentional visual signal. Non-blocking polish.

### IN-07: `getting-started.md` and `testing.md` both imply `bun test` auto-finds all tests without a config — verify across platforms

**Files:**
- `docs/getting-started.md:80-83`
- `docs/testing.md:7-9`

**Issue:** Both docs say `bun test` auto-discovers every `*.test.ts` across the monorepo with "no configuration file required". The Phase 14 test count (126) is cited. The root `package.json` has no `test` script, so users must remember the `bun test` invocation. Worth a one-line CI check to keep the docs honest as the tree grows. Non-blocking.

**Fix:** Add `test: "bun test"` to the root `package.json` scripts for discoverability and consistency with `bun api`, `bun worker`, `bun db:migrate`. Mentioned only as a minor polish.

---

## Files Reviewed

- `apps/api/src/index.ts`
- `docs/README.md`
- `docs/add-a-module.md`
- `docs/architecture.md`
- `docs/configuration.md`
- `docs/getting-started.md`
- `docs/integrations/better-auth.md`
- `docs/integrations/billing.md`
- `docs/integrations/bullmq.md`
- `docs/integrations/email.md`
- `docs/testing.md`
- `packages/modules/example/package.json`
- `packages/modules/example/src/__tests__/create-example.test.ts`
- `packages/modules/example/src/__tests__/on-example-created.test.ts`
- `packages/modules/example/src/__tests__/process-followup.test.ts`
- `packages/modules/example/src/hooks/on-example-created.ts`
- `packages/modules/example/src/index.ts`
- `packages/modules/example/src/jobs/process-followup.ts`

## Findings Summary

- Critical: 0
- Warning: 4
- Info: 7
- Total: 11
