---
phase: 9
slug: team-invites
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-11
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun test (backend) / Vitest (frontend) |
| **Config file** | `packages/modules/auth/src/__tests__/` (existing test dir) |
| **Quick run command** | `bun test packages/modules/auth/src/__tests__/ -x` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/modules/auth/src/__tests__/ -x`
- **After every plan wave:** Run `bun test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | INVT-01 | T-09-01 | requireRole("owner","admin") on invite creation | unit | `bun test packages/modules/auth/src/__tests__/invitation.test.ts -x` | No - W0 | pending |
| 09-01-02 | 01 | 1 | INVT-02 | T-09-02 | Email sent via BullMQ queue, not inline | unit | `bun test packages/modules/auth/src/__tests__/invitation.test.ts -x` | No - W0 | pending |
| 09-01-03 | 01 | 1 | INVT-03 | T-09-03 | Shareable link with pre-assigned role | unit | `bun test packages/modules/auth/src/__tests__/invitation.test.ts -x` | No - W0 | pending |
| 09-02-01 | 02 | 2 | INVT-04 | T-09-04 | Accept invite joins org with correct role | unit | `bun test packages/modules/auth/src/__tests__/invitation.test.ts -x` | No - W0 | pending |
| 09-03-01 | 03 | 2 | INVT-05 | T-09-05 | List/cancel/resend restricted to admins | unit | `bun test packages/modules/auth/src/__tests__/invitation.test.ts -x` | No - W0 | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `packages/modules/auth/src/__tests__/invitation.test.ts` -- stubs for INVT-01 through INVT-05
- [ ] Test setup for mocking `auth.api.*` invitation methods (extend existing `auth-setup.test.ts` pattern)

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Email rendering with org branding | INVT-02 | Visual template verification | Send test invite, check email in Resend dashboard |
| Accept invite as new user (signup flow) | INVT-04 | Full browser E2E flow | Navigate invite link while logged out, create account, verify org membership |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
