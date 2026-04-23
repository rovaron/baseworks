---
phase: 19
slug: context-logging-http-cqrs-tracing
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-23
revised: 2026-04-23
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
| {19-02-01} | 02 | 1 | CTX-02 | T-19-OBS-1 (traceparent trust) | `OBS_TRUST_TRACEPARENT_FROM` / `OBS_TRUST_TRACEPARENT_HEADER` env validation (CIDR syntax, crash-hard on bad config) | unit | `bun test packages/config/src/__tests__/env.test.ts` | ❌ W0 | ⬜ pending |
| {19-03-01} | 03 | 2 | CTX-03 | — | Pino mixin injects trace/tenant/request on every log line | unit | `bun test apps/api/src/lib/__tests__/logger-mixin.test.ts` | ❌ W0 | ⬜ pending |
| {19-03-02} | 03 | 2 | CTX-03 | — | Zero call-site changes: grep audit of `logger.info\|logger.error` shows identical file set pre/post | assertion | `bun test apps/api/__tests__/logger-callsite-invariance.test.ts` | ❌ W0 | ⬜ pending |
| {19-04-01} | 04 | 2 | TRC-02 | — | `wrapCqrsBus` emits `cqrs.command` / `cqrs.query` span with ALS-derived attrs | unit | `bun test packages/observability/src/wrappers/__tests__/wrap-cqrs-bus.test.ts` | ✅ (extend) | ⬜ pending |
| {19-04-02} | 04 | 2 | TRC-02 | — | `wrapEventBus` emits `event.publish` / `event.handle` per listener, links consumer to producer | unit | `bun test packages/observability/src/wrappers/__tests__/wrap-event-bus.test.ts` | ❌ W0 | ⬜ pending |
| {19-05-01} | 05 | 2 | CTX-02 | T-19-OBS-1 | `decideInboundTrace` — default untrusted → fresh trace; inbound preserved in `inboundCarrier` | unit | `bun test apps/api/src/lib/__tests__/inbound-trace.test.ts` | ❌ W0 | ⬜ pending |
| {19-05-02} | 05 | 2 | CTX-02 | T-19-OBS-1 | `decideInboundTrace` — CIDR-trusted match adopts inbound traceparent as parent; CIDR miss falls through fresh | unit | `bun test apps/api/src/core/middleware/__tests__/observability.test.ts` | ❌ W0 | ⬜ pending |
| {19-05-03} | 05 | 2 | CTX-02 | T-19-OBS-1 | `decideInboundTrace` — trusted-header opt-in adopts inbound traceparent as parent | unit | `bun test apps/api/src/core/middleware/__tests__/observability.test.ts` | ❌ W0 | ⬜ pending |
| {19-05-04} | 05 | 2 | TRC-01 | T-19-HTTP-1 | HTTP span named `{method} {route_template}` + http.method/http.status_code/tenant.id/user.id attrs | integration | `bun test apps/api/src/core/middleware/__tests__/observability.test.ts` | ❌ W0 | ⬜ pending |
| {19-05-05} | 05 | 2 | TRC-01 | T-19-OBS-3 | Outbound traceparent + x-request-id headers on every response (D-23 single writer in observabilityMiddleware) | integration | `bun test apps/api/src/core/middleware/__tests__/observability.test.ts` | ❌ W0 | ⬜ pending |
| {19-05-06} | 05 | 2 | CTX-02 | T-19-OBS-5 | `observabilityMiddleware` runs outside an obsContext.run frame — graceful degradation, no throw, warning logged | unit | `bun test apps/api/src/core/middleware/__tests__/observability.test.ts` | ❌ W0 | ⬜ pending |
| {19-06-01} | 06 | 3 | CTX-01 | T-19-ALS-1 | Bun.serve fetch wrapper seeds ALS per request without bleed (integration-scale) | integration | `bun test apps/api/__tests__/bun-serve-als-seed.test.ts` | ❌ W0 | ⬜ pending |
| {19-06-02} | 06 | 3 | TRC-01 | T-19-HTTP-1, T-19-OBS-3 | Full HTTP span lifecycle — Bun.serve ALS seed → observabilityMiddleware → route template span → outbound traceparent + x-request-id headers (CIDR-trusted and CIDR-untrusted paths) | integration | `bun test apps/api/__tests__/http-span-lifecycle.test.ts` | ❌ W0 | ⬜ pending |
| {19-06-03} | 06 | 3 | CTX-02 | T-19-OBS-3 | D-23 composed single-writer invariant — exactly one `x-request-id` response header when full middleware stack is mounted | integration | `bun test apps/api/__tests__/http-span-lifecycle.test.ts` | ❌ W0 | ⬜ pending |
| {19-06-04} | 06 | 3 | CTX-02 | T-19-OBS-4 | `tenantMiddleware.derive` publishes `tenantId` + `userId` into ALS via `setTenantContext` after session resolution | integration | `bun test apps/api/src/core/middleware/__tests__/tenant-als-publish.test.ts` | ❌ W0 | ⬜ pending |
| {19-07-01} | 07 | 3 | CTX-01 | T-19-ALS-4 | `createWorker` wraps every processor in `obsContext.run(jobCtx, ...)` — per-job ALS isolation | unit | `bun test packages/queue/src/__tests__/create-worker-als.test.ts` | ❌ W0 | ⬜ pending |
| {19-07-02} | 07 | 3 | TRC-02 | T-19-TRC-6 | `wrapEventBus` wired in `apps/api/src/worker.ts` — behavioral regression guard via wrapper test | unit | `bun test packages/observability/src/wrappers/__tests__/wrap-event-bus.test.ts` | ❌ W0 | ⬜ pending |
| {19-08-01} | 08 | 4 | CTX-01 | T-19-ALS-1 (enterWith bleed) | Biome GritQL rule fails on a red-path fixture containing `.enterWith(` — rule actually fires (not just registered) | lint | `bun test scripts/__tests__/enterwith-ban.test.ts` | ❌ W0 | ⬜ pending |
| {19-08-02} | 08 | 4 | CTX-01 | T-19-ALS-1 | Grep gate `scripts/lint-no-enterwith.sh` fails on any `.enterWith(` outside allow-list | lint | `bun run lint:als` | ❌ W0 | ⬜ pending |
| {19-08-03} | 08 | 4 | CTX-01 | T-19-ALS-1 | In-test grep assertion fails if `.enterWith(` lands in `packages/` or `apps/` | unit | `bun test scripts/__tests__/enterwith-ban.test.ts` | ❌ W0 | ⬜ pending |
| {19-08-04} | 08 | 4 | Success Criterion 5 | T-19-ALS-1 | 100 concurrent interleaved tenant-A/B requests: every log line carries the right tenantId | load/integration | `bun test apps/api/__tests__/observability-context-bleed.test.ts` | ❌ W0 | ⬜ pending |
| {19-08-05} | 08 | 4 | Success Criterion 5 | T-19-PERF-1 | Pino mixin perf: p99 regression ≤5% vs pre-mixin baseline (relative gate is the sole hard gate per D-28) | perf | `bun test apps/api/__tests__/observability-mixin-perf.test.ts` | ❌ W0 | ⬜ pending |
| {19-08-06} | 08 | 4 | TRC-02 | T-19-TRC-5 | `core/cqrs.ts` + `core/event-bus.ts` byte-equal vs Phase-19 baseline (SHA-256 hash guard) | assertion | `bun test apps/api/__tests__/core-invariants.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Task IDs above are placeholders; planner replaces with real task IDs emitted by the plan files.*

---

## Wave 0 Requirements

- [ ] `packages/observability/src/__tests__/context.test.ts` — stubs for CTX-01 (`obsContext.run` isolation, mutator helpers semantics) — **Plan 01**
- [ ] `packages/modules/auth/__tests__/locale-context.test.ts` — `getLocale()` post-migration reads from obsContext — **Plan 01**
- [ ] `packages/config/src/__tests__/env.test.ts` — CIDR / trusted-header env validation (crash-hard on bad CIDR) — **Plan 02**
- [ ] `apps/api/src/lib/__tests__/logger-mixin.test.ts` — pino mixin merges ALS fields per log call — **Plan 03**
- [ ] `apps/api/__tests__/logger-callsite-invariance.test.ts` — grep-based audit of logger call sites unchanged — **Plan 03**
- [ ] `packages/observability/src/wrappers/__tests__/wrap-cqrs-bus.test.ts` — extend existing suite for ALS-override assertions — **Plan 04**
- [ ] `packages/observability/src/wrappers/__tests__/wrap-event-bus.test.ts` — NEW, mirrors `wrap-cqrs-bus.test.ts` — **Plan 04**
- [ ] `apps/api/src/lib/__tests__/locale-cookie.test.ts` — cookie parser relocated from Phase 12 — **Plan 05**
- [ ] `apps/api/src/lib/__tests__/inbound-trace.test.ts` — `decideInboundTrace` trust helper (8 tests, CIDR + header + malformed + IPv6) — **Plan 05**
- [ ] `apps/api/src/core/middleware/__tests__/observability.test.ts` — span lifecycle + trust decision + outbound headers + **unseeded-frame graceful degradation (B4)** — **Plan 05**
- [ ] `apps/api/__tests__/bun-serve-als-seed.test.ts` — Bun.serve fetch wrapper ALS seed + ALS leak tests — **Plan 06**
- [ ] `apps/api/__tests__/http-span-lifecycle.test.ts` — full integration pipeline: Bun.serve ALS seed → observabilityMiddleware → route-template HTTP span → outbound headers (CIDR-trusted + CIDR-untrusted inbound-traceparent paths) + D-23 single-writer composed assertion (W3) — **Plan 06 (B3)** |
- [ ] `apps/api/src/core/middleware/__tests__/tenant-als-publish.test.ts` — tenantMiddleware publishes to ALS + request-trace reads ALS — **Plan 06**
- [ ] `packages/queue/src/__tests__/create-worker-als.test.ts` — createWorker wraps processor in obsContext.run (per-job isolation) — **Plan 07**
- [ ] `scripts/__tests__/enterwith-ban.test.ts` — in-test grep for `.enterWith(` across repo + Biome rule red-path fixture (B5) — **Plan 08**
- [ ] `scripts/lint-no-enterwith.sh` — grep-based CI gate + `lint:als` npm script wire-up — **Plan 08**
- [ ] `biome.json` — GritQL plugin registration for `no-async-local-storage-enterWith.grit` — **Plan 08**
- [ ] `packages/observability/src/__tests__/__fixtures__/enterwith-violation.ts` — Biome GritQL red-path fixture (B5) — **Plan 08**
- [ ] `apps/api/__tests__/observability-context-bleed.test.ts` — 100-RPS concurrent-tenant load assertion (Success Criterion 5) — **Plan 08**
- [ ] `apps/api/__tests__/observability-mixin-perf.test.ts` — p99 mixin-overhead harness with noop baseline — **Plan 08**
- [ ] `apps/api/__tests__/core-invariants.test.ts` — byte-equal (SHA-256) guards for `core/cqrs.ts` + `core/event-bus.ts` — **Plan 08**
- [ ] `packages/observability/package.json` — add `ipaddr.js@^2.2.0` for D-08 CIDR trust parsing — **Plan 02**

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Operator fork behavior when `OBS_TRUST_TRACEPARENT_FROM` is set to a non-loopback CIDR behind a real gateway | CTX-02 | Requires a real upstream proxy (Cloudflare / Nginx / API gateway) to inject `traceparent`; unit tests cover CIDR parsing + trust decision but not the end-to-end gateway path | 1. Configure `OBS_TRUST_TRACEPARENT_FROM=10.0.0.0/8` in staging env. 2. Curl via a gateway at `10.x.x.x` with a crafted `traceparent`. 3. Confirm Tempo/collector shows the inbound traceId as the parent on the server span. |
| Tempo/Grafana-side trace assembly of HTTP → CQRS → EventBus child spans | TRC-01, TRC-02 | Noop tracer by default; real OTEL adapter ships in Phase 21. Visual assembly verified there, not here. | Deferred to Phase 21 UAT. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 20s (quick) / 60s (full)
- [x] `nyquist_compliant: true` set in frontmatter
- [x] File paths in Per-Task Verification Map match `files_modified` of each plan (B1 + B2 resolved)
- [x] TRC-01 end-to-end pipeline covered by `http-span-lifecycle.test.ts` in Plan 06 (B3 resolved)

**Approval:** pending
