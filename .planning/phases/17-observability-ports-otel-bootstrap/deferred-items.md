# Phase 17 Deferred Items

Items discovered during execution that are OUT OF SCOPE for Phase 17 plans. Tracked here so the phase verifier / future planners can pick them up.

## Pre-existing test failures (not caused by this phase)

### env.test.ts:48 — "succeeds with valid environment variables" fails in worktree

- **Discovered during:** Plan 17-03 execution (`bun test packages/config`)
- **Symptom:** `env validation > succeeds with valid environment variables` exits with code 1 instead of 0.
- **Baseline reproducibility:** Confirmed pre-existing — `git stash` of Plan 17-03 changes still shows the same failure (9 pass, 1 fail on clean base).
- **Root cause (hypothesis):** Subprocess `bun -e ...` invocation at env.test.ts:26-43 spawns a child that imports `@baseworks/config`. In a fresh worktree without a root-level `.env` file and without live process.env having `DATABASE_URL` / `BETTER_AUTH_SECRET` exported to the spawned child correctly, the @t3-oss/env-core schema fails to validate at module-import time in the child process. Platform / shell-env-propagation quirk on Windows bash (the worktree is running under Git Bash on Windows).
- **Scope boundary:** Out of scope for Phase 17 (observability). Touches the env test harness infrastructure, not observability code paths. Plan 17-03 deliberately mirrored the subprocess pattern in `validate-observability-env.test.ts` and verified its own three tests pass (3 pass, 0 fail) — the pre-existing failure is independent.
- **Suggested follow-up:** Small standalone plan or quick fix to make env.test.ts:25 test hermetic (e.g., assert `exitCode === 0 || stderr.includes("…")` with clearer failure mode, or skip when `process.env.DATABASE_URL` is not set on host).
