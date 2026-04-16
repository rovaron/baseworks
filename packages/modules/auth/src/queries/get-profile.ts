import { Type } from "@sinclair/typebox";
import { defineQuery, ok, err } from "@baseworks/shared";
import { createDb, user as userTable } from "@baseworks/db";
import { eq } from "drizzle-orm";
import { env } from "@baseworks/config";

/**
 * Raw DB connection for querying auth tables directly.
 * Auth tables are NOT tenant-scoped (Pitfall 6), so we use
 * a direct DB connection rather than ctx.db (scopedDb).
 */
const db = createDb(env.DATABASE_URL);

const GetProfileInput = Type.Object({});

/**
 * Retrieve the authenticated user's profile by ctx.userId.
 *
 * Uses a direct DB query against the user table instead of
 * auth.api.getSession (which requires request headers and
 * would return null with empty Headers). Only selected columns
 * are exposed -- no password hash.
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
    const users = await db
      .select({
        id: userTable.id,
        name: userTable.name,
        email: userTable.email,
        image: userTable.image,
        emailVerified: userTable.emailVerified,
        createdAt: userTable.createdAt,
      })
      .from(userTable)
      .where(eq(userTable.id, ctx.userId))
      .limit(1);

    if (!users.length) return err("User not found");
    return ok(users[0]);
  } catch (error: any) {
    return err(error.message || "Failed to get profile");
  }
});
