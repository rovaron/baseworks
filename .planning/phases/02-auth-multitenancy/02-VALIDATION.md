---
phase: 02
slug: auth-multitenancy
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-06
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun test (built-in) |
| **Config file** | none -- Bun's built-in test runner |
| **Quick run command** | `bun test packages/modules/auth/` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/modules/auth/`
- **After every plan wave:** Run `bun test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-03 | 01 | 1 | AUTH-01, AUTH-04, AUTH-06 | T-02-01, T-02-03 | Auth module wiring: module def, schema tables, instance exports | unit | `bun test packages/modules/auth/src/__tests__/auth-setup.test.ts` | Plan 01 Task 3 creates | ⬜ pending |
| 02-02-03 | 02 | 2 | TNNT-01, TNNT-02, TNNT-04 | T-02-05, T-02-06 | Tenant session flow, auto-create tenant, RBAC enforcement (member gets 403) | integration | `bun test packages/modules/auth/src/__tests__/tenant-session.test.ts` | Plan 02 Task 3 creates | ⬜ pending |
| 02-03-01 | 03 | 3 | TNNT-03 | — | Tenant CRUD command/query registration | unit | `bun test packages/modules/auth/src/__tests__/tenant-crud.test.ts` | Plan 03 Task 2 creates | ⬜ pending |
| 02-03-02 | 03 | 3 | TNNT-05, AUTH-02, AUTH-03, AUTH-05 | — | Profile registration + auth config (OAuth, magic link, password reset) | unit | `bun test packages/modules/auth/src/__tests__/profile.test.ts` | Plan 03 Task 2 creates | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Test File to Plan Traceability

Each test file below is created by a specific plan task. No Wave 0 stubs are needed because each plan creates its own test files as part of task execution.

| Test File | Created By | Requirements Covered |
|-----------|-----------|---------------------|
| `packages/modules/auth/src/__tests__/auth-setup.test.ts` | Plan 01, Task 3 | AUTH-01, AUTH-04, AUTH-06 |
| `packages/modules/auth/src/__tests__/tenant-session.test.ts` | Plan 02, Task 3 | TNNT-01, TNNT-02, TNNT-04 |
| `packages/modules/auth/src/__tests__/tenant-crud.test.ts` | Plan 03, Task 2 | TNNT-03 |
| `packages/modules/auth/src/__tests__/profile.test.ts` | Plan 03, Task 2 | TNNT-05, AUTH-02, AUTH-03, AUTH-05 |

---

## Requirement Coverage Matrix

| Req ID | Behavior | Verified In | How |
|--------|----------|-------------|-----|
| AUTH-01 | Email/password signup | auth-setup.test.ts | Module def has emailAndPassword enabled |
| AUTH-02 | OAuth login (Google, GitHub) | profile.test.ts | Auth config assertion: socialProviders configured |
| AUTH-03 | Magic link login | profile.test.ts | Auth config assertion: magicLink plugin present |
| AUTH-04 | Session persistence | auth-setup.test.ts | Schema exports session table |
| AUTH-05 | Password reset | profile.test.ts | Auth config assertion: sendResetPassword configured |
| AUTH-06 | Elysia integration | auth-setup.test.ts | Module def has routes, registered in registry |
| TNNT-01 | User auto-assigned to tenant | tenant-session.test.ts | Signup creates personal org with owner role |
| TNNT-02 | Scoped queries filtered | tenant-session.test.ts | Tenant middleware resolves tenantId from session |
| TNNT-03 | Tenant CRUD | tenant-crud.test.ts | All 6 command/query handlers registered |
| TNNT-04 | RBAC enforcement | tenant-session.test.ts | Member receives 403 on owner-only DELETE /api/tenant |
| TNNT-05 | Profile update | profile.test.ts | update-profile and get-profile registered |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| OAuth redirect flow | AUTH-02 | Requires real Google/GitHub OAuth app | Configure test OAuth app, verify redirect and callback |

*All other behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Test files created by plan tasks (no orphaned Wave 0 stubs)
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
