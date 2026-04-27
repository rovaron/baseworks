/**
 * Side-effect-only module that seeds @t3-oss/env-core required vars BEFORE
 * any test-harness code imports modules that transitively load
 * `@baseworks/config` (e.g. `@baseworks/observability`, `errorMiddleware`).
 *
 * Bun hoists `import` statements within a file, so setting `process.env.X` at
 * the top of a test file does NOT help — by the time those assignments run,
 * `config.env` (which is evaluated at module-load time) has already thrown.
 * A side-effect import placed BEFORE the offending barrel imports, however,
 * runs first per ES module evaluation order.
 *
 * Mirrors `apps/api/src/core/middleware/__tests__/_env-setup.ts` shipped in
 * Phase 19; placed here under `apps/api/test/` so integration-style tests
 * (admin-bull-board, health-detailed, worker-heartbeat) share the same
 * convention.
 */

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-min-32-chars-long-xxxxxxxxxxxxxxx";
process.env.NODE_ENV ??= "test";
