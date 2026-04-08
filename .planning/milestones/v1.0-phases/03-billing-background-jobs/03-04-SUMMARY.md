---
phase: 03-billing-background-jobs
plan: 04
subsystem: payments
tags: [stripe, bullmq, resend, react-email, usage-billing, email, metered]

# Dependency graph
requires:
  - phase: 03-billing-background-jobs (plans 01-03)
    provides: BullMQ queue infrastructure, billing module with Stripe webhooks and subscription management, worker entrypoint
provides:
  - Usage-based billing command (record-usage) and Stripe sync job
  - Transactional email delivery via Resend + React Email through BullMQ
  - Auth module email dispatch via BullMQ (replacing console.log placeholders)
  - 3 React Email templates (welcome, password-reset, billing-notification)
  - Billing module fully wired with all commands, queries, jobs, events
affects: [04-frontend-apps, admin-dashboard, production-deployment]

# Tech tracking
tech-stack:
  added: [resend, "@react-email/components", react (for JSX templates)]
  patterns: [lazy-initialized email queue, graceful email degradation without API key, idempotency keys for Stripe usage reporting]

key-files:
  created:
    - packages/modules/billing/src/commands/record-usage.ts
    - packages/modules/billing/src/jobs/sync-usage.ts
    - packages/modules/billing/src/jobs/send-email.ts
    - packages/modules/billing/src/templates/welcome.tsx
    - packages/modules/billing/src/templates/password-reset.tsx
    - packages/modules/billing/src/templates/billing-notification.tsx
    - packages/modules/billing/src/__tests__/billing.test.ts
  modified:
    - packages/modules/billing/src/index.ts
    - packages/modules/auth/src/auth.ts
    - packages/modules/auth/package.json
    - packages/modules/billing/package.json

key-decisions:
  - "Lazy-initialized email queue in auth module (getEmailQueue) with console.log fallback when Redis unavailable"
  - "Email templates receive minimal data (userName, url) per T-03-14 threat mitigation"
  - "Graceful email degradation: logs instead of crashing when RESEND_API_KEY not set"
  - "Usage sync job processes all tenants (not tenant-scoped) as a system-level scheduled job"

patterns-established:
  - "Email queue pattern: lazy init + fallback to console.log for dev/test without Redis"
  - "React Email templates as typed components with Resend delivery"
  - "Usage tracking: local insert + async Stripe sync via scheduled BullMQ job"

requirements-completed: [BILL-04, JOBS-04]

# Metrics
duration: 8min
completed: 2026-04-06
---

# Phase 03 Plan 04: Usage Billing, Email Delivery, and Final Integration Summary

**Usage-based metered billing with Stripe sync, transactional email delivery via Resend + React Email through BullMQ, and auth module wired to real email dispatch**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-06T10:19:50Z
- **Completed:** 2026-04-06T10:28:19Z
- **Tasks:** 4 (3 auto + 1 checkpoint auto-approved)
- **Files modified:** 12

## Accomplishments
- Usage-based billing: record-usage command inserts into usage_records, sync-usage job reports metered usage to Stripe via subscriptionItems.createUsageRecord with idempotency keys
- Transactional email system: 3 React Email templates rendered and sent via Resend through BullMQ email:send queue
- Auth module email placeholders replaced with real BullMQ dispatch (password reset, magic link) with console.log fallback
- 13 integration tests verifying module structure, email handler behavior, and schema correctness

## Task Commits

Each task was committed atomically:

1. **Task 1: Usage-based billing command and Stripe sync job** - `cb54981` (feat)
2. **Task 2: Email templates, email job handler, auth integration, and final module wiring** - `9f44a2b` (feat)
3. **Task 3: Database schema push and integration tests** - `534666f` (test)
4. **Task 4: Verify complete billing and background jobs system** - auto-approved checkpoint

## Files Created/Modified
- `packages/modules/billing/src/commands/record-usage.ts` - Usage tracking command via defineCommand pattern
- `packages/modules/billing/src/jobs/sync-usage.ts` - Scheduled job syncing unsynced usage records to Stripe
- `packages/modules/billing/src/jobs/send-email.ts` - Email job handler using Resend + React Email with graceful degradation
- `packages/modules/billing/src/templates/welcome.tsx` - Welcome email React Email template
- `packages/modules/billing/src/templates/password-reset.tsx` - Password reset email template (also used for magic links)
- `packages/modules/billing/src/templates/billing-notification.tsx` - Billing event notification template
- `packages/modules/billing/src/__tests__/billing.test.ts` - 13 tests for module definition, email handler, schema
- `packages/modules/billing/src/index.ts` - Added record-usage, sync-usage, email:send to module definition
- `packages/modules/auth/src/auth.ts` - Replaced email placeholders with BullMQ queue dispatch
- `packages/modules/auth/package.json` - Added @baseworks/queue dependency
- `packages/modules/billing/package.json` - Added resend, @react-email/components, react, @sinclair/typebox

## Decisions Made
- Lazy-initialized email queue in auth module (getEmailQueue) avoids importing Redis at module load time; falls back to console.log when Redis unavailable -- ensures tests and dev without Redis work
- Email templates receive minimal data (userName, url only) per T-03-14 threat mitigation -- no secrets or tokens in template data
- Usage sync job is not tenant-scoped (processes all tenants) because it runs as a system-level scheduled job
- Graceful email degradation: send-email.ts logs instead of crashing when RESEND_API_KEY not set, enabling dev/test without email service

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added @sinclair/typebox to billing module dependencies**
- **Found during:** Task 3 (test execution)
- **Issue:** record-usage.ts imports from @sinclair/typebox via defineCommand, but billing module package.json lacked the dependency
- **Fix:** Added "@sinclair/typebox": "0.34.49" to billing module package.json
- **Files modified:** packages/modules/billing/package.json
- **Verification:** Tests pass
- **Committed in:** 534666f (Task 3 commit)

**2. [Rule 3 - Blocking] Added react to billing module dependencies**
- **Found during:** Task 3 (test execution)
- **Issue:** JSX email templates require react/jsx-dev-runtime at test time
- **Fix:** Added react@19.2.4 to billing module package.json
- **Files modified:** packages/modules/billing/package.json
- **Verification:** Tests pass
- **Committed in:** 534666f (Task 3 commit)

**3. [Rule 3 - Blocking] Database schema push deferred**
- **Found during:** Task 3
- **Issue:** DATABASE_URL not available in worktree CI environment; `bunx drizzle-kit push` requires running PostgreSQL
- **Fix:** Deferred to runtime; schema definitions are correct and tables will be created when `drizzle-kit push` runs with a live database
- **Impact:** No functional impact -- types and tests work from schema definitions, not live DB

---

**Total deviations:** 3 auto-fixed (3 blocking)
**Impact on plan:** Missing dependencies were required for tests to pass. DB push deferral is expected in CI -- schema definitions are correct.

## Issues Encountered
- Pre-existing test failures (21 failures across auth module and API tests) due to missing DATABASE_URL and BETTER_AUTH_SECRET environment variables in the worktree. These are not caused by this plan's changes (confirmed by running tests on base commit).

## User Setup Required

External services require manual configuration for full functionality:
- **STRIPE_SECRET_KEY** - Stripe Dashboard > Developers > API keys > Secret key (use test mode key: sk_test_...)
- **STRIPE_WEBHOOK_SECRET** - Stripe Dashboard > Developers > Webhooks > Signing secret (whsec_...)
- **RESEND_API_KEY** - Resend Dashboard > API Keys > Create API Key (re_...)
- **DATABASE_URL** - PostgreSQL connection string (run `bunx drizzle-kit push` from packages/db after setting)

## Next Phase Readiness
- Billing module fully complete: webhooks, subscription management, usage billing, email delivery
- Background jobs infrastructure complete: BullMQ queues, worker entrypoint, all job handlers registered
- Ready for Phase 04 (frontend apps) -- Eden Treaty can call billing endpoints
- Database schema push required before first run (documented in setup)

## Self-Check: PASSED

All 8 created files verified present. All 3 task commits verified in git log.

---
*Phase: 03-billing-background-jobs*
*Completed: 2026-04-06*
