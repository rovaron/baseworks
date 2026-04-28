---
phase: 23
slug: runbooks-alert-templates-observability-docs
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-28
---

# Phase 23 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun scripts/validate-docs.ts` (no test runner — invariant validator) + `bun test` for any unit tests added to validate.ts helpers |
| **Config file** | none — `scripts/validate-docs.ts` is self-contained |
| **Quick run command** | `bun scripts/validate-docs.ts` |
| **Full suite command** | `bun run validate` (added in this phase to root `package.json` per Research Open Question 1 — research found this script does NOT yet exist) |
| **Estimated runtime** | ~2 seconds (file scan + JSON parse + regex; no network) |

---

## Sampling Rate

- **After every task commit:** Run `bun scripts/validate-docs.ts`
- **After every plan wave:** Run `bun run validate` (covers all 4 invariants)
- **Before `/gsd-verify-work`:** Full suite must be green AND `.github/workflows/validate.yml` triggers must pass on a smoke-test PR
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

> Filled in by gsd-planner during planning. Each plan's tasks land here with their automated verify command.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 23-XX-XX | TBD | TBD | DOC-03 / DOC-04 | — | runbook section template renders / runbook_url resolves / Mermaid floor holds | doc-shape / cross-link / mermaid-floor | `bun scripts/validate-docs.ts` | ✅ existing + extended | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `package.json` — add `"validate": "bun scripts/validate-docs.ts"` script (research found this is missing; without it, `bun run validate` and `.github/workflows/validate.yml` are no-ops)
- [ ] `scripts/validate-docs.ts` — extended with 4th invariant (D-09: runbook_url integrity for `docs/alerts/sentry/*.json` + cross-runbook markdown links inside `docs/runbooks/*.md`)
- [ ] `scripts/validate-docs.ts` — Mermaid floor literal raised from 8 → 11 (D-06, in same diff as the new diagrams)

*Existing infrastructure (the 3 invariants in `validate-docs.ts`) covers the forbidden-import / secret-shape / mermaid-floor checks. Wave 0 extends it; no new framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `.github/workflows/validate.yml` triggers on PR + push to main and exits non-zero on a broken `runbook_url` | DOC-03 / DOC-04 | Requires a real PR / GitHub Actions run; cannot be exercised from local Bun | Open a smoke-test PR with one Sentry alert JSON pointing at a non-existent runbook path — verify the `validate` job fails red, then fix and verify it passes green |
| Sentry alert JSON imports successfully via `sentry-cli api POST` (or fallback UI flow) | DOC-04 | Requires a real Sentry project + auth token; CI cannot exercise the third-party API safely | One-time spot check: pick `docs/alerts/sentry/db-down.json`, run the documented `jq 'del(...)'` strip + `sentry-cli api POST` flow against a sandbox Sentry org, confirm rule appears |
| Mermaid diagrams render correctly in GitHub's markdown renderer | DOC-03 | Local Mermaid CLI does not match GitHub's renderer exactly | View `docs/observability/trace-propagation.md` on the PR diff page; confirm both `sequenceDiagram` and `stateDiagram-v2` blocks render without error |
| Operator can resolve a 3am alert using a runbook (UAT) | DOC-03 | Cannot be automated — measures doc usefulness | Walk through `docs/runbooks/db-down.md` simulating a Postgres-stopped scenario; confirm Triage commands succeed and Resolution paths apply |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (filled during planning)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (`bun run validate` script wiring + 4th invariant + Mermaid floor literal)
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
