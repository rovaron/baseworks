---
phase: 4
slug: frontend-applications
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-06
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (backend routes/API) + build verification (frontend apps) |
| **Config file** | N/A (frontend component testing deferred per CONTEXT.md) |
| **Quick run command** | `bun run typecheck` |
| **Full suite command** | `bun run typecheck && cd apps/web && bun run build && cd ../admin && bun run build` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run typecheck`
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | SHUI-01 | — | N/A | build | `cd packages/ui && bun run --bun tsc --noEmit` | N/A | ⬜ pending |
| 04-01-02 | 01 | 1 | SHUI-02 | — | N/A | type-check | `cd packages/api-client && bun run --bun tsc --noEmit` | N/A | ⬜ pending |
| 04-01-03 | 01 | 1 | CUST-04 | — | Eden Treaty type inference | type-check | `cd apps/api && bunx tsc --noEmit` | ✅ | ⬜ pending |
| 04-02-01 | 02 | 2 | CUST-01 | T-4-06 | Auth pages reject invalid credentials | build | `cd apps/web && bun run build` | N/A | ⬜ pending |
| 04-02-02 | 02 | 2 | CUST-02 | T-4-07 | Protected routes redirect unauthenticated | build | `cd apps/web && bun run build` | N/A | ⬜ pending |
| 04-02-03 | 02 | 2 | CUST-03 | — | N/A | build | `cd apps/web && bun run build` | N/A | ⬜ pending |
| 04-02-04 | 02 | 2 | CUST-05 | — | N/A | build | `cd apps/web && bun run build` | N/A | ⬜ pending |
| 04-03-01 | 03 | 2 | ADMN-01 | T-4-08 | Admin auth enforces role check | build | `cd apps/admin && bun run build` | N/A | ⬜ pending |
| 04-03-02 | 03 | 2 | ADMN-02 | — | N/A | build | `cd apps/admin && bun run build` | N/A | ⬜ pending |
| 04-03-03 | 03 | 2 | ADMN-03 | — | N/A | build | `cd apps/admin && bun run build` | N/A | ⬜ pending |
| 04-03-04 | 03 | 2 | ADMN-04 | — | N/A | type-check | `cd apps/admin && bunx tsc --noEmit` | N/A | ⬜ pending |
| 04-03-05 | 03 | 2 | ADMN-05 | — | N/A | build | `cd apps/admin && bun run build` | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. Frontend component testing (Vitest + @testing-library/react) is deferred per CONTEXT.md to Phase 5 or a dedicated testing phase. All automated verification uses type-checking and build commands which require no additional test infrastructure.

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual UI consistency across both apps | SHUI-01 | Requires visual inspection of rendered components | Open both apps, compare button/card/form styles |
| Stripe Customer Portal redirect | CUST-03 | External Stripe redirect cannot be tested in CI | Click "Manage Billing" button, verify redirect to Stripe |
| OAuth login flow (Google/GitHub) | CUST-01 | Requires external OAuth provider | Click OAuth button, verify redirect and callback |
| Auth page form submission and redirect | CUST-01 | Requires running backend with database | Fill login form, submit, verify redirect to /dashboard |
| Tenant switching in sidebar | CUST-05 | Requires multi-tenant user session | Log in as multi-tenant user, switch tenant, verify context change |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are covered by build/typecheck commands
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 not needed — build/typecheck commands are sufficient
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
