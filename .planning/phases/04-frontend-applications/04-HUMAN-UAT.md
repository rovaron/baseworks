---
status: partial
phase: 04-frontend-applications
source: [04-VERIFICATION.md]
started: 2026-04-07T03:00:00Z
updated: 2026-04-07T03:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Full auth flow end-to-end
expected: Sign up, session creation, dashboard access, middleware redirect to /login all work with better-auth server + PostgreSQL running
result: [pending]

### 2. Billing page with Stripe test mode
expected: Subscription status loads, plan selection works, Stripe Checkout redirect functions with Stripe test keys + running Elysia API
result: [pending]

### 3. Admin dashboard full management flow
expected: Tenant/user data tables populate, deactivate/ban actions complete, owner role is enforced with running backend + seed data
result: [pending]

### 4. Eden Treaty type inference validation
expected: Running root `bun run typecheck` confirms the `treaty<App>` type chain resolves cleanly across the monorepo (note: next.config.ts has `ignoreBuildErrors: true`)
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
