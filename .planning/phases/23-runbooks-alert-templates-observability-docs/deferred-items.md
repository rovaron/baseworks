
## Plan 23-05 — out-of-scope tsc errors observed (not introduced by this plan)

Confirmed via `git stash && bunx tsc --noEmit` that these existed before the docs/README.md edit. Out of scope for Phase 23 (docs-only). Track for v1.4 docs-quality / cleanup phase:

- `packages/modules/billing/src/jobs/send-email.ts:15` — TS2503 "Cannot find namespace 'JSX'"
- `packages/modules/billing/src/templates/*.tsx` (4 files) — TS2875 "react/jsx-runtime"
- `packages/queue/src/__tests__/queue.test.ts:133..154` — TS18048 / TS2339 around `queue.opts.defaultJobOptions`

These are workspace TS-config / test-types issues, not blockers for the runbooks/alerts/docs-index work.
