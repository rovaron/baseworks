---
status: partial
phase: 18-error-tracking-adapters
source: [18-07-SUMMARY.md]
started: 2026-04-23T11:16:48Z
updated: 2026-04-23T11:16:48Z
---

## Current Test

[awaiting operator — deferred by user during execute-phase]

## Tests

### 1. Sentry auth token + GitHub repo secrets configured
expected: Sentry dashboard has an auth token with `project:releases` + `project:write` scopes; GitHub repo has `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` secrets. `gh secret list` shows all three.
result: [pending]

### 2. Release workflow green on test tag
expected: `git tag v0.0.1-phase18-test && git push origin v0.0.1-phase18-test` triggers `.github/workflows/release.yml`; Actions run finishes green with source maps uploaded to Sentry.
result: [pending]

### 3. Demangled stack trace in Sentry (Success Criterion #4)
expected: After staging deploy with `ERROR_TRACKER=sentry` + matching `RELEASE`, hitting a deliberate-failure endpoint produces a Sentry issue whose Stack Trace tab shows real source paths (e.g., `apps/api/src/index.ts:142`), NOT minified frames.
result: [pending]

### 4. No public .map files served (Pitfall 5)
expected: `curl -I https://admin.your-fork.example.com/assets/<hash>.js.map` returns 404. `productionBrowserSourceMaps` remains FALSE in `apps/web/next.config.ts`.
result: [pending]

### 5. Cleanup
expected: Deliberate-failure endpoint reverted; test tag optionally deleted.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps

(none yet — items are pending operator action, not failed)
