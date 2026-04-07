---
phase: 4
slug: frontend-applications
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-06
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (backend routes/API) + Vitest (frontend components) |
| **Config file** | `vitest.config.ts` in apps/web and apps/admin (Wave 0 installs) |
| **Quick run command** | `bun test --filter "04-*"` |
| **Full suite command** | `bun test && cd apps/web && bunx vitest run && cd ../admin && bunx vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test --filter "04-*"`
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | SHUI-01 | — | N/A | build | `cd packages/ui && bun run build` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | SHUI-02 | — | N/A | build | `cd packages/api-client && bun run build` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | CUST-04 | — | Eden Treaty type inference | type-check | `cd apps/api && bunx tsc --noEmit` | ✅ | ⬜ pending |
| 04-02-01 | 02 | 2 | CUST-01 | T-4-01 | Auth pages reject invalid credentials | integration | `cd apps/web && bunx vitest run --filter auth` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 2 | CUST-02 | T-4-02 | Protected routes redirect unauthenticated | integration | `cd apps/web && bunx vitest run --filter middleware` | ❌ W0 | ⬜ pending |
| 04-02-03 | 02 | 2 | CUST-03 | — | N/A | build | `cd apps/web && bun run build` | ❌ W0 | ⬜ pending |
| 04-02-04 | 02 | 2 | CUST-05 | — | N/A | build | `cd apps/web && bun run build` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 2 | ADMN-01 | T-4-03 | Admin auth enforces role check | integration | `cd apps/admin && bunx vitest run --filter auth` | ❌ W0 | ⬜ pending |
| 04-03-02 | 03 | 2 | ADMN-02 | — | N/A | build | `cd apps/admin && bun run build` | ❌ W0 | ⬜ pending |
| 04-03-03 | 03 | 2 | ADMN-03 | — | N/A | build | `cd apps/admin && bun run build` | ❌ W0 | ⬜ pending |
| 04-03-04 | 03 | 2 | ADMN-04 | — | N/A | type-check | `cd apps/admin && bunx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 04-03-05 | 03 | 2 | ADMN-05 | — | N/A | build | `cd apps/admin && bun run build` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/web/vitest.config.ts` — Vitest config for Next.js customer app
- [ ] `apps/admin/vitest.config.ts` — Vitest config for Vite admin dashboard
- [ ] `vitest` + `@testing-library/react` — install in apps/web and apps/admin
- [ ] `packages/ui/tsconfig.json` — TypeScript config for shared UI package

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual UI consistency across both apps | SHUI-01 | Requires visual inspection of rendered components | Open both apps, compare button/card/form styles |
| Stripe Customer Portal redirect | CUST-03 | External Stripe redirect cannot be tested in CI | Click "Manage Billing" button, verify redirect to Stripe |
| OAuth login flow (Google/GitHub) | CUST-01 | Requires external OAuth provider | Click OAuth button, verify redirect and callback |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
