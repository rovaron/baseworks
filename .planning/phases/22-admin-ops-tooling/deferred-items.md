# Phase 22 — Deferred Items

Pre-existing tsc errors observed during plan 22-01 execution. NOT introduced by Plan 22-01 changes; out-of-scope per executor rule "SCOPE BOUNDARY".

## Pre-existing tsc errors at repo root (`bun x tsc --noEmit`)

- `apps/api/src/core/middleware/__tests__/observability.test.ts` — Elysia generic-inference TS2345 errors (15+ instances)
- `packages/modules/billing/src/__tests__/stripe-adapter.test.ts(316-317)` — TS2532 / TS2493 array index errors
- `packages/modules/billing/src/jobs/send-email.ts:15` — TS2503 missing JSX namespace
- `packages/modules/billing/src/templates/*.tsx` — TS2875 missing `react/jsx-runtime` types (welcome, password-reset, billing-notification, team-invite)
- `packages/queue/src/__tests__/queue.test.ts(133-...)` — TS18048 / TS2339 BullMQ KeepJobs type errors
- `packages/ui/src/components/switch.tsx:2` — TS2307 `@radix-ui/react-switch` types missing

Per-package tsc:
- `bun x tsc --noEmit -p packages/observability` — exits 0
- `bun x tsc --noEmit -p packages/shared` — exits 0
- `bun x tsc --noEmit -p packages/config` — exits 0

These predate Plan 22-01 (verified by examining git history — files unchanged by this plan). Address in a future cleanup plan.
