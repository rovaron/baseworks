---
phase: 19
slug: context-logging-http-cqrs-tracing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-23
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Details are expanded in `19-RESEARCH.md` §"Validation Architecture". This file is the executable contract.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (Bun 1.3+ native runner) |
| **Config file** | `bunfig.toml` (existing) |
| **Quick run command** | `bun test apps/api/__tests__/observability-context-bleed.test.ts packages/observability/__tests__/*.test.ts` |
| **Full suite command** | `bun test && bun run lint && bun run lint:als` |
| **Estimated runtime** | ~12–18 seconds (quick), ~35–60 seconds (full with lint) |

---

## Sampling Rate

- **After every task commit:** Run quick command (targeted observability + wrapper tests)
- **After every plan wave:** Run full suite (includes `bun run lint` for Biome rule + `lint:als` grep gate)
- **Before `/gsd-verify-work`:** Full suite must be green; the 100-RPS context-bleed test runs inside `bun test`
- **Max feedback latency:** 20 seconds (quick), 60 seconds (full)

---

## Per-Task Verification Map

> Filled in by planner at task emission time. Each row maps a planned task to its automated check.
> Any row with `Automated Command` = `N/A` must appear in the Manual-Only Verifications table below.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {19-01-01} | 01 | 1 | CTX-01 | — | `obsContext` module exports instance + mutator helpers | unit | `bun test packages/observability/src/__tests__/context.test.ts` | ❌ W0 | ⬜ pending |
| {19-01-02} | 01 | 1 | CTX-01 | — | `getLocale()` resolves from `obsContext` post-migration | unit | `bun test packages/modules/auth/__tests__/locale-context.test.ts` | ❌ W0 | ⬜ pending |
| {19-02-01} | 02 | 1 | CTX-01/CTX-02 | T-19-OBS-1 (traceparent trust) | Bun.serve fetch wrapper seeds ALS per request without bleed | integration | `bun test apps/api/__tests__/observability-context-bleed.test.ts` | ❌ W0 | ⬜ pending |
| {19-02-02} | 02 | 1 | CTX-02 | T-19-OBS-1 | Untrusted traceparent → fresh trace + span link | unit | `bun test apps/api/src/core/middleware/__tests__/observability.trust.test.ts` | ❌ W0 | ⬜ pending |
| {19-02-03} | 02 | 1 | CTX-02 | T-19-OBS-1 | Trusted-CIDR traceparent → accepted as parent | unit | `bun test apps/api/src/core/middleware/__tests__/observability.trust.test.ts` | ❌ W0 | ⬜ pending |
| {19-03-01} | 03 | 2 | CTX-03 | — | Pino mixin injects trace/tenant/request on every log line | unit | `bun test apps/api/src/lib/__tests__/logger-mixin.test.ts` | ❌ W0 | ⬜ pending |
| {19-03-02} | 03 | 2 | CTX-03 | — | Zero call-site changes: grep audit of `logger.info\|logger.error` shows identical file set pre/post | assertion | `bun test apps/api/__tests__/logger-callsite-invariance.test.ts` | ❌ W0 | ⬜ pending |
| {19-04-01} | 04 | 2 | TRC-01 | — | HTTP span named `{method} {route_template}` with status/tenant/user attrs | integration | `bun test apps/api/src/core/middleware/__tests__/observability.span.test.ts` | ❌ W0 | ⬜ pending |
| {19-04-02} | 04 | 2 | TRC-01 | — | Outbound traceparent + x-request-id headers on every response | integration | `bun test apps/api/src/core/middleware/__tests__/observability.headers.test.ts` | ❌ W0 | ⬜ pending |
| {19-05-01} | 05 | 2 | TRC-02 | — | `wrapCqrsBus` emits `cqrs.command` / `cqrs.query` span with ALS-derived attrs | unit | `bun test packages/observability/src/wrappers/__tests__/wrap-cqrs-bus.test.ts` | ✅ (extend) | ⬜ pending |
| {19-05-02} | 05 | 2 | TRC-02 | — | `wrapEventBus` emits `event.publish` / `event.handle` per listener, links consumer to producer | unit | `bun test packages/observability/src/wrappers/__tests__/wrap-event-bus.test.ts` | ❌ W0 | ⬜ pending |
| {19-05-03} | 05 | 2 | TRC-02 | — | `core/cqrs.ts` + `core/event-bus.ts` unchanged (byte-equal vs git HEAD baseline) | assertion | `bun test apps/api/__tests__/core-invariants.test.ts` | ❌ W0 | ⬜ pending |
| {19-06-01} | 06 | 3 | CTX-01 | T-19-ALS-1 (enterWith bleed) | Biome GritQL rule fails on any `.enterWith(` call | lint | `bun run lint` (expect exit 1 when seeded with a violation fixture) | ❌ W0 | ⬜ pending |
| {19-06-02} | 06 | 3 | CTX-01 | T-19-ALS-1 | Grep gate `scripts/lint-no-enterwith.sh` fails on any `.enterWith(` outside allow-list | lint | `bun run lint:als` | ❌ W0 | ⬜ pending |
| {19-06-03} | 06 | 3 | CTX-01 | T-19-ALS-1 | In-test grep assertion fails if `.enterWith(` lands in `packages/` or `apps/` | unit | `bun test scripts/__tests__/enterwith-ban.test.ts` | ❌ W0 | ⬜ pending |
| {19-07-01} | 07 | 3 | Success Criterion 5 | T-19-ALS-1 | 100 concurrent interleaved tenant-A/B requests: every log line carries the right tenantId | load/integration | `bun test apps/api/__tests__/observability-context-bleed.test.ts` | ❌ W0 | ⬜ pending |
| {19-07-02} | 07 | 3 | Success Criterion 5 | — | Pino mixin perf: p99 regression ≤5% vs pre-mixin baseline | perf | `bun test apps/api/__tests__/observability-mixin-perf.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Task IDs above are placeholders; planner replaces with real task IDs emitted by the plan files.*

---

## Wave 0 Requirements

- [ ] `packages/observability/src/__tests__/context.test.ts` — stubs for CTX-01 (`obsContext.run` isolation, mutator helpers semantics)
- [ ] `apps/api/__tests__/observability-context-bleed.test.ts` — 100-RPS concurrent-tenant load assertion (Success Criterion 5)
- [ ] `apps/api/__tests__/observability-mixin-perf.test.ts` — p99 mixin-overhead harness with noop baseline
- [ ] `apps/api/src/core/middleware/__tests__/observability.*.test.ts` — span lifecycle + traceparent trust + headers suites
- [ ] `apps/api/src/lib/__tests__/logger-mixin.test.ts` — pino mixin merges ALS fields per log call
- [ ] `apps/api/__tests__/logger-callsite-invariance.test.ts` — grep-based audit of logger call sites unchanged
- [ ] `apps/api/__tests__/core-invariants.test.ts` — byte-equal guards for `core/cqrs.ts` + `core/event-bus.ts`
- [ ] `packages/observability/src/wrappers/__tests__/wrap-event-bus.test.ts` — NEW, mirrors `wrap-cqrs-bus.test.ts`
- [ ] `packages/observability/src/wrappers/__tests__/wrap-cqrs-bus.test.ts` — extend existing suite for ALS-override assertions
- [ ] `scripts/__tests__/enterwith-ban.test.ts` — in-test grep for `.enterWith(` across repo
- [ ] `scripts/lint-no-enterwith.sh` — grep-based CI gate + `lint:als` npm script wire-up
- [ ] `biome.json` — GritQL plugin registration for `no-async-local-storage-enterWith.grit`
- [ ] `packages/observability/package.json` — add `ipaddr.js@^2.2.0` for D-08 CIDR trust parsing

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Operator fork behavior when `OBS_TRUST_TRACEPARENT_FROM` is set to a non-loopback CIDR behind a real gateway | CTX-02 | Requires a real upstream proxy (Cloudflare / Nginx / API gateway) to inject `traceparent`; unit tests cover CIDR parsing + trust decision but not the end-to-end gateway path | 1. Configure `OBS_TRUST_TRACEPARENT_FROM=10.0.0.0/8` in staging env. 2. Curl via a gateway at `10.x.x.x` with a crafted `traceparent`. 3. Confirm Tempo/collector shows the inbound traceId as the parent on the server span. |
| Tempo/Grafana-side trace assembly of HTTP → CQRS → EventBus child spans | TRC-01, TRC-02 | Noop tracer by default; real OTEL adapter ships in Phase 21. Visual assembly verified there, not here. | Deferred to Phase 21 UAT. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s (quick) / 60s (full)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
