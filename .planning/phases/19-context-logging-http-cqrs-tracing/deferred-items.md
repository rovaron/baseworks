# Phase 19 — Deferred Items

Out-of-scope issues discovered during plan 19-01 execution:

- `packages/observability/src/wrappers/__tests__/wrap-cqrs-bus.test.ts` — the "wrapCqrsBus — barrel export" test (lines 134-141) fails in isolation because importing the full `../../index` barrel transitively imports `scrub-pii.ts` which imports `@baseworks/config` whose t3-env validator throws when DATABASE_URL / BETTER_AUTH_SECRET are unset at test time. This is a PRE-EXISTING failure (not introduced by 19-01) and affects any test that dynamically imports the observability barrel outside a properly-mocked env. The new 19-01 `context.test.ts` barrel re-export test works around this with `mock.module("@baseworks/config", ...)`. Suggested fix in a future plan: add the same mock.module stub to `wrap-cqrs-bus.test.ts:135` (one-line edit). Core 7 A5-invariant tests pass.
