---
phase: 19
slug: context-logging-http-cqrs-tracing
status: verified
threats_open: 0
asvs_level: 1
created: 2026-04-24
---

# Phase 19 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Inbound HTTP (Bun.serve) | External clients → API process. ALS frame seeded once per request inside the Bun.serve fetch wrapper. | requestId (UUID), traceparent (W3C header, CIDR-gated) |
| CQRS bus (wrapCqrsBus) | HTTP handler → command/query handlers. External wrapper; core/cqrs.ts unmodified. | ObservabilityContext propagated via ALS |
| Event bus (wrapEventBus) | Application code → event listeners. External wrapper; core/event-bus.ts unmodified. | ObservabilityContext propagated via ALS |
| BullMQ worker (createWorker) | Redis queue → job processor. ALS frame seeded once per job inside wrapProcessorWithAls. | requestId (from job.data._requestId or fresh UUID), locale (defaultLocale), tenantId/userId (null — handler responsibility) |
| Biome lint gate | Developer workstation / CI → codebase. GritQL rule prevents enterWith from being introduced. | Static analysis only |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation / Evidence | Status |
|-----------|----------|-----------|-------------|----------------------|--------|
| T-19-ALS-1 | Tampering | packages/observability/src/context.ts, src/index.ts | mitigate | enterWith not present in context.ts or index.ts (grep confirmed 0 matches); Biome GritQL rule `no-async-local-storage-enterWith` enforced | closed |
| T-19-ALS-2 | Tampering | packages/observability/src/context.ts (mutators) | accept | Internal-trust: mutators (setTenantContext, setSpan, setLocale) write in place by design; all callers are internal to the observability package. See Accepted Risks Log. | closed |
| T-19-ALS-3 | Information Disclosure | apps/api/src/lib/logger.ts | mitigate | Pitfall 4 stale closure prevented: verbatim `mixin: () => obsContext.getStore() ?? {}` at logger.ts:14 (grep confirmed) | closed |
| T-19-ALS-4 | Information Disclosure | packages/queue/src/index.ts | mitigate | Cross-job ALS bleed prevented by wrapProcessorWithAls wrapping every job in a fresh obsContext.run frame; confirmed by 9/9 queue tests | closed |
| T-19-ALS-5 | Tampering | BullMQ worker callsites | accept | Callers that construct Worker directly (bypassing createWorker) get no ALS frame. Convention documented; no current bypasses in codebase. See Accepted Risks Log. | closed |
| T-19-ALS-6 | Tampering | .biome/plugins/no-als-enter-with.grit | mitigate | Developer biome-ignore bypass prevented by CI lint gate (`scripts/lint-no-enterwith.sh` exit 0); B5 red-path fixture confirms rule fires with rule id `no-async-local-storage-enterWith` | closed |
| T-19-OBS-1 | Spoofing | apps/api/src/lib/inbound-trace.ts | mitigate | CIDR trust policy: traceparent accepted only from IP ranges in OBS_TRUST_TRACEPARENT_FROM; TCP peer IP via server.requestIP (not XFF); ipaddr.parseCIDR at inbound-trace.ts:35 (grep confirmed) | closed |
| T-19-OBS-2 [19-01/03] | Information Disclosure | packages/observability/src/context.ts | mitigate | ObservabilityContext restricted to IDs (requestId, traceId, spanId) + locale, tenantId, userId — no raw PII fields exported | closed |
| T-19-OBS-2 [19-08] | Information Disclosure | apps/api/__tests__/observability-context-bleed.test.ts | accept | Synthetic PII used in bleed test assertions (test-only, never leaves test process). See Accepted Risks Log. | closed |
| T-19-OBS-3 [19-03] | Information Disclosure | apps/api/src/lib/logger.ts | accept | Startup logs emitted outside any ALS frame (server start, migration, shutdown); mixin returns {} cleanly (no crash, no leaked context). See Accepted Risks Log. | closed |
| T-19-OBS-3 [19-06] | Tampering | apps/api/src/core/middleware/request-trace.ts | mitigate | Double-writer x-request-id eliminated: request-trace.ts contains no x-request-id string literal (byte-level test at tenant-als-publish.test.ts:91 confirms); single writer is observabilityMiddleware | closed |
| T-19-OBS-4 | Information Disclosure | apps/api/src/core/middleware/observability.ts | mitigate | tenant.id set on span only after session resolution: `if (store.tenantId) obsSpan.setAttribute("tenant.id", store.tenantId)` at observability.ts:140 (grep confirmed) | closed |
| T-19-OBS-5 | Denial of Service | apps/api/src/core/middleware/observability.ts | mitigate | B4 fail-closed: 4 `if (!store)` guards present in observability.ts; 0 non-null assertions (grep confirmed) | closed |
| T-19-ENV-1 | Denial of Service | apps/api/src/lib/env.ts | accept | Crash-hard on missing/invalid OBS_* env vars at startup is the correct behavior (fail-fast, not silent misconfiguration). See Accepted Risks Log. | closed |
| T-19-CIDR-1 | Spoofing | apps/api/src/lib/env.ts | transfer | Operator responsibility: semantic tightness of OBS_TRUST_TRACEPARENT_FROM CIDR ranges is an operational concern, not a code control. Documented in DOC-04 runbook (Phase 23). | closed |
| T-19-CIDR-2 | Spoofing | apps/api/src/lib/inbound-trace.ts | mitigate | XFF injection prevented: trust decision uses TCP peer IP from server.requestIP(req)?.address, not X-Forwarded-For header | closed |
| T-19-HTTP-1 | Information Disclosure | apps/api/src/core/middleware/observability.ts | mitigate | High-cardinality span names prevented: http.route uses route template (set in onBeforeHandle after Elysia route resolution), not raw URL path; A1/A8 route-template gate PASSED | closed |
| T-19-HTTP-2 | Information Disclosure | apps/api/src/core/middleware/observability.ts | mitigate | tenant/user not set on pre-auth spans: setAttribute for tenant.id is conditional on store.tenantId (post-session-resolution only); no userId written to spans at all | closed |
| T-19-HTTP-3 | Tampering | apps/api/src/core/middleware/observability.ts | mitigate | Single x-request-id writer invariant (D-23): only observabilityMiddleware writes x-request-id; request-trace.ts writer deleted | closed |
| T-19-MID-1 | Tampering | apps/api/src/index.ts | mitigate | Middleware order regression prevented: errorMiddleware → observabilityMiddleware → requestTraceMiddleware confirmed at index.ts:73-78 (grep confirmed) | closed |
| T-19-TRC-1 | Repudiation | packages/observability/src/wrappers/wrap-cqrs-bus.ts | mitigate | span.recordException called before tracker.captureException at lines 80+121 (grep confirmed); error always recorded to trace even if tracker fails | closed |
| T-19-TRC-2 | Information Disclosure | packages/observability/src/wrappers/wrap-cqrs-bus.ts | mitigate | Fixed span names cqrs.command and cqrs.query at lines 72+115 (grep confirmed); no per-command cardinality explosion | closed |
| T-19-TRC-3 | Repudiation | packages/observability/src/wrappers/wrap-event-bus.ts | mitigate | Listener errors recorded via span status; obsContext.getStore() called defensively at wrap-event-bus.ts:61+90 (grep confirmed) | closed |
| T-19-TRC-4 | Denial of Service | packages/observability/src/wrappers/wrap-event-bus.ts | mitigate | No tracker/captureException in wrapEventBus (Pitfall 6 avoided): grep of wrap-event-bus.ts for captureException/tracker → 0 matches | closed |
| T-19-TRC-5 | Tampering | apps/api/src/core/cqrs.ts | mitigate | Zero edits to core/cqrs.ts: no observability imports present (grep confirmed); SHA-256 baseline locked at 89a47de8ad2894d615a4b98de7dd9e84262cf1f68a827d2650f811a68bf1e449; git diff 6ad0932..HEAD empty | closed |
| T-19-TRC-6 | Repudiation | apps/api/src/worker.ts | mitigate | Worker EventBus tracing: wrapEventBus(registry.getEventBus(), getTracer()) at worker.ts:46 (grep confirmed, 2 matches: import + call) | closed |
| T-19-TRC-7 | Tampering | apps/api/src/core/event-bus.ts | mitigate | Zero edits to core/event-bus.ts: no observability imports present (grep confirmed); SHA-256 baseline locked at 19dfe7b51653dcfd3f1fa2b1c4df2527fcb56ec310a3adb3357ba9d616456604; git diff 6ad0932..HEAD empty | closed |
| T-19-PERF-1 | Denial of Service | apps/api/src/lib/logger.ts + obsContext | mitigate | Mixin overhead ≤3.0× median ratio gate (W2 override from plan's 5% relative): 100-RPS bleed test shows ratio 2.15–2.33×, gate passed | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-19-01 | T-19-ALS-2 | Mutators (setTenantContext, setSpan, setLocale) write ALS store in place by design. All callers are internal to @baseworks/observability. Mutating a live ALS store is the intended API for post-seed context enrichment (e.g., tenant resolution after session middleware). No external caller can construct a mutator directly. | Phase 19 plan 19-01 | 2026-04-24 |
| AR-19-02 | T-19-ALS-5 | BullMQ Workers constructed outside createWorker (e.g., direct `new Worker(...)` calls) receive no ALS frame. No such bypasses exist in the current codebase. Any new queue consumer MUST use createWorker per the convention documented in packages/queue/src/index.ts JSDoc. | Phase 19 plan 19-07 | 2026-04-24 |
| AR-19-03 | T-19-ENV-1 | OBS_* environment variables crash the process on missing or invalid values at startup. This fail-fast behavior is intentional: a misconfigured observability stack is worse than a failing start (silent misconfiguration leads to invisible data loss). | Phase 19 plan 19-02 | 2026-04-24 |
| AR-19-04 | T-19-OBS-3 [19-03] | Logs emitted outside any ALS frame (server startup, migration runs, graceful shutdown) carry no requestId/traceId. The pino mixin returns `{}` safely (no crash). These logs are low-cardinality operational events where trace context is not meaningful. | Phase 19 plan 19-03 | 2026-04-24 |
| AR-19-05 | T-19-OBS-2 [19-08] | The 100-RPS bleed test (D-27) uses synthetic requestId strings resembling PII (e.g., "tenant-A-req-N") for cross-tenant isolation assertions. These values never leave the test process. Test file: apps/api/__tests__/observability-context-bleed.test.ts. | Phase 19 plan 19-08 | 2026-04-24 |
| AR-19-ERR-X | T-19-ERR-X (unregistered) | Under D-22 middleware order (errorMiddleware first), composed-stack onError handlers chained after observabilityMiddleware may not fire if errorMiddleware short-circuits. This is an architectural concern deferred to a future phase. Accepted as override in 19-VERIFICATION.md; no exploit vector within Phase 19 scope. | 19-VERIFICATION.md override | 2026-04-24 |

*Accepted risks do not resurface in future audit runs.*

---

## Unregistered Threat Flags

| Flag ID | Source | Description | Disposition |
|---------|--------|-------------|-------------|
| T-19-ERR-X | 19-06-SUMMARY ## Threat Flags | Composed-stack onError chain may halt under D-22 errorMiddleware-first order; observabilityMiddleware onError handlers may not fire if errorMiddleware handles and short-circuits | Accepted override in 19-VERIFICATION.md; deferred architectural fix; no exploit vector in Phase 19 scope |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-04-24 | 28 | 28 | 0 | gsd-security-auditor (claude-sonnet-4-6) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-04-24
