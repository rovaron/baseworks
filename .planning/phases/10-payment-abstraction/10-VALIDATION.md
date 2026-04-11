---
phase: 10
slug: payment-abstraction
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-11
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun test (built-in) |
| **Config file** | packages/modules/billing/package.json |
| **Quick run command** | `bun test packages/modules/billing/src/__tests__/` |
| **Full suite command** | `bun test packages/modules/billing/` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/modules/billing/src/__tests__/`
- **After every plan wave:** Run `bun test packages/modules/billing/`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-00-01 | 00 | 0 | PAY-01..05 | — | N/A | scaffold | `bun test packages/modules/billing/src/__tests__/` | ❌ W0 | ⬜ pending |
| 10-01-01 | 01 | 1 | PAY-01 | — | N/A | unit | `bun test packages/modules/billing/src/__tests__/payment-provider.test.ts` | ❌ W0 | ⬜ pending |
| 10-02-01 | 02 | 1 | PAY-02 | — | N/A | integration | `bun test packages/modules/billing/src/__tests__/stripe-adapter.test.ts` | ❌ W0 | ⬜ pending |
| 10-03-01 | 03 | 2 | PAY-03 | — | Webhook signature verified | unit | `bun test packages/modules/billing/src/__tests__/webhook-normalizer.test.ts` | ❌ W0 | ⬜ pending |
| 10-04-01 | 04 | 2 | PAY-04 | — | N/A | unit | `bun test packages/modules/billing/src/__tests__/pagarme-adapter.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/modules/billing/src/__tests__/payment-provider.test.ts` — stubs for PAY-01
- [ ] `packages/modules/billing/src/__tests__/stripe-adapter.test.ts` — stubs for PAY-02
- [ ] `packages/modules/billing/src/__tests__/webhook-normalizer.test.ts` — stubs for PAY-03
- [ ] `packages/modules/billing/src/__tests__/pagarme-adapter.test.ts` — stubs for PAY-04

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| ENV switch changes active provider | PAY-05 | Requires restart with different env | Set PAYMENT_PROVIDER=pagarme, restart, verify provider resolves correctly |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
