/**
 * Tenant-scoped request context derived from the authenticated session.
 *
 * Available in all route handlers after tenant middleware resolves the
 * active organization from the session. The `tenantId` maps to the
 * better-auth organization ID.
 */
export interface TenantContext {
  /** UUID of the active tenant (organization) for this request. */
  tenantId: string;
}

/**
 * Application-wide context available to all request handlers.
 *
 * Extends TenantContext with user identity. Used as the base context
 * shape for route-level logic before constructing the full HandlerContext
 * required by CQRS handlers.
 */
export interface AppContext extends TenantContext {
  /** UUID of the authenticated user. Undefined for unauthenticated routes. */
  userId?: string;
}
