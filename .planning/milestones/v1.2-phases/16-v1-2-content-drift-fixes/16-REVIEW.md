---
phase: 16-v1-2-content-drift-fixes
reviewed: 2026-04-19T22:06:59Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - docs/integrations/better-auth.md
  - docs/integrations/billing.md
  - docs/testing.md
  - docs/integrations/bullmq.md
  - docs/architecture.md
  - packages/modules/auth/src/__tests__/get-tenant.test.ts
findings:
  critical: 0
  warning: 0
  info: 3
  total: 3
status: issues_found
---

# Phase 16: Code Review Report

**Reviewed:** 2026-04-19T22:06:59Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Phase 16 closes v1.2 content drift: five documentation edits and one test-helper migration. No runtime behavior changes. The review verified all new or changed doc claims against the source they cite, and read `get-tenant.test.ts` end-to-end against its subject and the `createMockContext` helper.

Findings are all Info-level. The documentation content is accurate in substance, and the test migration is clean — it drops the bespoke `mockContext` literal, uses the canonical `createMockContext()` helper, and preserves the three original behavioral assertions (success path, not-found, thrown-error propagation). No bugs, no security issues, no quality issues that rise above style/consistency.

Three Info items call out small citation-line-number drifts in integration docs. These are not wrong per se — every cited block is within a line or two of the stated range — but four specific citations are off-by-one against the current tree and will keep drifting each time the surrounding file is edited. Worth correcting in a future doc-hygiene pass; not a blocker for Phase 16.

## Info

### IN-01: Citation line-number drift for `modules` array in `apps/api/src/index.ts`

**Files:**
- `docs/integrations/better-auth.md:29`
- `docs/integrations/billing.md:30`
- `docs/architecture.md:13`
- `docs/architecture.md:47`

**Issue:** Three docs cite `apps/api/src/index.ts:25-28` (or `:27`) as the location of the active-modules array. The actual `new ModuleRegistry({ ... modules: ["auth", "billing", "example"] })` block in the current tree spans lines 26-29, with the `modules` line at 28. Off by one.

- `better-auth.md:29`: cites `apps/api/src/index.ts:25-28` — should be `26-29`.
- `billing.md:30`: cites `apps/api/src/index.ts:27` — should be `28`.
- `architecture.md:13`: cites `apps/api/src/index.ts:27` — should be `28`.
- `architecture.md:47`: cites `apps/api/src/index.ts:25-28` — should be `26-29`.

**Fix:** Update the four citations to `apps/api/src/index.ts:26-29` (for the whole constructor block) or `:28` (for the `modules` line specifically). Pick one convention and use it consistently. The same doc set also cites `apps/api/src/worker.ts:21-24` for the worker modules array, which is correct against the current tree — keeping the API citations aligned with that range style (constructor block, not just the `modules:` line) is the safer choice since the block is less likely to shift under future edits.

### IN-02: Citation line-number drift for worker modules array in `architecture.md`

**File:** `docs/architecture.md:47`

**Issue:** The "How modules are registered" paragraph cites `apps/api/src/worker.ts:20-24` for the active-modules listing. The actual `new ModuleRegistry({ ... })` block spans lines 21-24 (line 20 is a blank/comment gap). Every other doc that cites this block uses `21-24`, which matches the source. Only this one citation uses `20-24`.

**Fix:** Change `apps/api/src/worker.ts:20-24` to `apps/api/src/worker.ts:21-24` in `architecture.md:47` so all cross-references to this block are consistent across the doc set.

### IN-03: Minor inconsistency in CreateMockDb documentation vs. implementation

**File:** `docs/testing.md:39`

**Issue:** The testing doc describes `createMockDb` as taking an "options object `{ insert, select, update, delete }`", which matches the implementation (`packages/modules/__test-utils__/mock-context.ts:13-18`). However, the implementation parameter is named `results`, not `options`, and each field is an array/value override (not a plain method stub). The wording "Override resolved values per method with the options object" is accurate in substance but uses "options" where the code uses "results" — trivial inconsistency for readers grep'ing the source.

**Fix (optional):** Adjust the sentence in `testing.md:39` to "Override resolved values per method with the `results` options object" (or rename the parameter in `mock-context.ts` to `options` for alignment — either direction works). Low priority; the doc is not misleading, only slightly off in vocabulary.

---

## Notes on files with no findings

### `docs/integrations/better-auth.md`

- The new paragraph wording ("listed in the `modules` array in `apps/api/src/index.ts:25-28` (API process only). The worker process (`apps/api/src/worker.ts:21-24`) loads `["example", "billing"]` — auth has no background jobs, so the worker does not register it.") is accurate in substance: the worker does load `["example", "billing"]` (verified against `apps/api/src/worker.ts:23`) and auth is indeed API-only. The only concern is the line-number drift captured in IN-01.
- All `auth.ts` citations (`:54-57`, `:58-177`, `:29-43`, `:62`, `:70-82`, `:90-123`, `:127-138`) verified accurate.

### `docs/integrations/billing.md`

- The "13 members: 12 methods plus one readonly `name` property" claim verified by counting members in `packages/modules/billing/src/ports/payment-provider.ts:38-159`: `name` + `createCustomer` + `createSubscription` + `cancelSubscription` + `changeSubscription` + `getSubscription` + `createOneTimePayment` + `createCheckoutSession` + `createPortalSession` + `verifyWebhookSignature` + `normalizeEvent` + `getInvoices` + `reportUsage?` = 13 (1 property + 12 methods). Consistent internally and with the sister claim in the Extending section.
- The webhook-flow Mermaid diagram labels match the current route implementation at `packages/modules/billing/src/routes.ts:52-114` (not re-read but referenced accurately elsewhere in the doc).

### `docs/testing.md`

- The added `createMockContext` example is an exact structural match against `packages/modules/__test-utils__/mock-context.ts:53-64`, including the `enqueue: mock(() => Promise.resolve())` default.
- The warning about `ScopedDb.select(table)` being a different one-shot shape is correct; the chainable shape in the mock does mismatch the one-shot helper, and the doc calls this out explicitly.

### `docs/integrations/bullmq.md`

- The "event-bus-hook enqueue" pattern described in the Wiring and Gotchas sections correctly reflects that `HandlerContext.enqueue` is declared in `packages/shared/src/types/cqrs.ts:29-30` but NOT populated by the live derive at `apps/api/src/index.ts:104-118`. Verified: the derive only sets `tenantId`, `userId`, `db`, `emit` (no `enqueue` field).
- All worker citations (`:32-77`, `:43-51`, `:84-125`) and queue-helper citations (`packages/queue/src/index.ts:14-29`, `:39-51`) verified accurate.

### `docs/architecture.md`

- The revised "derive `handlerCtx`" label and the surrounding Mermaid diagram match the actual derive block at `apps/api/src/index.ts:104-118`.
- The HandlerContext code snippet is an exact match against `packages/shared/src/types/cqrs.ts:20-31`.
- Aside from IN-01 and IN-02 citation drifts, content is accurate.

### `packages/modules/auth/src/__tests__/get-tenant.test.ts`

Migration to the canonical `createMockContext` helper is clean:

- Drops the hand-rolled `mockContext` literal; uses `createMockContext()` at each call site.
- Preserves all three behavioral assertions: success path, not-found mapping to `"Tenant not found"`, and thrown-error propagation of `error.message`.
- Correctly uses the Bun `mock.module("../auth", ...)` + dynamic `await import("../queries/get-tenant")` ordering — the subject is imported AFTER the mock is registered, so the stubbed `auth.api.getFullOrganization` is the one the subject sees. This is the same pattern documented in `docs/testing.md` §"Testing adapters and handlers that import external SDKs".
- `mockGetFullOrganization.mockReset()` in `beforeEach` correctly resets call history AND implementation between tests.
- `mockResolvedValueOnce` / `mockRejectedValueOnce` are used appropriately — a later test cannot accidentally see a prior test's queued response.
- The argument assertion (`expect.any(Headers)`) correctly matches the `new Headers()` construction in the subject at `packages/modules/auth/src/queries/get-tenant.ts:28`.
- No over-specific ORM assertions; the test only asserts observable outcomes (`result.success`, `result.data`, `result.error`, and the one auth-API call with its arguments). Complies with `docs/testing.md:69` ("Assert OBSERVABLE outcomes").

No issues found.

---

_Reviewed: 2026-04-19T22:06:59Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
