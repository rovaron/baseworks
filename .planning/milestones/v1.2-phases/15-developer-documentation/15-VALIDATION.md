---
phase: 15
slug: developer-documentation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (backend) — covers the D-05 example-module extension only |
| **Config file** | `apps/api/bunfig.toml` (existing) |
| **Quick run command** | `bun test --filter examples` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~3 seconds (quick), ~15 seconds (full) |

> Note: Phase 15 is primarily a documentation-authoring phase. The majority of tasks produce markdown files under `docs/`, which cannot be verified by automated tests. Code-level validation applies only to the D-05 example-module extension (new event + BullMQ worker) — the rest is covered by the **Manual-Only Verifications** section below.

---

## Sampling Rate

- **After every task commit:** Run `bun test --filter examples` (for code tasks in D-05 plan only)
- **After every plan wave:** Run `bun test` (full backend suite)
- **Before `/gsd-verify-work`:** Full `bun test` suite must be green, AND all doc tasks must have completed their acceptance-criteria grep checks
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

> Filled in during `/gsd-plan-phase` after plans are written. Placeholder rows below show the expected structure.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 15-01-XX | 01 | 1 | DOCS-01 | — | N/A | file-exists | `test -f docs/getting-started.md` | ⬜ pending | ⬜ pending |
| 15-02-XX | 02 | 1 | DOCS-02 | — | N/A | grep | `grep -q "mermaid" docs/architecture.md` | ⬜ pending | ⬜ pending |
| 15-0X-XX | 0X | X | DOCS-0X | — | example module worker exercises BullMQ flow | unit | `bun test --filter examples` | ⬜ pending | ⬜ pending |

---

## Wave 0 Requirements

- [ ] No new test framework installation needed — `bun test` already configured in Phase 14
- [ ] If the D-05 extension adds a new table, Wave 0 must include a Drizzle migration task before any worker/event test
- [ ] `docs/` directory must exist at repo root before any authoring task runs

*If none of the above apply: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

Documentation correctness cannot be asserted by a test runner. Each doc task must pass these manual checks as part of its acceptance criteria:

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Getting Started walkthrough actually works end-to-end | DOCS-01 | Requires a human to run each step on a fresh clone | Clone repo to a scratch directory, follow `docs/getting-started.md` verbatim, verify dev server starts and tests pass |
| Architecture Mermaid diagrams render correctly on GitHub | DOCS-02 | GitHub rendering cannot be asserted from CLI | Push branch, open `docs/architecture.md` in GitHub preview, verify all ```mermaid blocks render without errors |
| "Add a Module" tutorial produces a working module when followed | DOCS-03 | Requires a human to execute each step against a clean repo | Follow tutorial verbatim, confirm new module registers in `ModuleRegistry`, responds to CQRS dispatch, and passes its own smoke test |
| Configuration guide matches real env schema | DOCS-04 | Requires cross-referencing every var in the doc against `apps/api/src/env.ts` (manual diff) | For each env var in `docs/configuration.md`, run `grep -n "VAR_NAME" apps/api/src/env.ts` and confirm presence + description match |
| Testing guide examples compile and run | DOCS-05 | Requires extracting code snippets and running them | Copy each code block from `docs/testing.md` into a scratch test file, run `bun test`, confirm no compilation or runtime errors |
| Integration docs (better-auth, Stripe/Pagar.me, BullMQ, Resend) accurate | DOCS-06..DOCS-09 | Requires running each integration's setup against the documented steps | For each integration doc, configure the minimum env vars it describes and run the documented smoke path (auth login, Stripe test webhook, BullMQ job enqueue, Resend test email) |
| Cross-doc anchor links resolve | All DOCS-* | No installed link-checker; anchors are GitHub-generated | Push branch, open each doc in GitHub preview, click every internal link, confirm all resolve |
| No forbidden filler words | All DOCS-* | Phase 13 `docs/jsdoc-style-guide.md` rule | Run `grep -nE "\\b(basically|simply|just)\\b" docs/*.md` for each doc file; must return zero matches in author-voice prose (code examples excluded via reviewer judgment) |
| No leaked secrets in examples | All DOCS-* | Security threat from RESEARCH.md §Security Domain | Run `grep -nE "sk_live|sk_test_[a-zA-Z0-9]{20,}|password\\s*=\\s*['\"][^'\"]+['\"]" docs/*.md`; zero matches required |

*All remaining verifications fall under these manual checks — this phase has no behaviors that can be asserted by automated tests beyond the D-05 code extension.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify OR a corresponding Manual-Only row in the table above
- [ ] Sampling continuity: no 3 consecutive tasks without a verify step (automated or manual)
- [ ] Wave 0 covers the example-module extension migration (if new table added) before any worker test task
- [ ] No watch-mode flags in any command
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter once planner completes the Per-Task Verification Map

**Approval:** pending
