# Phase 5: Production Hardening - Context

**Gathered:** 2026-04-07 (assumptions mode)
**Status:** Ready for planning
**Mode:** Auto (Claude picked recommended defaults)

<domain>
## Phase Boundary

Make the entire stack deployable: Docker containers for backend services (API server, worker, admin dashboard), Vercel deployment for the Next.js customer app, structured JSON logging with request tracing, and health check endpoints that report dependency status for infrastructure probes.

</domain>

<decisions>
## Implementation Decisions

### Docker Build Strategy
- **D-01:** Use `oven/bun` as the base Docker image — Elysia is Bun-only, all entrypoints use `bun run`, no Node.js compatibility path exists.
- **D-02:** Copy the entire monorepo into Docker and install all workspace dependencies — Bun workspaces resolve `workspace:*` references, and there is no standalone bundle step for API or worker. Per-package isolation is not feasible.
- **D-03:** Create three Dockerfiles: `Dockerfile.api` (API server), `Dockerfile.worker` (BullMQ worker), `Dockerfile.admin` (Vite admin dashboard built and served via static file server). All use multi-stage builds to minimize image size.
- **D-04:** Docker Compose for local dev orchestrates: PostgreSQL, Redis, API server, worker, and admin dashboard. The Next.js app runs on Vercel (or `bun run dev:web` locally), not in Docker.

### Health Check Endpoints
- **D-05:** Enhance the existing `/health` endpoint to include database and Redis connectivity checks — unauthenticated, suitable for Docker HEALTHCHECK and load balancer probes. Keep the existing authenticated `/api/admin/system/health` for detailed admin monitoring.
- **D-06:** Add a lightweight HTTP server to the worker process for health checks — expose `/health` with BullMQ queue status and Redis connectivity. This is needed because the worker currently has no HTTP listener.
- **D-07:** Follow liveness/readiness probe pattern: `/health` returns basic status (liveness), dependency checks included in the response body for readiness decisions.

### Structured Logging
- **D-08:** Keep the existing pino logger configuration (JSON in production, pino-pretty in development). Add request-tracing middleware to Elysia that generates a request ID (via `crypto.randomUUID()`), creates a pino child logger per request, and logs method, path, status, and duration on response.
- **D-09:** Propagate request IDs to BullMQ jobs when jobs are triggered by API calls — enables correlating API request logs with worker job logs.

### Vercel Deployment
- **D-10:** Keep the default Vercel output mode (no `output: "standalone"`) — the Next.js app specifically targets Vercel. Document required environment variables (`NEXT_PUBLIC_API_URL` pointing to deployed API).
- **D-11:** Add a `vercel.json` only if needed for custom configuration (rewrites, headers). If default Next.js Vercel deployment works, skip it — zero-config is the goal per OPS-05.

### Claude's Discretion
- Multi-stage Docker build specifics (layer caching, .dockerignore contents)
- Exact health check response format (JSON shape)
- Whether to add a `/ready` endpoint separate from `/health` or combine them
- Worker HTTP server port choice
- Request ID header name (`X-Request-Id` vs `X-Trace-Id`)
- Whether to add `output: "standalone"` for future Docker deployment of Next.js (not required by OPS-05)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Configuration
- `CLAUDE.md` — Technology stack (Bun, Elysia, pino, Docker, Vercel), version matrix, constraints
- `.planning/PROJECT.md` — Core value, constraints (Bun runtime, deployment split: Vercel + VPS/Docker)
- `.planning/REQUIREMENTS.md` — OPS-01 through OPS-05

### Backend Entry Points
- `apps/api/src/index.ts` — API server entry, current `/health` endpoint (line 48-51), CORS config, module loading
- `apps/api/src/worker.ts` — Worker entry point (no HTTP server currently)
- `apps/api/src/lib/logger.ts` — Existing pino logger configuration

### Middleware & Routes
- `apps/api/src/core/middleware/error.ts` — Error middleware (uses logger)
- `apps/api/src/core/middleware/tenant.ts` — Tenant middleware
- `apps/api/src/routes/admin.ts` — Admin system health endpoint (authenticated, lines 321-349)

### Frontend Configuration
- `apps/web/next.config.ts` — Next.js config (transpilePackages, no output mode set)
- `apps/web/.env.local` — Frontend env vars (NEXT_PUBLIC_API_URL, NEXT_PUBLIC_APP_URL)
- `apps/admin/vite.config.ts` — Vite admin build config

### Environment & Config
- `packages/config/src/env.ts` — Environment validation (PORT, DATABASE_URL, REDIS_URL, etc.)
- `.env.example` — All required environment variables documented

### Root Configuration
- `package.json` — Workspace config, dev scripts (dev:web, dev:admin, build:web, build:admin)
- `docker-compose.yml` — May already exist for PostgreSQL/Redis (check)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/api/src/lib/logger.ts` — Pino logger already configured for JSON (prod) and pretty (dev)
- `apps/api/src/index.ts` `/health` endpoint — Basic health check exists, needs enhancement
- `apps/api/src/routes/admin.ts` `/api/admin/system/health` — Detailed health with Redis check (authenticated)
- `packages/config/src/env.ts` — All env vars validated, serves as source of truth for Docker ENV declarations
- `.env.example` — Documents required vars for Docker/Vercel config

### Established Patterns
- Workspace packages at `packages/<name>/` with `@baseworks/<name>` aliases — Docker must preserve this structure
- Bun runs TypeScript directly — no build step needed for API/worker containers
- Admin dashboard has `build:admin` script — produces static files suitable for nginx/serve
- Module registry pattern — health checks should report per-module status

### Integration Points
- `apps/api/src/index.ts` — Add request-tracing middleware before routes
- `apps/api/src/worker.ts` — Add HTTP health server alongside BullMQ workers
- `apps/web/next.config.ts` — May need Vercel-specific settings
- Root `package.json` — Add Docker-related scripts
- `docker-compose.yml` — Exists for dev DB/Redis, extend with app services

</code_context>

<specifics>
## Specific Ideas

- The worker health endpoint should report queue depth and connection status — not just "ok"
- Request ID propagation to jobs enables end-to-end tracing without a full observability stack
- Docker images should be as small as possible — Bun's Docker image is already lean, but multi-stage builds help
- The `.dockerignore` should exclude `.planning/`, `node_modules/`, `.next/`, and other dev artifacts

</specifics>

<deferred>
## Deferred Ideas

- CI/CD pipeline (GitHub Actions) — PLAT-02 in v2 requirements
- Rate limiting — PLAT-01 in v2 requirements
- Seed data and one-command dev setup — PLAT-03 in v2 requirements
- Full observability stack (OpenTelemetry, distributed tracing) — overkill for a starter kit
- Kubernetes manifests / Helm charts — Docker Compose is sufficient for v1
- Docker deployment of Next.js app — only Vercel required per OPS-05

</deferred>

---

*Phase: 05-production-hardening*
*Context gathered: 2026-04-07*
*Mode: --auto (non-interactive)*
