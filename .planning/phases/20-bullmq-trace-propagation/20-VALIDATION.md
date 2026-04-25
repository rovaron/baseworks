---
phase: 20
slug: bullmq-trace-propagation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-25
---

# Phase 20 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun test (Bun runtime ^1.1+) |
| **Config file** | none — already installed via root `package.json` |
| **Quick run command** | `bun test packages/queue/src/__tests__/carrier-roundtrip.test.ts` |
| **Full suite command** | `bun test packages/queue apps/api/__tests__/observability-bullmq-trace.test.ts` |
| **Estimated runtime** | ~5–10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test packages/queue/src/__tests__/carrier-roundtrip.test.ts`
- **After every plan wave:** Run `bun test packages/queue apps/api/__tests__/observability-bullmq-trace.test.ts`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

> Populated by gsd-planner during plan generation. Every task that produces verifiable behavior must map to an automated test command or be flagged as Wave 0 dependency.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD     | TBD  | TBD  | CTX-04 / TRC-03 | — | N/A | unit | `bun test ...` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/queue/src/__tests__/carrier-roundtrip.test.ts` — NEW (D-07b): 5 tests gating carrier inject/extract round-trip, no-ALS-frame skip, tracestate forwarding, retry-attempt parent inheritance.
- [ ] `apps/api/__tests__/observability-bullmq-trace.test.ts` — NEW (D-08): in-process API→worker single-trace assertion (SC#2 trace-data level).
- [ ] `packages/queue/src/__tests__/create-worker-als.test.ts` — EXTEND with carrier-extract assertions; existing Phase 19 fresh-fallback tests must stay green.
- [ ] `propagation.setGlobalPropagator(new W3CTraceContextPropagator())` registered in test `beforeAll` (research finding #2 — without this, `propagation.inject` is a silent no-op).

*Existing infrastructure note:* `bun test` is already wired across packages; no framework install needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Tempo dashboard shows producer→consumer trace as single tree | SC#2 (literal "in Tempo") | Real OTEL exporter + Grafana stack ships in Phase 21 | Deferred to Phase 21 — Phase 20 satisfies SC#2 at trace-data level via D-08 in-process test. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (`bun test` is single-run)
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter after planner sign-off

**Approval:** pending
