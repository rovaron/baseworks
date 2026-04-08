# Phase 5: Production Hardening - Discussion Log (Assumptions Mode)

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the analysis.

**Date:** 2026-04-07
**Phase:** 05-production-hardening
**Mode:** assumptions (--auto)
**Areas analyzed:** Docker Build Strategy, Health Check Endpoints, Structured Logging, Vercel Deployment

## Assumptions Presented

### Docker Build Strategy
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| Use `oven/bun` Docker image (Elysia is Bun-only) | Confident | apps/api/package.json (elysia ^1.4.0), package.json (bun workspaces) |
| Copy entire monorepo for workspace resolution | Confident | 5+ workspace:* deps in apps/api/package.json, no bundle step |
| Three Dockerfiles: API, worker, admin | Confident | Separate entrypoints in apps/api/src/index.ts and worker.ts |

### Health Check Endpoints
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| Enhance /health with DB+Redis checks (unauthenticated) | Likely | Current /health at index.ts:48-51 has no dependency checks |
| Add HTTP health server to worker process | Likely | worker.ts has no HTTP listener |

### Structured Logging
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| Add request-tracing Elysia middleware | Likely | logger.ts exists but no request middleware found |
| Propagate request IDs to BullMQ jobs | Likely | No correlation mechanism exists currently |

### Vercel Deployment
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| Default Vercel output mode (no standalone) | Likely | next.config.ts has no output setting, Vercel-targeted |

## Corrections Made

No corrections — all assumptions auto-confirmed (--auto mode).

## Auto-Resolved

- Health check strategy: auto-selected "Enhance existing /health + add worker HTTP server"
- Logging approach: auto-selected "Elysia onRequest/onAfterResponse middleware with request ID"
- Vercel config: auto-selected "Default output mode, document env vars"
