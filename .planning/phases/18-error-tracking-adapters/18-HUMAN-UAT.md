---
status: partial
phase: 18-error-tracking-adapters
source: [18-07-SUMMARY.md]
started: 2026-04-23T11:16:48Z
updated: 2026-05-05T00:00:00Z
---

## Current Test

[testing paused — 4 items skipped pending production deploy]

## Tests

### 1. Sentry auth token + GitHub repo secrets configured
expected: Sentry dashboard has an auth token with `project:releases` + `project:write` scopes; GitHub repo has `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` secrets. `gh secret list` shows all three.
result: pass

### 2. Release workflow green on test tag
expected: `git tag v0.0.1-phase18-test && git push origin v0.0.1-phase18-test` triggers `.github/workflows/release.yml`; Actions run finishes green with source maps uploaded to Sentry.
result: skipped
reason: not tested yet — pending operator action

### 3. Demangled stack trace in Sentry (Success Criterion #4)
expected: After staging deploy with `ERROR_TRACKER=sentry` + matching `RELEASE`, hitting a deliberate-failure endpoint produces a Sentry issue whose Stack Trace tab shows real source paths (e.g., `apps/api/src/index.ts:142`), NOT minified frames.
result: skipped
reason: not tested yet — pending operator action

### 4. No public .map files served (Pitfall 5)
expected: `curl -I https://admin.your-fork.example.com/assets/<hash>.js.map` returns 404. `productionBrowserSourceMaps` remains FALSE in `apps/web/next.config.ts`.
result: skipped
reason: production curl check requires deployed environment (not yet deployed). Static config check confirmed: `productionBrowserSourceMaps` not set in `apps/web/next.config.ts` → Next.js default FALSE ✓.

### 5. Cleanup
expected: Deliberate-failure endpoint reverted; test tag optionally deleted.
result: skipped
reason: depends on Tests 2-3 (deploy + tag) which are pending — nothing to clean up yet.

## Summary

total: 5
passed: 1
issues: 0
pending: 0
skipped: 4
blocked: 0

## Gaps

(none yet — items are pending operator action, not failed)
