---
phase: 3
slug: billing-background-jobs
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-06
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun test (built-in) |
| **Config file** | `apps/api/bunfig.toml` (existing) |
| **Quick run command** | `bun test --filter billing` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test --filter billing`
- **After every plan wave:** Run `bun test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | JOBS-01 | — | N/A | unit | `bun test --filter queue` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | JOBS-02 | — | N/A | unit | `bun test --filter queue` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | JOBS-03 | — | N/A | integration | `bun test --filter worker` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | BILL-07 | T-03-01 | Stripe customer created via server-side API, not client | unit | `bun test --filter billing` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 1 | BILL-06 | T-03-02 | Webhook signature verified before processing | integration | `bun test --filter webhook` | ❌ W0 | ⬜ pending |
| 03-02-03 | 02 | 1 | BILL-01 | T-03-03 | Checkout session uses server-side price IDs, not client-supplied | unit | `bun test --filter billing` | ❌ W0 | ⬜ pending |
| 03-02-04 | 02 | 2 | BILL-02, BILL-05 | — | N/A | unit | `bun test --filter billing` | ❌ W0 | ⬜ pending |
| 03-02-05 | 02 | 2 | BILL-03 | — | N/A | unit | `bun test --filter billing` | ❌ W0 | ⬜ pending |
| 03-02-06 | 02 | 2 | BILL-04 | — | N/A | unit | `bun test --filter billing` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 1 | JOBS-04 | — | N/A | unit | `bun test --filter email` | ❌ W0 | ⬜ pending |
| 03-03-02 | 03 | 1 | JOBS-05 | — | N/A | integration | `bun test --filter webhook` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/modules/billing/src/__tests__/` — test directory with billing test stubs
- [ ] `packages/queue/src/__tests__/` — queue package test stubs
- [ ] Test fixtures for Stripe mock events and BullMQ mock workers

*Existing bun test infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Stripe Checkout redirect flow | BILL-01 | Requires browser interaction with Stripe-hosted page | Create checkout session, verify redirect URL, complete in Stripe test mode |
| Stripe Customer Portal access | BILL-05 | Requires browser interaction with Stripe-hosted portal | Generate portal URL, verify redirect works in browser |
| Webhook delivery from Stripe CLI | BILL-06 | Requires Stripe CLI `stripe listen --forward-to` | Run `stripe listen`, trigger test events, verify processing |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
