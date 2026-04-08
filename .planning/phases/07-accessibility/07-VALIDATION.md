---
phase: 7
slug: accessibility
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-08
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.3 + vitest-axe 0.1.0 |
| **Config file** | packages/ui/vitest.config.ts |
| **Quick run command** | `cd packages/ui && bun run vitest run --reporter=verbose` |
| **Full suite command** | `cd packages/ui && bun run vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd packages/ui && bun run vitest run --reporter=verbose`
- **After every plan wave:** Run `cd packages/ui && bun run vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | A11Y-06 | — | N/A | unit | `cd packages/ui && bun run vitest run src/components/__tests__/button.a11y.test.tsx` | ❌ W0 | ⬜ pending |
| 07-01-02 | 01 | 1 | A11Y-04, A11Y-05 | — | N/A | unit | `cd packages/ui && bun run vitest run src/components/__tests__/form.a11y.test.tsx` | ❌ W0 | ⬜ pending |
| 07-01-03 | 01 | 1 | A11Y-06 | — | N/A | unit | `cd packages/ui && bun run vitest run src/components/__tests__/dialog.a11y.test.tsx` | ❌ W0 | ⬜ pending |
| 07-01-04 | 01 | 1 | A11Y-03 | — | N/A | unit | `cd packages/ui && bun run vitest run src/components/__tests__/skip-link.a11y.test.tsx` | ❌ W0 | ⬜ pending |
| 07-xx-xx | xx | x | A11Y-01 | — | N/A | manual-only | Manual landmark audit | N/A | ⬜ pending |
| 07-xx-xx | xx | x | A11Y-02 | — | N/A | manual-only | Manual keyboard Tab-through | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest-axe` package installation in packages/ui
- [ ] `packages/ui/src/test-setup.ts` — add `import "vitest-axe/extend-expect"`
- [ ] `packages/ui/src/components/__tests__/button.a11y.test.tsx` — covers A11Y-06
- [ ] `packages/ui/src/components/__tests__/form.a11y.test.tsx` — covers A11Y-04, A11Y-05
- [ ] `packages/ui/src/components/__tests__/dialog.a11y.test.tsx` — covers A11Y-06
- [ ] `packages/ui/src/components/__tests__/skip-link.a11y.test.tsx` — covers A11Y-03

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Semantic landmarks on every page | A11Y-01 | Layout structure verified visually/DOM inspector | Open each page, inspect DOM for `<nav>`, `<main>`, `<header>`, verify heading hierarchy h1>h2>h3 |
| Keyboard Tab navigation all interactive elements | A11Y-02 | Full-page keyboard flow cannot be automated in JSDOM | Tab through every page, verify all interactive elements receive focus with visible indicator, Escape closes modals/sheets/dropdowns |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
