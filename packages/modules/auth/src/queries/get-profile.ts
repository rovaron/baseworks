import { Type } from "@sinclair/typebox";
import { defineQuery, ok, err } from "@baseworks/shared";
import { createDb, user as userTable } from "@baseworks/db";
import { eq } from "drizzle-orm";
import { env } from "@baseworks/config";

const GetProfileInput = Type.Object({});

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
 * per call (no I/O, no reconnect -- the postgres pool created by
 * `createDb` is still cached inside the dynamically-imported
 * module's closure).
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

    const db = resolvedCreateDb(resolvedEnv.DATABASE_URL);

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
