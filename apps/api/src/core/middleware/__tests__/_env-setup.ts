/**
 * Side-effect-only module that sets minimum required env vars for
 * @t3-oss/env-core before any test-harness code imports the
 * `@baseworks/observability` barrel (which transitively loads
 * `@baseworks/config`).
 *
 * Bun hoists `import` statements within a file, so setting
 * `process.env.X` at the top of a test file does not help — by the time
 * that assignment runs, `config.env` has already been evaluated. A
 * side-effect import placed BEFORE the barrel import, however, runs
 * before the barrel's module evaluation.
 *
 * Values are safe test-only placeholders; the real values come from
 * `.env` in non-test contexts.
 */

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??=
  "test-secret-32-chars-long-test-ok-xx";
process.env.NODE_ENV ??= "test";
