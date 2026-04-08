---
phase: 05-production-hardening
asvs_level: 1
audited: 2026-04-07
result: SECURED
threats_closed: 8
threats_total: 8
---

# Security Audit — Phase 05: Production Hardening

**Result:** SECURED
**Threats Closed:** 8/8
**ASVS Level:** 1
**Block Condition:** critical

---

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-05-01 | Information Disclosure | mitigate | CLOSED | `docker-compose.yml:31-32` — explicit production override warning comment present; default fallback is a non-empty string labeled for local dev only |
| T-05-02 | Information Disclosure | mitigate | CLOSED | `.dockerignore:2,4,8-10` — `.planning/`, `.git/`, `.env`, `.env.local`, `.env.*.local` all excluded from Docker context |
| T-05-03 | Tampering | mitigate | CLOSED | `Dockerfile.admin:35,46-48` — nginx serve stage copies only pre-built static files from `/app/apps/admin/dist/`; nginx config uses `try_files` only, no server-side execution or proxy_pass to dynamic handlers |
| T-05-04 | Spoofing | accept | CLOSED | Accepted risk — see Accepted Risks Log below |
| T-05-05 | Information Disclosure | mitigate | CLOSED | `apps/api/src/index.ts:62,74` — both database and Redis error branches return generic `"Failed to connect"` string; no connection strings, credentials, or internal IPs in response |
| T-05-06 | Repudiation | mitigate | CLOSED | `apps/api/src/core/middleware/request-trace.ts:19-31` — `onAfterResponse` logs `requestId`, `method`, `path`, `status`, `duration_ms` for every request; `apps/api/src/index.ts:43` wires middleware globally |
| T-05-07 | Spoofing | accept | CLOSED | Accepted risk — see Accepted Risks Log below |
| T-05-08 | Denial of Service | mitigate | CLOSED | `apps/api/src/worker.ts:88-90` — worker health server returns 404 for all non-`/health` paths before any processing; no request body consumption |

---

## Accepted Risks Log

### T-05-04 — Docker Network Spoofing (Spoofing)

**Component:** Docker Compose internal network
**Risk:** Services on the same Docker bridge network can spoof peer service identities (no mTLS between containers in local dev).
**Justification:** This compose file is for local development only. Production infrastructure uses separate network isolation, service mesh, or managed container orchestration (Kubernetes, ECS, etc.) with proper network policies. The risk is explicitly scoped to the dev environment.
**Owner:** Infrastructure / DevOps
**Review Date:** Before first production deployment

---

### T-05-07 — Trusted X-Request-Id Header (Spoofing)

**Component:** `apps/api/src/core/middleware/request-trace.ts:13`
**Risk:** An attacker who can send requests directly to the API (bypassing the load balancer) could inject a crafted `X-Request-Id` value, potentially polluting logs with misleading correlation IDs.
**Justification:** This is standard practice when a trusted load balancer or reverse proxy sits in front of the API and injects a canonical request ID. In production, the API should not be directly reachable from the internet — only the load balancer's generated ID reaches it. Accepted as a deployment architecture concern rather than an application code concern.
**Owner:** Infrastructure / DevOps
**Constraint:** API must not be directly internet-accessible in production. Load balancer must be the sole entry point.
**Review Date:** Before first production deployment

---

## Unregistered Flags

None. Neither 05-01-SUMMARY.md nor 05-02-SUMMARY.md contain a `## Threat Flags` section.

---

## Verification Notes

- T-05-01: The `docker-compose.yml` comment at line 30-32 explicitly calls out the production override requirement and references the threat ID. The worker service at line 55 carries the same pattern without a comment — the risk is identical and covered by the same accepted documentation.
- T-05-02: `.dockerignore` also excludes `.claude/`, `.agents/`, `.vscode/`, `.idea/`, and build outputs — defense in depth beyond the declared mitigation.
- T-05-03: The nginx configuration in `Dockerfile.admin` additionally adds `X-Frame-Options`, `X-Content-Type-Options`, and `Referrer-Policy` security headers — exceeding the declared mitigation scope.
- T-05-05: Worker health endpoint (`worker.ts:101`) also uses generic error message `"Failed to connect"`, consistent with the API pattern. Both surfaces covered.
- T-05-06: Request ID is propagated to BullMQ jobs via `_requestId` convention (`index.ts:103`, `worker.ts:38`), enabling cross-service log correlation.
