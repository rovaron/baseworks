---
phase: 05-production-hardening
reviewed: 2026-04-07T12:00:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - .dockerignore
  - .env.example
  - Dockerfile.admin
  - Dockerfile.api
  - Dockerfile.worker
  - apps/api/src/core/middleware/request-trace.ts
  - apps/api/src/index.ts
  - apps/api/src/lib/logger.ts
  - apps/api/src/worker.ts
  - apps/web/next.config.ts
  - docker-compose.yml
  - package.json
  - packages/config/src/env.ts
findings:
  critical: 2
  warning: 5
  info: 3
  total: 10
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-04-07T12:00:00Z
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

This review covers the production hardening phase: Dockerfiles, docker-compose configuration, health checks, structured logging, request tracing middleware, and environment validation. The overall structure is solid -- multi-stage Docker builds, proper env validation with Zod, graceful shutdown in the worker, and structured pino logging. However, there are two critical issues (a security concern with the hardcoded auth secret fallback in docker-compose, and a broken COPY glob in Dockerfiles), along with several warnings around missing error handling, response header timing, and a port conflict in the default configuration.

## Critical Issues

### CR-01: Hardcoded BETTER_AUTH_SECRET fallback in docker-compose.yml is insecure

**File:** `docker-compose.yml:32`
**Issue:** The `BETTER_AUTH_SECRET` uses a shell default `${BETTER_AUTH_SECRET:-development-secret-at-least-32-chars-long}` which means if the environment variable is not set, docker-compose will silently use a publicly-known secret in production mode (`NODE_ENV: production`). This is a credential that signs authentication sessions. Anyone who reads this file (it is committed to the repo) can forge sessions.
**Fix:** Remove the fallback so that docker-compose fails loudly when the secret is missing. Use a `.env` file or Docker secrets for production values:
```yaml
BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?BETTER_AUTH_SECRET is required}
```
The `:-` syntax provides a default silently; `:?` syntax causes docker-compose to error if the variable is unset, which is the correct behavior for secrets.

### CR-02: COPY glob for nested node_modules does not work as intended in Dockerfiles

**File:** `Dockerfile.api:31`
**File:** `Dockerfile.worker:31`
**Issue:** The line `COPY --from=install /app/packages/*/node_modules ./packages/` attempts to copy nested `node_modules` directories using a glob. Docker's COPY instruction does not support wildcards in the source path the same way shell globbing works. This will either fail to match or copy incorrectly, resulting in missing package-level dependencies at runtime. The destination `./packages/` is also wrong -- it would flatten the structure instead of preserving `packages/<name>/node_modules/`.
**Fix:** Copy the entire `node_modules` tree or use a more explicit approach:
```dockerfile
# Copy all node_modules (root + nested)
COPY --from=install /app/node_modules ./node_modules
COPY --from=install /app/packages/ ./packages/
```
Or, since the next COPY directive (`COPY . .`) copies the full source anyway, rely on the install stage's full `/app` directory:
```dockerfile
COPY --from=install /app/ ./
```

## Warnings

### WR-01: Request trace middleware sets X-Request-Id header after response is sent

**File:** `apps/api/src/core/middleware/request-trace.ts:34`
**Issue:** The `onAfterResponse` hook runs after the response has already been sent to the client. Setting `set.headers["x-request-id"]` at this point has no effect -- the header will not be included in the HTTP response. This means clients cannot correlate requests using the response header as documented in the middleware's JSDoc comment (line 8).
**Fix:** Move the header assignment to an `onBeforeHandle` or `onAfterHandle` hook (which fires before the response is sent), or set it in the `derive` block:
```typescript
.derive({ as: "global" }, ({ headers, set }) => {
    const requestId = headers["x-request-id"] || crypto.randomUUID();
    const log = createRequestLogger(requestId);
    const startTime = performance.now();

    // Set response header immediately so it is included in the response
    set.headers["x-request-id"] = requestId;

    return { requestId, log, startTime };
})
```

### WR-02: Worker health port conflicts with Next.js web app default port

**File:** `packages/config/src/env.ts:23`
**File:** `.env.example:16`
**Issue:** `WORKER_HEALTH_PORT` defaults to `3001`, but the web app (`WEB_URL`) also defaults to `http://localhost:3001` (in env.ts line 21) and `.env.example` sets `WEB_URL=http://localhost:3001`. If both the worker and web app run on the same host during development, there will be a port conflict.
**Fix:** Change the worker health port default to a non-conflicting port (e.g., `9090` or `3002`):
```typescript
WORKER_HEALTH_PORT: z.coerce.number().default(9090),
```
And update `.env.example` accordingly.

### WR-03: Health check endpoint exposes dependency details without authentication

**File:** `apps/api/src/index.ts:53-86`
**Issue:** The `/health` endpoint returns detailed dependency status including database and Redis latency. This information can be useful for attackers to fingerprint the infrastructure or detect when dependencies are degraded. Load balancer probes typically only need a status code, not detailed internals.
**Fix:** Split into two endpoints: a simple `/health` that returns just `{"status":"ok"}` for external probes, and a `/health/detailed` behind authentication (or an internal network check) for the detailed dependency information:
```typescript
.get("/health", () => ({ status: "ok" }))
.get("/health/detailed", async () => { /* existing detailed check logic */ })
```

### WR-04: Numerous `as any` type casts in request-trace middleware and index.ts

**File:** `apps/api/src/core/middleware/request-trace.ts:20,23,27`
**File:** `apps/api/src/index.ts:92,115`
**Issue:** Multiple `as any` casts are used to work around Elysia's type system: `startTime as number`, `log as any`, `(set as any).status`, and `ctx: any` in derive/route handlers. These suppress TypeScript's type checking and can hide real type errors. If Elysia changes its context shape, these casts will silently mask breakage.
**Fix:** Type the context properly using Elysia's type utilities. For `onAfterResponse`, the context should include the derived properties from `derive`. If Elysia's types are incomplete, create explicit interfaces rather than using `any`:
```typescript
interface TraceContext {
  requestId: string;
  log: ReturnType<typeof createRequestLogger>;
  startTime: number;
}
```

### WR-05: `assertRedisUrl` returns `redisUrl as string` even when role is "api"

**File:** `packages/config/src/env.ts:42`
**Issue:** When `role` is `"api"`, the function skips the validation check and returns `redisUrl as string`. But `redisUrl` could be `undefined` for the API role (since `REDIS_URL` is optional in env schema). The `as string` cast hides this, and callers will get `undefined` disguised as `string`.
**Fix:** Make the return type explicit about the possibility of undefined, or handle the API role case:
```typescript
export function assertRedisUrl(role: string, redisUrl?: string): string {
  if ((role === "worker" || role === "all") && !redisUrl) {
    throw new Error(
      `REDIS_URL is required when INSTANCE_ROLE is "${role}".`,
    );
  }
  if (!redisUrl) {
    throw new Error("REDIS_URL is not configured");
  }
  return redisUrl;
}
```
Or change the return type to `string | undefined` if callers are expected to handle it.

## Info

### IN-01: TypeScript build errors are ignored in Next.js config

**File:** `apps/web/next.config.ts:14-16`
**Issue:** `typescript.ignoreBuildErrors` is set to `true`. The comment explains the rationale (Eden Treaty type chain issue), but this means genuine type errors in the web app will not be caught during `next build`. This is a known trade-off documented in the comment, but worth tracking as technical debt.
**Fix:** Long-term, restructure the `@baseworks/api-client` package so its type exports do not pull in backend module dependencies, allowing type checking to be re-enabled.

### IN-02: Redis service in docker-compose has no persistence or password

**File:** `docker-compose.yml:14-16`
**Issue:** The Redis service has no volume mount (data is lost on restart) and no password protection. While acceptable for local development, this configuration should not be used in production. Consider adding a comment or a separate `docker-compose.prod.yml`.
**Fix:** Add a note or use a profile to distinguish dev from prod:
```yaml
redis:
  image: redis:7
  # WARNING: No persistence or auth -- dev only. Use managed Redis in production.
  ports:
    - "6379:6379"
```

### IN-03: `.dockerignore` excludes all `.md` files but allows `package.json`

**File:** `.dockerignore:20-21`
**Issue:** The pattern `*.md` with `!package.json` exception is slightly confusing -- `package.json` is not an `.md` file, so the exclusion does not apply to it. The intent appears to be excluding documentation while keeping necessary files, but the negation of `package.json` after `*.md` is a no-op. This is not a bug (package.json would be included anyway) but the intent is unclear.
**Fix:** Remove the `!package.json` line since it has no effect after a `*.md` exclusion rule.

---

_Reviewed: 2026-04-07T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
