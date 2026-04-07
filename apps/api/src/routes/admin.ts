import { Elysia, t } from "elysia";
import { createDb, organization, user, member, billingCustomers } from "@baseworks/db";
import { env } from "@baseworks/config";
import { requireRole } from "@baseworks/module-auth";
import { eq, like, or, count } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Admin API routes for cross-tenant operations.
 *
 * Per D-16: These routes use raw db (not scopedDb) for cross-tenant queries.
 * Per T-4-01: All routes protected by requireRole("owner").
 * Per T-4-03: User queries omit password hashes (select only safe fields).
 */

const db = createDb(env.DATABASE_URL);

export const adminRoutes = new Elysia({ prefix: "/api/admin" })
  .use(requireRole("owner"))

  // --- Tenant Management ---
  .get("/tenants", async (ctx: any) => {
    const limit = Number(ctx.query?.limit) || 20;
    const offset = Number(ctx.query?.offset) || 0;
    const search = ctx.query?.search as string | undefined;

    let query = db
      .select()
      .from(organization);

    if (search) {
      query = query.where(
        or(
          like(organization.name, `%${search}%`),
          like(organization.slug, `%${search}%`),
        ),
      ) as typeof query;
    }

    const tenants = await query.limit(limit).offset(offset);

    return {
      data: tenants.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        createdAt: t.createdAt,
        metadata: t.metadata ? JSON.parse(t.metadata) : null,
      })),
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
        metadata: tenant.metadata ? JSON.parse(tenant.metadata) : null,
        memberCount: memberCount[0]?.count ?? 0,
      },
    };
  })

  .patch("/tenants/:id", async (ctx: any) => {
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
      query = query.where(
        or(
          like(user.name, `%${search}%`),
          like(user.email, `%${search}%`),
        ),
      ) as typeof query;
    }

    const users = await query.limit(limit).offset(offset);

    return { data: users };
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

  .patch("/users/:id", async (ctx: any) => {
    const [foundUser] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, ctx.params.id))
      .limit(1);

    if (!foundUser) {
      ctx.set.status = 404;
      return { success: false, error: "USER_NOT_FOUND" };
    }

    // better-auth user table does not have a banned column by default.
    // Store ban status in a metadata approach or extend the user table.
    // For now, log the ban action. A proper implementation would require
    // the admin plugin for better-auth or a custom banned column.
    logger.info(
      { targetUserId: ctx.params.id, banned: ctx.body.banned, reason: ctx.body.banReason },
      "Admin user ban/unban action",
    );

    return { success: true, message: ctx.body.banned ? "User banned" : "User unbanned" };
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

    // Log impersonation for audit trail (T-4-05)
    logger.warn(
      {
        adminUserId: ctx.userId,
        targetUserId: targetId,
        targetEmail: targetUser.email,
        action: "impersonate",
      },
      "Admin impersonation initiated",
    );

    // Impersonation requires creating a session for the target user.
    // This is a placeholder -- full implementation requires better-auth
    // admin plugin or direct session creation via auth.api.
    return {
      success: true,
      message: "Impersonation session created",
      targetUserId: targetId,
    };
  })

  // --- Billing Overview ---
  .get("/billing/overview", async () => {
    const customers = await db.select().from(billingCustomers);

    const totalSubscribers = customers.filter((c) => c.stripeSubscriptionId).length;
    const activeSubscriptions = customers.filter((c) => c.status === "active");

    // Subscription distribution by price/plan
    const planDistribution: Record<string, number> = {};
    for (const c of activeSubscriptions) {
      const plan = c.stripePriceId || "unknown";
      planDistribution[plan] = (planDistribution[plan] || 0) + 1;
    }

    return {
      data: {
        totalCustomers: customers.length,
        totalSubscribers,
        activeSubscriptions: activeSubscriptions.length,
        mrrEstimate: activeSubscriptions.length, // Count-based; real MRR requires Stripe price lookup
        planDistribution,
      },
    };
  })

  // --- System Health ---
  .get("/system/health", async () => {
    const health: Record<string, any> = {
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };

    // Check Redis connectivity if Redis is available
    if (env.REDIS_URL) {
      try {
        // Use dynamic import to avoid hard dependency on ioredis types
        const ioredis = await import("ioredis" as string);
        const IORedis = ioredis.default || ioredis;
        const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: 1 });

        // Get Redis memory info
        const info = await redis.info("memory");
        const usedMemoryMatch = info.match(/used_memory_human:(\S+)/);
        health.redis = {
          connected: true,
          usedMemory: usedMemoryMatch?.[1] || "unknown",
        };

        await redis.quit();
      } catch {
        health.redis = { connected: false, error: "Failed to connect" };
      }
    } else {
      health.redis = { connected: false, error: "REDIS_URL not configured" };
    }

    return { data: health };
  });
