# Phase 19: Context, Logging & HTTP/CQRS Tracing - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-23
**Phase:** 19-context-logging-http-cqrs-tracing
**Areas discussed:** ALS seed-and-enrich pattern, ALS module placement + traceparent trust policy, localeMiddleware enterWith resolution, HTTP/CQRS span naming + EventBus wrapping + load test shape + pino mixin + wrapCqrsBus extension

---

## Area selection

| Option | Description | Selected |
|--------|-------------|----------|
| ALS seed-and-enrich pattern | Central technique question — how to seed ALS at request entry AND enrich with tenantId/userId under the `.run()`-only invariant | ✓ |
| ALS module placement + trust policy | Packages/observability vs apps/api placement; inbound traceparent trust policy | ✓ |
| Existing enterWith in localeMiddleware | Resolve conflict between CTX-01 ban and Phase 12's locale-context.ts:66 | ✓ |
| CQRS/HTTP span naming + EventBus wrapping + load-test shape | Span naming, wrapEventBus shape, 100 RPS test harness | ✓ |

**User's choice:** All four areas selected.

---

## Area 1: ALS seed-and-enrich pattern

### Q1.1 — Pattern choice

| Option | Description | Selected |
|--------|-------------|----------|
| Bun.serve + als.run wrap | Replace app.listen with Bun.serve fetch wrapping request in obsContext.run(). Canonical Elysia+ALS pattern, minimal surface, works with .run()-only | ✓ |
| Middleware reordering (onRequest seed only) | Keep app.listen; reorder middleware so tenant runs before observability; observabilityMiddleware wraps handler chain in als.run() | |
| Custom fetch via Elysia decorator | Use Elysia's decorate/resolve API plus custom fetch decoration; hybrid of A and B | |

**User's choice:** Bun.serve + als.run wrap (Recommended)

### Q1.2 — ObservabilityContext field shape

| Option | Description | Selected |
|--------|-------------|----------|
| requestId + traceId + spanId required; tenantId/userId nullable | Explicit non-tenant state for pre-auth logs | ✓ |
| All required, default empty strings | Simpler type, but '' in logs is ambiguous | |
| Partial<T> throughout | Every consumer handles undefined | |

**User's choice:** requestId + traceId + spanId required; tenantId/userId nullable (Recommended)

### Q1.3 — Mutation API

| Option | Description | Selected |
|--------|-------------|----------|
| Typed mutator helpers: setTenant/setUser | Export setTenantContext/setSpan/setLocale; internals do getStore + mutate; searchable, auditable | ✓ |
| Direct getStore() mutation at call sites | Less indirection; mutation logic spreads across codebase | |
| Immutable re-seed via nested als.run() | Functionally clean but doubles run frames and complicates middleware | |

**User's choice:** Typed mutator helpers (Recommended)

### Q1.4 — Worker-side ALS seeding

| Option | Description | Selected |
|--------|-------------|----------|
| createWorker handles it centrally | Modify queue package's createWorker to wrap each job in obsContext.run; one surface | ✓ |
| Per-module handler wrapper | Each module's jobDef.handler wrapped at registration time | |
| Defer to Phase 20 entirely | Phase 19 ships API-side only; worker-side lands with Phase 20 traceparent extraction | |

**User's choice:** createWorker handles it centrally (Recommended)

### Q1.5 — enterWith ban enforcement in CI

| Option | Description | Selected |
|--------|-------------|----------|
| Biome lint rule + grep fallback in CI | Primary: Biome custom rule; secondary: grep CI script + in-test assertion | ✓ |
| Biome rule only | Simpler; depends on Biome custom-rule maturity | |
| ESLint + Biome parallel | Mature rule set but reintroduces duplication | |

**User's choice:** Biome lint rule + grep fallback in CI (Recommended)

---

## Area 2: ALS module placement + inbound traceparent trust policy

### Q2.1 — ALS instance location

| Option | Description | Selected |
|--------|-------------|----------|
| packages/observability/src/context.ts | Shared; wrapCqrsBus reads directly; pino mixin imports from there; no cross-package cycle | ✓ |
| apps/api/src/core/observability/context.ts (per research) | App-layer per ARCHITECTURE.md; forces wrapCqrsBus relocation or parameter-passing | |
| New packages/obs-context package | Cleanest import graph but overkill for one file | |

**User's choice:** packages/observability/src/context.ts (Recommended)

### Q2.2 — Inbound traceparent trust policy

| Option | Description | Selected |
|--------|-------------|----------|
| Honor internal, fresh trace from public | Default fresh trace; inbound attached as OTEL span link; allow-list env for internal origins | ✓ |
| Honor all inbound traceparent | Trust W3C literally; vulnerable to pollution and cardinality attacks | |
| Strip all inbound, always fresh | Safest but breaks distributed-trace continuity | |

**User's choice:** Honor internal, fresh trace from public (Recommended)

### Q2.3 — Outbound traceparent emission

| Option | Description | Selected |
|--------|-------------|----------|
| Always emit to all clients | Cheap, useful for bug reports, no PII | ✓ |
| Emit only when inbound was honored | Mirror-only; more conservative but less debuggable | |
| Only X-Request-Id, never traceparent | Simplest; forfeits distributed correlation | |

**User's choice:** Always emit to all clients (Recommended)

### Q2.4 — Trusted origin allow-list configuration

| Option | Description | Selected |
|--------|-------------|----------|
| Env-driven CIDR or header allow-list | OBS_TRUST_TRACEPARENT_FROM comma-separated CIDRs, or OBS_TRUST_TRACEPARENT_HEADER named header; validated crash-hard | ✓ |
| Hard-coded loopback trust | 127.0.0.1/localhost only; breaks container deployments | |
| Defer allow-list to future phase | Phase 19 ships strip-all; revisit later | |

**User's choice:** Env-driven CIDR or header-based allow-list (Recommended)

---

## Area 3: Existing enterWith in localeMiddleware

### Q3.1 — Reconciliation strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Unify locale into obsContext | Add locale field to ObservabilityContext; delete localeStorage + localeMiddleware; single ALS, single lint rule | ✓ |
| Refactor localeMiddleware to .run() keep separate | Same Bun.serve wrap but locale still in its own ALS instance | |
| Grandfather with biome-ignore + documented exception | Keep current code; add exception to allow-list; maintenance debt | |

**User's choice:** Unify locale into obsContext (Recommended)

### Q3.2 — getLocale() migration

| Option | Description | Selected |
|--------|-------------|----------|
| Keep getLocale() import path stable, change internals | Locale file keeps exporting getLocale; body becomes obsContext.getStore?.locale fallback; zero caller migration | ✓ |
| Move getLocale() to @baseworks/observability | Cleaner semantic; forces shim or caller edits | |
| Delete getLocale, inline at call sites | Removes indirection; couples callers to obsContext shape | |

**User's choice:** Keep getLocale() import path stable, change internals (Recommended)

### Q3.3 — Cookie-to-locale parse location

| Option | Description | Selected |
|--------|-------------|----------|
| Inside the Bun.serve fetch wrapper | One place, one parse, runs before Elysia pipeline | ✓ |
| Inside observabilityMiddleware.onRequest | Slightly later than requestId/trace seed; needs setLocale() helper | |

**User's choice:** Inside the Bun.serve fetch wrapper (Recommended)

---

## Area 4: CQRS/HTTP span naming + EventBus wrap + load test + pino mixin + wrapCqrsBus + onError

### Q4.1 — HTTP + CQRS span naming

| Option | Description | Selected |
|--------|-------------|----------|
| Generic op name + attribute | HTTP: `{method} {route_template}` with http.route/method/status_code attrs. CQRS: fixed `cqrs.command`/`cqrs.query` + attr cqrs.name. OTEL conventions. | ✓ |
| Per-command span name | CQRS: `cqrs.command.auth:create-tenant`; readable but inflates span-name index | |
| Raw command name as span name | Shadows potential future spans sharing names | |

**User's choice:** Generic op name + attribute (Recommended)

### Q4.2 — wrapEventBus shape

| Option | Description | Selected |
|--------|-------------|----------|
| Wrap emit() + on() handlers | Producer + consumer spans; silently-swallowed listener errors visible in traces | ✓ |
| Wrap emit() only | Single producer span per emit; listener errors remain invisible | |
| External emit() wrap + helper listeners opt-in | Requires touching existing listener sites | |

**User's choice:** Wrap emit() + on() handlers (Recommended)

### Q4.3 — wrapEventBus wire-up location

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror wrapCqrsBus: single call after registry.loadAll() | One line in index.ts + worker.ts right after existing wrapCqrsBus; zero core edits | ✓ |
| Wrap at registry wire-up inside ModuleRegistry | Single surface but edits core | |

**User's choice:** Mirror wrapCqrsBus: single call after registry.loadAll() (Recommended)

### Q4.4 — 100 RPS concurrent-tenant load test harness

| Option | Description | Selected |
|--------|-------------|----------|
| In-process app.handle() + parallel Promise.all | 100 concurrent mocked requests, bun test, deterministic, fast, no sidecars | ✓ |
| Spawned subprocess + autocannon/wrk | More realistic; flaky, slower, adds deps | |
| Dedicated `bun run test:load` script | Separate CI job; drifts out of default runs | |

**User's choice:** In-process app.handle() + parallel Promise.all (Recommended)

### Q4.5 — Pino mixin + child-logger interaction

| Option | Description | Selected |
|--------|-------------|----------|
| Add mixin inline in lib/logger.ts; keep all child() sites | One-line change; zero call-site edits; literal CTX-03 compliance | ✓ |
| Strip redundant child() bindings | Slightly cleaner logs; edits call sites, borderline CTX-03 | |
| Keep logger unchanged, export obsLogger separately | Violates CTX-03 — half the codebase gets trace fields | |

**User's choice:** Add mixin inline in lib/logger.ts; keep all child() call sites (Recommended)

### Q4.6 — Performance gate for the pino mixin

| Option | Description | Selected |
|--------|-------------|----------|
| Micro-bench in same load test, fail if p99 >5% | Extends bleed test; hard gate before Phase 21's dashboards | ✓ |
| No dedicated perf gate, rely on production monitoring | Cheaper now; regression ships before detection | |
| Defer bench to Phase 21 | Correctness first; perf when real stack exists | |

**User's choice:** Micro-bench in same load test, fail if p99 grows >5% vs baseline (Recommended)

### Q4.7 — wrapCqrsBus Phase 19 extension

| Option | Description | Selected |
|--------|-------------|----------|
| Internal ALS read, externally identical | Signature unchanged; body reads obsContext, opens span, sets attrs, enriches captureException | ✓ |
| Add tracer parameter | Third arg; callers update | |
| Split into wrapCqrsBusError + wrapCqrsBusTrace | Two wrappers on same bus; separation of concerns vs surface area | |

**User's choice:** Internal ALS read, externally identical (Recommended)

### Q4.8 — Elysia onError interaction with als.run() frame

| Option | Description | Selected |
|--------|-------------|----------|
| Inside | Bun.serve wrapper covers app.handle; onError runs inside ALS; Phase 18 onError capture auto-enriched | ✓ |
| Outside via a second layer | Redundant — outer fetch wrapper already covers it | |

**User's choice:** Inside (Recommended)

---

## Claude's Discretion

None captured during discussion — decisions were explicit. Downstream flexibility captured in CONTEXT.md `<decisions>` §Claude's Discretion:
- OTEL span link API usage pattern
- CIDR parser library choice
- Pino mixin closure inline vs. exported factory
- Exact Biome custom rule syntax
- Three named mutators vs. one updateObsContext helper
- Whether wrapEventBus also accepts error tracker for listener capture
- Directory naming for the new Elysia plugin file

## Deferred Ideas

- Drizzle/postgres.js DB-level spans (TRC-future-01 → Phase 21 research)
- BullMQ traceparent injection (Phase 20)
- OTEL Views + collector guardrails (Phase 21)
- Sampling strategy decision (Phase 21)
- PR-time ci.yml (deferred since Phase 18)
- OBS_SAMPLE_RATE env var (Phase 21)
- wrapEventBus error-tracker integration for listeners (revisit if incident surfaces)
- Frontend browser-side trace propagation (future frontend-observability phase)
- Tracestate header forwarding (minimal-carrier discipline)
- Baggage header propagation (future cross-service phase)
