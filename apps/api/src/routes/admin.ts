import { env } from "@baseworks/config";
import {
  billingCustomers,
  getDb,
  member,
  organization,
  organizationRole,
  user,
} from "@baseworks/db";
import { auth, requirePlatformAdmin, statements } from "@baseworks/module-auth";
import {
  adminCompleteUpload,
  adminDeleteFile,
  adminGetReadUrl,
  adminListFilesForTenant,
  adminSignUpload,
} from "@baseworks/module-files";
import {
  adminForceDisableWebhook,
  adminListAllWebhooks,
  adminListWebhookDeliveries,
} from "@baseworks/module-notifications";
import { getRedisConnection } from "@baseworks/queue";
import { and, count, eq, like, or, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { logger } from "../lib/logger";

/** Built-in role names reserved by the org plugin — operators can't shadow them. */
const BUILT_IN_ROLE_NAMES = new Set(["owner", "admin", "member"]);

/**
 * Validate a custom-role permission map against the shared statement catalog so
 * an operator cannot mint a role referencing an unknown resource/action. Returns
 * an error string, or null when valid.
 */
function validateRolePermission(permission: Record<string, string[]>): string | null {
  const catalog = statements as Record<string, readonly string[]>;
  for (const [resource, actions] of Object.entries(permission)) {
    const allowed = catalog[resource];
    if (!allowed) return `unknown resource "${resource}"`;
    for (const action of actions) {
      if (!allowed.includes(action)) {
        return `unknown action "${action}" for resource "${resource}"`;
      }
    }
  }
  return null;
}

/** Escape LIKE meta-characters to prevent search injection. */
function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, (c) => `\\${c}`);
}

/**
 * Phase 30 / UI-02 — admin files error → HTTP status mapping (contract §2).
 *   not_found                                  → 404
 *   quota_exceeded | file_too_large |
 *     image_too_large                          → 413
 *   every other code                           → 400
 */
function mapFilesError(code: string): number {
  if (code === "not_found") return 404;
  if (code === "quota_exceeded" || code === "file_too_large" || code === "image_too_large") {
    return 413;
  }
  return 400;
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

/**
 * Map a thrown better-auth `APIError` (from `auth.api.*` delegation) onto the
 * Elysia response. better-auth raises APIError with a numeric `statusCode`
 * (e.g. 404 user-not-found, 400 cannot-ban-yourself) and a `body.code`; surface
 * those faithfully instead of letting the global handler collapse them to 500.
 * Returns the JSON error body; the caller sets nothing else.
 */
function mapAuthError(ctx: any, err: unknown): { success: false; error: string } {
  const e = err as { statusCode?: number; body?: { code?: string; message?: string } };
  const status = typeof e?.statusCode === "number" ? e.statusCode : 500;
  ctx.set.status = status;
  return { success: false, error: e?.body?.code ?? e?.body?.message ?? "AUTH_ERROR" };
}

const db = getDb(env.DATABASE_URL);

export const adminRoutes = new Elysia({ prefix: "/api/admin" })
  .use(requirePlatformAdmin())

  // --- Tenant Management ---
  .get("/tenants", async (ctx: any) => {
    const limit = Number(ctx.query?.limit) || 20;
    const offset = Number(ctx.query?.offset) || 0;
    const search = ctx.query?.search as string | undefined;

    let query = db.select().from(organization);

    if (search) {
      const sanitized = escapeLike(search);
      query = query.where(
        or(like(organization.name, `%${sanitized}%`), like(organization.slug, `%${sanitized}%`)),
      ) as typeof query;
    }

    // Count query for pagination (same filters, no limit/offset)
    let countQuery = db.select({ count: count() }).from(organization);
    if (search) {
      const sanitized = escapeLike(search);
      countQuery = countQuery.where(
        or(like(organization.name, `%${sanitized}%`), like(organization.slug, `%${sanitized}%`)),
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

  .patch(
    "/tenants/:id",
    async (ctx) => {
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
    },
    {
      body: t.Object({
        metadata: t.Record(t.String(), t.Any()),
      }),
    },
  )

  // Operator read of a tenant's custom roles (Task A12 consumer). better-auth's
  // `listOrgRoles` requires the caller to be a MEMBER of the org with `ac:read`
  // — a platform operator is NEVER an org member, so it would 403. Read the
  // `organization_role` rows directly instead (operator gate already applied at
  // the plugin head), parsing the JSON-serialized `permission` column the same
  // way the org plugin does.
  .get("/tenants/:id/roles", async (ctx: any) => {
    const rows = await db
      .select()
      .from(organizationRole)
      .where(eq(organizationRole.organizationId, ctx.params.id));

    return {
      data: rows.map((r) => ({
        id: r.id,
        role: r.role,
        organizationId: r.organizationId,
        permission: safeParseMetadata(r.permission, r.organizationId) ?? {},
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    };
  })

  // --- Operator tenant-role management (v1.5) ---
  // Operators are NEVER org members, so better-auth's createOrgRole/updateOrgRole
  // (gated on the caller's `ac` permission IN that org) would 403. We write the
  // `organization_role` rows directly — the same table + JSON `permission` shape
  // better-auth resolves at hasPermission time — behind the requirePlatformAdmin()
  // gate at the plugin head. Permissions are validated against the shared statement
  // catalog; built-in role names are reserved. NOTE: unlike the tenant-side path,
  // operators have NO escalation ceiling (they are platform super-admins by design).
  .post(
    "/tenants/:id/roles",
    async (ctx: any) => {
      const orgId = ctx.params.id;
      const role = (ctx.body.role as string).trim();
      if (!role) {
        ctx.set.status = 400;
        return { success: false, error: "ROLE_NAME_REQUIRED" };
      }
      if (BUILT_IN_ROLE_NAMES.has(role)) {
        ctx.set.status = 400;
        return { success: false, error: "ROLE_NAME_RESERVED" };
      }
      const permErr = validateRolePermission(ctx.body.permission);
      if (permErr) {
        ctx.set.status = 400;
        return { success: false, error: `INVALID_PERMISSION: ${permErr}` };
      }

      const [tenant] = await db
        .select()
        .from(organization)
        .where(eq(organization.id, orgId))
        .limit(1);
      if (!tenant) {
        ctx.set.status = 404;
        return { success: false, error: "TENANT_NOT_FOUND" };
      }

      const [existing] = await db
        .select()
        .from(organizationRole)
        .where(and(eq(organizationRole.organizationId, orgId), eq(organizationRole.role, role)))
        .limit(1);
      if (existing) {
        ctx.set.status = 409;
        return { success: false, error: "ROLE_ALREADY_EXISTS" };
      }

      // Parity with better-auth's dynamicAccessControl.maximumRolesPerOrganization.
      const [tally] = await db
        .select({ count: count() })
        .from(organizationRole)
        .where(eq(organizationRole.organizationId, orgId));
      if ((tally?.count ?? 0) >= 50) {
        ctx.set.status = 400;
        return { success: false, error: "TOO_MANY_ROLES" };
      }

      await db.insert(organizationRole).values({
        id: crypto.randomUUID(),
        organizationId: orgId,
        role,
        permission: JSON.stringify(ctx.body.permission),
        createdAt: new Date(),
      });
      ctx.set.status = 201;
      return { success: true };
    },
    {
      body: t.Object({
        role: t.String({ minLength: 1, maxLength: 50 }),
        permission: t.Record(t.String(), t.Array(t.String())),
      }),
    },
  )

  .patch(
    "/tenants/:id/roles/:role",
    async (ctx: any) => {
      const orgId = ctx.params.id;
      const role = ctx.params.role;
      if (BUILT_IN_ROLE_NAMES.has(role)) {
        ctx.set.status = 400;
        return { success: false, error: "ROLE_NAME_RESERVED" };
      }
      const permErr = validateRolePermission(ctx.body.permission);
      if (permErr) {
        ctx.set.status = 400;
        return { success: false, error: `INVALID_PERMISSION: ${permErr}` };
      }
      const [existing] = await db
        .select()
        .from(organizationRole)
        .where(and(eq(organizationRole.organizationId, orgId), eq(organizationRole.role, role)))
        .limit(1);
      if (!existing) {
        ctx.set.status = 404;
        return { success: false, error: "ROLE_NOT_FOUND" };
      }
      await db
        .update(organizationRole)
        .set({ permission: JSON.stringify(ctx.body.permission), updatedAt: new Date() })
        .where(and(eq(organizationRole.organizationId, orgId), eq(organizationRole.role, role)));
      return { success: true };
    },
    {
      body: t.Object({
        permission: t.Record(t.String(), t.Array(t.String())),
      }),
    },
  )

  .delete("/tenants/:id/roles/:role", async (ctx: any) => {
    const orgId = ctx.params.id;
    const role = ctx.params.role;
    if (BUILT_IN_ROLE_NAMES.has(role)) {
      ctx.set.status = 400;
      return { success: false, error: "ROLE_NAME_RESERVED" };
    }
    const [existing] = await db
      .select()
      .from(organizationRole)
      .where(and(eq(organizationRole.organizationId, orgId), eq(organizationRole.role, role)))
      .limit(1);
    if (!existing) {
      ctx.set.status = 404;
      return { success: false, error: "ROLE_NOT_FOUND" };
    }
    await db
      .delete(organizationRole)
      .where(and(eq(organizationRole.organizationId, orgId), eq(organizationRole.role, role)));
    return { success: true };
  })

  // --- Tenant Files (cross-tenant admin browser) ---
  // Phase 30 / UI-02. Every route inherits the requirePlatformAdmin() gate at the
  // top of this plugin (non-allowlisted session → 403, no session → 401; an
  // org-owner is NEVER a platform operator). The TARGET tenant is ALWAYS the gated
  // `:id` path param — the request body NEVER carries a tenantId (confused-deputy
  // closed). storage_key/bucket never appear in any response.
  .get(
    "/tenants/:id/files",
    async (ctx: any) => {
      const limit = ctx.query?.limit !== undefined ? Number(ctx.query.limit) : undefined;
      const offset = ctx.query?.offset !== undefined ? Number(ctx.query.offset) : undefined;
      const r = await adminListFilesForTenant(ctx.params.id, { limit, offset });
      if (!r.success) {
        ctx.set.status = mapFilesError(r.error);
        return { error: r.error };
      }
      return r.data;
    },
    {
      query: t.Object({
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
    },
  )

  // Verify the target tenant exists (404) BEFORE reserving quota, so a typo'd id
  // cannot create an orphan tenant_storage_usage row (R8). `kind` is fixed
  // server-side to admin-attachment — NOT client-supplied.
  .post(
    "/tenants/:id/files/sign-upload",
    async (ctx: any) => {
      const [tenant] = await db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, ctx.params.id))
        .limit(1);
      if (!tenant) {
        ctx.set.status = 404;
        return { error: "TENANT_NOT_FOUND" };
      }

      const r = await adminSignUpload(ctx.params.id, {
        mimeType: ctx.body.mimeType,
        byteSize: ctx.body.byteSize,
        originalFilename: ctx.body.originalFilename,
      });
      if (!r.success) {
        ctx.set.status = mapFilesError(r.error);
        return { error: r.error };
      }
      return r.data;
    },
    {
      body: t.Object({
        mimeType: t.String({ minLength: 1 }),
        byteSize: t.Integer({ minimum: 1 }),
        originalFilename: t.Optional(t.String()),
      }),
    },
  )

  .post("/tenants/:id/files/:fileId/complete", async (ctx: any) => {
    const r = await adminCompleteUpload(ctx.params.id, ctx.params.fileId);
    if (!r.success) {
      ctx.set.status = mapFilesError(r.error);
      return { error: r.error };
    }
    return r.data;
  })

  .get("/tenants/:id/files/:fileId/read-url", async (ctx: any) => {
    const r = await adminGetReadUrl(ctx.params.id, ctx.params.fileId);
    if (!r.success) {
      ctx.set.status = mapFilesError(r.error);
      return { error: r.error };
    }
    return r.data;
  })

  .delete("/tenants/:id/files/:fileId", async (ctx: any) => {
    const r = await adminDeleteFile(ctx.params.id, ctx.params.fileId);
    if (!r.success) {
      ctx.set.status = mapFilesError(r.error);
      return { error: r.error };
    }
    return r.data;
  })

  // --- Webhook Oversight (cross-tenant) ---
  .get("/webhooks", async (ctx: any) => {
    const limit = Number(ctx.query?.limit) || 20;
    const offset = Number(ctx.query?.offset) || 0;
    const search = ctx.query?.search as string | undefined;
    const status = ctx.query?.status as string | undefined;
    const result = await adminListAllWebhooks({ search, status, limit, offset });
    if (!result.success) {
      ctx.set.status = 400;
      return result;
    }
    return result.data;
  })
  .get("/webhooks/:id/deliveries", async (ctx: any) => {
    const limit = Number(ctx.query?.limit) || 20;
    const offset = Number(ctx.query?.offset) || 0;
    const result = await adminListWebhookDeliveries(ctx.params.id, { limit, offset });
    if (!result.success) {
      ctx.set.status = 400;
      return result;
    }
    return result.data;
  })
  .patch("/webhooks/:id/disable", async (ctx: any) => {
    const reason = (ctx.body?.reason as string) ?? "";
    const result = await adminForceDisableWebhook(ctx.params.id, reason);
    if (!result.success) {
      ctx.set.status = 400;
      return result;
    }
    return result.data;
  })

  // --- User Management ---
  // Delegated to the better-auth admin plugin (`auth.api.listUsers`) so the user
  // lifecycle (list/ban/impersonate) shares one source of truth with the plugin.
  // listUsers returns plugin-parsed user objects (incl. `banned`/`role`, password
  // never present) and a `total` — preserving the existing `{ data, total }`
  // Eden shape the admin UI already consumes.
  .get("/users", async (ctx: any) => {
    const limit = Number(ctx.query?.limit) || 20;
    const offset = Number(ctx.query?.offset) || 0;
    const search = ctx.query?.search as string | undefined;

    try {
      const res = await auth.api.listUsers({
        headers: ctx.request.headers,
        query: {
          limit,
          offset,
          ...(search
            ? { searchField: "email", searchOperator: "contains", searchValue: search }
            : {}),
        },
      });
      return { data: res.users, total: res.total };
    } catch (err) {
      return mapAuthError(ctx, err);
    }
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

  // Ban/unban delegated to the admin plugin. `banUser` clears the target's
  // sessions and stamps user.banned/banReason/banExpires; `unbanUser` reverses it.
  // The plugin throws APIError (404 not-found, 400 cannot-ban-yourself) — mapped
  // through mapAuthError so the status survives to the client.
  .patch(
    "/users/:id",
    async (ctx: any) => {
      const { banned, banReason } = ctx.body;
      try {
        const res = banned
          ? await auth.api.banUser({
              headers: ctx.request.headers,
              body: { userId: ctx.params.id, banReason },
            })
          : await auth.api.unbanUser({
              headers: ctx.request.headers,
              body: { userId: ctx.params.id },
            });
        return { success: true, data: res };
      } catch (err) {
        return mapAuthError(ctx, err);
      }
    },
    {
      body: t.Object({
        banned: t.Boolean(),
        banReason: t.Optional(t.String()),
      }),
    },
  )

  // Per T-4-05: Log impersonation events with admin and target user IDs.
  // Delegated to the admin plugin's `impersonateUser`, which mints a short-lived
  // session for the target stamped with `impersonatedBy` and rotates the operator
  // session into a signed `admin_session` cookie (so stop-impersonating can
  // restore it). better-auth sets those cookies on its own Response — we must
  // FORWARD the Set-Cookie headers onto the Elysia response (returnHeaders), or
  // the operator's browser never switches into the impersonated session.
  .post("/users/:id/impersonate", async (ctx: any) => {
    const targetId = ctx.params.id;

    // Audit trail (T-4-05) — emitted before delegation so a denied/failed
    // attempt is still recorded.
    logger.warn(
      {
        adminUserId: ctx.userId,
        targetUserId: targetId,
        action: "impersonate",
      },
      "Admin impersonation attempted",
    );

    try {
      const { headers, response } = await auth.api.impersonateUser({
        headers: ctx.request.headers,
        body: { userId: targetId },
        returnHeaders: true,
      });

      const out = new Headers({ "content-type": "application/json" });
      for (const cookie of headers.getSetCookie?.() ?? []) out.append("set-cookie", cookie);

      return new Response(JSON.stringify({ success: true, data: response }), {
        status: 200,
        headers: out,
      });
    } catch (err) {
      return mapAuthError(ctx, err);
    }
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
        activeSubscriptions:
          sql<number>`count(*) filter (where ${billingCustomers.status} = 'active')`.mapWith(
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
      deprecation: "Use /health/detailed instead. This route will be removed in v1.4.",
    };
  });
