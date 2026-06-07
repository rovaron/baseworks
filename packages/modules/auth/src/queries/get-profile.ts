import { Type } from "@sinclair/typebox";
import { defineQuery, ok, err } from "@baseworks/shared";
import { createDb, user as userTable } from "@baseworks/db";
import { eq } from "drizzle-orm";
import { env } from "@baseworks/config";

const GetProfileInput = Type.Object({});

// Memoized db instance shared across calls. `createDb` opens a new
// postgres.js pool every time, so without this each profile read
// would leak a pool. Resolved via the dynamic import below (kept for
// test-mock isolation) and cached here on first use.
let cachedDb: ReturnType<typeof createDb> | undefined;

/**
 * Retrieve the authenticated user's profile by ctx.userId.
 *
 * Uses a direct DB query against the user table instead of
 * auth.api.getSession (which requires request headers and
 * would return null with empty Headers). Only selected columns
 * are exposed -- no password hash.
 *
 * Implementation note (test isolation): the DB connection, the
 * `userTable` schema reference, and `eq` from `drizzle-orm` are
 * all resolved lazily inside the handler body rather than at
 * module-evaluation time. Bun's `mock.module(...)` replaces the
 * module record that subsequent `import(...)` calls resolve, but
 * it does NOT re-run the already-evaluated top-level of a cached
 * module. If `../index` has been imported earlier in the process
 * (e.g. by `auth-setup.test.ts`), the real implementations were
 * captured by any top-level bindings, making partial mocks from
 * a later test file ineffective and causing a "Maximum call stack
 * size exceeded" inside drizzle's query builder (because
 * `drizzle-orm` is replaced with a stub that only exports `eq`).
 * Resolving these symbols at call time via dynamic `import(...)`
 * causes Bun's mock registry to be consulted on every invocation,
 * so the test-provided mocks apply deterministically regardless
 * of module-cache state.
 *
 * In production this adds only a single module-registry lookup
 * per call (no I/O, no reconnect). `createDb` itself is NOT cached
 * by `@baseworks/db` -- it opens a fresh postgres.js pool on every
 * invocation -- so we memoize the resolved db instance at module
 * scope (`cachedDb` below) to ensure a single shared pool per
 * process. The dynamic import is preserved purely for test-mock
 * resolution; the memoized instance is whatever `createDb` returns
 * (the test mock returns a stable stub, so caching is compatible).
 *
 * @param input - GetProfileInput (empty object)
 * @param ctx   - Handler context: userId (required for query),
 *   db is unused (direct DB connection for auth tables)
 * @returns Result<UserProfile> -- id, name, email, image,
 *   emailVerified, createdAt; or err if not authenticated
 *
 * Per T-02-14: Only selected columns exposed -- no password
 * hash.
 * Per D-17: Profile read via auth module query.
 */
export const getProfile = defineQuery(GetProfileInput, async (_input, ctx) => {
  if (!ctx.userId) return err("Not authenticated");

  try {
    // Resolve dependencies dynamically so Bun's module-mock registry
    // is consulted at call time. See the module-level JSDoc above.
    const [dbMod, drizzleMod, envMod] = await Promise.all([
      import("@baseworks/db"),
      import("drizzle-orm"),
      import("@baseworks/config"),
    ]);
    const { createDb: resolvedCreateDb, user: resolvedUserTable } = dbMod;
    const { eq: resolvedEq } = drizzleMod;
    const { env: resolvedEnv } = envMod;

    if (!cachedDb) cachedDb = resolvedCreateDb(resolvedEnv.DATABASE_URL);
    const db = cachedDb;

    const users = await db
      .select({
        id: resolvedUserTable.id,
        name: resolvedUserTable.name,
        email: resolvedUserTable.email,
        image: resolvedUserTable.image,
        emailVerified: resolvedUserTable.emailVerified,
        createdAt: resolvedUserTable.createdAt,
      })
      .from(resolvedUserTable)
      .where(resolvedEq(resolvedUserTable.id, ctx.userId))
      .limit(1);

    if (!users.length) return err("User not found");
    return ok(users[0]);
  } catch (error: any) {
    return err(error.message || "Failed to get profile");
  }
});

// Silence unused-import warnings for the top-level bindings kept for
// public API type surface (callers type-check against these re-exports).
void createDb;
void userTable;
void eq;
void env;
