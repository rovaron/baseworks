import { Elysia, t } from "elysia";
import { getDb, organization, user, member, billingCustomers } from "@baseworks/db";
import { env } from "@baseworks/config";
import { requirePlatformAdmin } from "@baseworks/module-auth";
import { getRedisConnection } from "@baseworks/queue";
import { eq, like, or, count, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

/** Escape LIKE meta-characters to prevent search injection. */
function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, (c) => "\\" + c);
}

/**
 * Safely parse a stored metadata JSON string. Returns null on malformed JSON so
 * a single corrupt row degrades gracefully instead of 500-ing the whole listing.
 */
function safeParseMetadata(raw: string | null, tenantId?: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    logger.warn({ tenantId }, "Failed to parse tenant metadata; returning null");
    return null;
  }
}

/**
 * Admin API routes for cross-tenant operations.
 *
 * Per D-16: These routes use raw db (not scopedDb) for cross-tenant queries.
 * Per T-4-01: All routes protected by requirePlatformAdmin() (operator-scope,
 *   distinct from per-organization "owner" — see finding authz-admin-owner-role-escalation).
 * Per T-4-03: User queries omit password hashes (select only safe fields).
 */

const db = getDb(env.DATABASE_URL);

export const adminRoutes = new Elysia({ prefix: "/api/admin" })
  .use(requirePlatformAdmin())

  // --- Tenant Management ---
  .get("/tenants", async (ctx: any) => {
    const limit = Number(ctx.query?.limit) || 20;
    const offset = Number(ctx.query?.offset) || 0;
    const search = ctx.query?.search as string | undefined;

    let query = db
      .select()
      .from(organization);

    if (search) {
      const sanitized = escapeLike(search);
      query = query.where(
        or(
          like(organization.name, `%${sanitized}%`),
          like(organization.slug, `%${sanitized}%`),
        ),
      ) as typeof query;
    }

    // Count query for pagination (same filters, no limit/offset)
    let countQuery = db.select({ count: count() }).from(organization);
    if (search) {
      const sanitized = escapeLike(search);
      countQuery = countQuery.where(
        or(
          like(organization.name, `%${sanitized}%`),
          like(organization.slug, `%${sanitized}%`),
        ),
      ) as typeof countQuery;
    }

    const [tenants, [totalResult]] = await Promise.all([
      query.limit(limit).offset(offset),
      countQuery,
    ]);

    return {
      data: tenants.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        createdAt: t.createdAt,
        metadata: safeParseMetadata(t.metadata, t.id),
      })),
      total: totalResult?.count ?? 0,
    };
  })

  .get("/tenants/:id", async (ctx: any) => {
    const [tenant] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, ctx.params.id))
      .limit(1);

    if (!tenant) {
      ctx.set.status = 404;
      return { success: false, error: "TENANT_NOT_FOUND" };
    }

    const memberCount = await db
      .select({ count: count() })
      .from(member)
      .where(eq(member.organizationId, ctx.params.id));

    return {
      data: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        logo: tenant.logo,
        createdAt: tenant.createdAt,
        metadata: safeParseMetadata(tenant.metadata, tenant.id),
        memberCount: memberCount[0]?.count ?? 0,
      },
    };
  })

  .patch("/tenants/:id", async (ctx) => {
    const [tenant] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, ctx.params.id))
      .limit(1);

    if (!tenant) {
      ctx.set.status = 404;
      return { success: false, error: "TENANT_NOT_FOUND" };
    }

    await db
      .update(organization)
      .set({ metadata: JSON.stringify(ctx.body.metadata) })
      .where(eq(organization.id, ctx.params.id));

    return { success: true };
  }, {
    body: t.Object({
      metadata: t.Record(t.String(), t.Any()),
    }),
  })

  // --- User Management ---
  // Per T-4-03: Only select safe fields (no password hashes)
  .get("/users", async (ctx: any) => {
    const limit = Number(ctx.query?.limit) || 20;
    const offset = Number(ctx.query?.offset) || 0;
    const search = ctx.query?.search as string | undefined;

    let query = db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        createdAt: user.createdAt,
      })
      .from(user);

    if (search) {
      const sanitized = escapeLike(search);
      query = query.where(
        or(
          like(user.name, `%${sanitized}%`),
          like(user.email, `%${sanitized}%`),
        ),
      ) as typeof query;
    }

    // Count query for pagination (same filters, no limit/offset)
    let userCountQuery = db.select({ count: count() }).from(user);
    if (search) {
      const sanitized = escapeLike(search);
      userCountQuery = userCountQuery.where(
        or(
          like(user.name, `%${sanitized}%`),
          like(user.email, `%${sanitized}%`),
        ),
      ) as typeof userCountQuery;
    }

    const [users, [userTotalResult]] = await Promise.all([
      query.limit(limit).offset(offset),
      userCountQuery,
    ]);

    return { data: users, total: userTotalResult?.count ?? 0 };
  })

  .get("/users/:id", async (ctx: any) => {
    const [foundUser] = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        createdAt: user.createdAt,
      })
      .from(user)
      .where(eq(user.id, ctx.params.id))
      .limit(1);

    if (!foundUser) {
      ctx.set.status = 404;
      return { success: false, error: "USER_NOT_FOUND" };
    }

    // Get user's organization memberships
    const memberships = await db
      .select({
        organizationId: member.organizationId,
        role: member.role,
        orgName: organization.name,
        orgSlug: organization.slug,
      })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(eq(member.userId, ctx.params.id));

    return {
      data: {
        ...foundUser,
        memberships,
      },
    };
  })

  .patch("/users/:id", async (ctx) => {
    const [foundUser] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, ctx.params.id))
      .limit(1);

    if (!foundUser) {
      ctx.set.status = 404;
      return { success: false, error: "USER_NOT_FOUND" };
    }

    // TODO: better-auth user table does not have a banned column by default.
    // Implement via better-auth admin plugin or a custom banned column.
    logger.info(
      { targetUserId: ctx.params.id, banned: ctx.body.banned, reason: ctx.body.banReason },
      "Admin user ban/unban action (not yet implemented)",
    );

    ctx.set.status = 501;
    return { success: false, error: "NOT_IMPLEMENTED", message: "User ban/unban is not yet implemented" };
  }, {
    body: t.Object({
      banned: t.Boolean(),
      banReason: t.Optional(t.String()),
    }),
  })

  // Per T-4-05: Log impersonation events with admin and target user IDs
  .post("/users/:id/impersonate", async (ctx: any) => {
    const targetId = ctx.params.id;

    const [targetUser] = await db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(eq(user.id, targetId))
      .limit(1);

    if (!targetUser) {
      ctx.set.status = 404;
      return { success: false, error: "USER_NOT_FOUND" };
    }

    // Log impersonation attempt for audit trail (T-4-05)
    logger.warn(
      {
        adminUserId: ctx.userId,
        targetUserId: targetId,
        targetEmail: targetUser.email,
        action: "impersonate",
      },
      "Admin impersonation attempted (not yet implemented)",
    );

    // TODO: Impersonation requires creating a session for the target user.
    // Full implementation requires better-auth admin plugin or direct
    // session creation via auth.api.
    ctx.set.status = 501;
    return {
      success: false,
      error: "NOT_IMPLEMENTED",
      message: "User impersonation is not yet implemented",
    };
  })

  // --- Billing Overview ---
  .get("/billing/overview", async () => {
    // Aggregate in SQL so this endpoint stays bounded regardless of how many
    // billing_customers rows exist (no unbounded SELECT * + in-JS counting).
    const [totals] = await db
      .select({
        totalCustomers: count(),
        // count(column) tallies non-null values → customers with a subscription.
        totalSubscribers: count(billingCustomers.providerSubscriptionId),
        activeSubscriptions: sql<number>`count(*) filter (where ${billingCustomers.status} = 'active')`.mapWith(
          Number,
        ),
      })
      .from(billingCustomers);

    // Subscription distribution by price/plan, grouped in SQL over active rows.
    const planRows = await db
      .select({
        plan: billingCustomers.providerPriceId,
        planCount: count(),
      })
      .from(billingCustomers)
      .where(eq(billingCustomers.status, "active"))
      .groupBy(billingCustomers.providerPriceId);

    const planDistribution: Record<string, number> = {};
    for (const row of planRows) {
      planDistribution[row.plan || "unknown"] = row.planCount;
    }

    const activeSubscriptions = totals?.activeSubscriptions ?? 0;

    return {
      data: {
        totalCustomers: totals?.totalCustomers ?? 0,
        totalSubscribers: totals?.totalSubscribers ?? 0,
        activeSubscriptions,
        mrrEstimate: activeSubscriptions, // Count-based; real MRR requires Stripe price lookup
        planDistribution,
      },
    };
  })

  // --- System Health ---
  // Phase 22 / D-07 — DEPRECATED ALIAS. Use GET /health/detailed instead.
  // Will be removed in v1.4 once Plan 22-06 migrates the admin UI to the new
  // endpoint. The legacy `{ data: { uptime, timestamp, redis } }` shape is
  // preserved verbatim for Eden Treaty client backwards compatibility — the
  // `deprecated` + `deprecation` markers are added as SIBLING fields rather
  // than replacing the envelope so external consumers that have not yet
  // migrated keep working during the cutover. The full D-07 envelope (with
  // queues, workers, db lag probe, recentErrors, modules) is at /health/detailed.
  .get("/system/health", async () => {
    const health: Record<string, any> = {
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };

    // Check Redis connectivity if Redis is available. Reuse the shared,
    // typed BullMQ Redis singleton instead of an untyped ad-hoc dynamic import.
    if (env.REDIS_URL) {
      try {
        const redis = getRedisConnection(env.REDIS_URL);

        // Get Redis memory info
        const info = await redis.info("memory");
        const usedMemoryMatch = info.match(/used_memory_human:(\S+)/);
        health.redis = {
          connected: true,
          usedMemory: usedMemoryMatch?.[1] || "unknown",
        };
      } catch {
        health.redis = { connected: false, error: "Failed to connect" };
      }
    } else {
      health.redis = { connected: false, error: "REDIS_URL not configured" };
    }

    return {
      data: health,
      deprecated: true,
      deprecation:
        "Use /health/detailed instead. This route will be removed in v1.4.",
    };
  });
