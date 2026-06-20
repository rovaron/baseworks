---
created: 2026-04-26T15:35:00.000Z
title: Fix billing getSubscriptionStatus TypeError on getTableColumns
area: api
files:
  - packages/modules/billing/src/queries/get-subscription-status.ts
  - packages/modules/billing/src/schema.ts
  - packages/db/src/schema/billing.ts
  - packages/db/src/helpers/scoped-db.ts
---

## Problem

`GET /api/billing/subscription` (authenticated, valid tenant) returns HTTP 500 with the following error:

```
TypeError: undefined is not an object (evaluating 'table[Table.Symbol.Columns]')
  at getTableColumns (drizzle-orm/utils.js:109:10)
  at from (drizzle-orm/pg-core/query-builders/select.js:62:16)
  at select (packages/db/src/helpers/scoped-db.ts:49:26)
  at <anonymous> (packages/modules/billing/src/queries/get-subscription-status.ts:28:8)
  at <anonymous> (packages/shared/src/types/cqrs.ts:119:12)
  at <anonymous> (packages/modules/billing/src/routes.ts:195:26)
```

Discovered 2026-04-26 during v1.3 milestone observability UAT — the broken endpoint was repurposed (and still useful) as the trigger for Phase 18 SC-1/SC-3 error capture, where it captured cleanly through both Pino and Sentry adapters. So this is unrelated to observability — the observability layer is correctly handling a real underlying bug.

## Diagnosis hypothesis

The error message `undefined is not an object (evaluating 'table[Table.Symbol.Columns]')` means drizzle's `getTableColumns(table)` was called with `table === undefined`. Two possible root causes:

**Hypothesis A: `billingCustomers` import is undefined at call time**
- `packages/modules/billing/src/schema.ts` re-exports `billingCustomers` from `@baseworks/db`
- `packages/db/src/schema/billing.ts:25` defines `billingCustomers = pgTable("billing_customers", {...})`
- If there's a circular import or workspace-resolution timing issue, the re-exported binding could resolve to `undefined` at the moment `from(billingCustomers)` runs — which would trigger this exact error.
- Worth: console.log(typeof billingCustomers) at the top of get-subscription-status.ts to confirm.

**Hypothesis B: scoped-db wrapper is breaking table reference**
- `packages/db/src/helpers/scoped-db.ts:49` wraps drizzle's select. If `scopedDb(db, tenantId)` returns a Proxy that mishandles passing `billingCustomers` to `.from()`, the table arg could become undefined inside drizzle's internals.
- Less likely given scoped-db works for other queries — but worth a check.

**Hypothesis C: Schema/DB column mismatch (related to migration journal todo)**
- DB tables still have the old `stripe_*` column names (migration 0001 never applied — see `2026-04-26-repair-drizzle-migration-journal-inconsistency.md`).
- Drizzle code uses `providerSubscriptionId: text("provider_subscription_id")`.
- A SQL error from the column mismatch would not produce *this exact* TypeError shape (we'd see a postgres error about missing column), so this is probably not the direct cause — but fixing the migration may make the query succeed cleanly.

Most likely: A. The error shape strongly suggests `billingCustomers === undefined` at execution time.

## Solution

TBD — investigation steps in priority order:

1. Add a sanity-check log at the top of get-subscription-status.ts: `console.log("billingCustomers loaded:", typeof billingCustomers, !!billingCustomers)`. If it logs `undefined` or `false`, hypothesis A confirmed → fix the workspace import resolution (likely a `tsconfig.json` paths / `package.json` exports issue triggered only at runtime under a specific module-load order).

2. If hypothesis A confirmed, candidate fixes:
   - Switch the re-export in `packages/modules/billing/src/schema.ts` from named-re-export to a deferred-binding pattern (export a getter or import inline at the call site).
   - Verify `packages/db` exports `billingCustomers` from its barrel (`packages/db/src/index.ts`) and that no two paths resolve to different module instances.

3. If hypothesis B: trace what `scopedDb` does to the table reference — set a breakpoint or log.

4. After fix, the same query should return 200 OK with `{ status: "inactive", hasSubscription: false, ... }` for a freshly-registered tenant with no billing record.

5. Adding a regression test (apps/api/__tests__/billing-subscription.test.ts) that boots the API, registers a user + org, hits the endpoint with the session cookie, and asserts 200 + the expected response shape — would prevent regression.

## Related

- `2026-04-26-repair-drizzle-migration-journal-inconsistency.md` — applying migration 0001 may cause column-mismatch errors instead of this TypeError, depending on root cause.
- This todo discovered while running v1.3 milestone observability UAT — see `.planning/phases/18-error-tracking-adapters/18-HUMAN-UAT.md` and `.planning/phases/19-context-logging-http-cqrs-tracing/19-UAT.md`.

---

## Closure (2026-04-26 — Phase 20.1)

Closed in Phase 20.1 Plan 02 (billing-typeerror). D-07 hypothesis EXCLUDED by D-05 probe; actual root cause was 7 ctx.db handlers misusing `scopedDb.select()`. User-authorized Option A applied across all 7 sites. API regression test `apps/api/__tests__/billing-subscription.test.ts` boots a fresh tenant and asserts HTTP 200 + `{ status: "inactive", hasSubscription: false, ... }` body shape. SC#2 closed. See `.planning/phases/20.1-close-v13-milestone-gaps/20.1-02-SUMMARY.md`.
