---
phase: 13-jsdoc-annotations
reviewed: 2026-04-16T12:00:00Z
depth: standard
files_reviewed: 55
files_reviewed_list:
  - apps/api/src/core/cqrs.ts
  - apps/api/src/core/event-bus.ts
  - apps/api/src/core/middleware/error.ts
  - apps/api/src/core/middleware/request-trace.ts
  - apps/api/src/core/middleware/tenant.ts
  - apps/api/src/core/registry.ts
  - docs/jsdoc-style-guide.md
  - packages/db/src/connection.ts
  - packages/db/src/helpers/scoped-db.ts
  - packages/db/src/helpers/unscoped-db.ts
  - packages/db/src/schema/base.ts
  - packages/db/src/schema/example.ts
  - packages/modules/auth/src/commands/accept-invitation.ts
  - packages/modules/auth/src/commands/cancel-invitation.ts
  - packages/modules/auth/src/commands/create-invitation.ts
  - packages/modules/auth/src/commands/create-tenant.ts
  - packages/modules/auth/src/commands/delete-tenant.ts
  - packages/modules/auth/src/commands/reject-invitation.ts
  - packages/modules/auth/src/commands/update-profile.ts
  - packages/modules/auth/src/commands/update-tenant.ts
  - packages/modules/auth/src/middleware.ts
  - packages/modules/auth/src/queries/get-invitation.ts
  - packages/modules/auth/src/queries/get-profile.ts
  - packages/modules/auth/src/queries/get-tenant.ts
  - packages/modules/auth/src/queries/list-invitations.ts
  - packages/modules/auth/src/queries/list-members.ts
  - packages/modules/auth/src/queries/list-tenants.ts
  - packages/modules/auth/src/routes.ts
  - packages/modules/billing/src/adapters/pagarme/pagarme-adapter.ts
  - packages/modules/billing/src/adapters/pagarme/pagarme-webhook-mapper.ts
  - packages/modules/billing/src/adapters/stripe/stripe-adapter.ts
  - packages/modules/billing/src/adapters/stripe/stripe-webhook-mapper.ts
  - packages/modules/billing/src/commands/cancel-subscription.ts
  - packages/modules/billing/src/commands/change-subscription.ts
  - packages/modules/billing/src/commands/create-checkout-session.ts
  - packages/modules/billing/src/commands/create-one-time-payment.ts
  - packages/modules/billing/src/commands/create-portal-session.ts
  - packages/modules/billing/src/commands/record-usage.ts
  - packages/modules/billing/src/hooks/on-tenant-created.ts
  - packages/modules/billing/src/jobs/process-webhook.ts
  - packages/modules/billing/src/jobs/send-email.ts
  - packages/modules/billing/src/jobs/sync-usage.ts
  - packages/modules/billing/src/ports/payment-provider.ts
  - packages/modules/billing/src/ports/types.ts
  - packages/modules/billing/src/provider-factory.ts
  - packages/modules/billing/src/queries/get-billing-history.ts
  - packages/modules/billing/src/queries/get-subscription-status.ts
  - packages/modules/billing/src/routes.ts
  - packages/modules/example/src/commands/create-example.ts
  - packages/modules/example/src/queries/list-examples.ts
  - packages/modules/example/src/routes.ts
  - packages/shared/src/result.ts
  - packages/shared/src/types/context.ts
  - packages/shared/src/types/cqrs.ts
  - packages/shared/src/types/events.ts
  - packages/shared/src/types/module.ts
findings:
  critical: 2
  warning: 4
  info: 3
  total: 9
status: issues_found
---

# Phase 13: Code Review Report

**Reviewed:** 2026-04-16T12:00:00Z
**Depth:** standard
**Files Reviewed:** 55
**Status:** issues_found

## Summary

This review covers JSDoc annotations added across the entire Baseworks source tree -- core CQRS infrastructure, database helpers, auth module, billing module, example module, and shared types. The JSDoc quality is high and follows the style guide consistently. However, the review surfaced pre-existing bugs in the auth module's CQRS handlers (missing `headers` on `HandlerContext`) and a structural issue with the event bus `off()` method. Two billing-related issues (unstructured logging and connection pool creation per event) are also flagged.

## Critical Issues

### CR-01: Auth commands access `ctx.headers` which does not exist on HandlerContext

**File:** `packages/modules/auth/src/commands/accept-invitation.ts:33`
**File:** `packages/modules/auth/src/commands/reject-invitation.ts:32`
**Issue:** Both `acceptInvitation` and `rejectInvitation` handlers access `ctx.headers` (via `ctx.headers ?? new Headers()`), but `HandlerContext` in `packages/shared/src/types/cqrs.ts` does not define a `headers` property. At runtime, `ctx.headers` evaluates to `undefined`, so the fallback `new Headers()` is always used. This means better-auth cannot resolve the user session from the request, and the `acceptInvitation` / `rejectInvitation` API calls will likely fail or operate without proper user context.
**Fix:** Either add `headers?: Headers` to `HandlerContext` and pass request headers from the route layer, or pass headers through the CQRS input schema. The route layer that constructs `makeCtx()` in `routes.ts` should forward the request headers:
```typescript
// In packages/shared/src/types/cqrs.ts, add to HandlerContext:
headers?: Headers;

// In packages/modules/auth/src/routes.ts, update makeCtx:
function makeCtx(userId: string, tenantId: string, headers?: Headers) {
  return {
    userId,
    tenantId,
    headers,
    db: null as any,
    emit: (_event: string, _data: unknown) => {},
  };
}
```

### CR-02: Auth queries and commands pass empty Headers to better-auth session-dependent APIs

**File:** `packages/modules/auth/src/commands/update-profile.ts:49`
**File:** `packages/modules/auth/src/commands/update-tenant.ts:34`
**File:** `packages/modules/auth/src/queries/list-tenants.ts:27`
**File:** `packages/modules/auth/src/queries/list-members.ts:29`
**File:** `packages/modules/auth/src/queries/list-invitations.ts:29`
**Issue:** Multiple auth handlers pass `headers: new Headers()` to better-auth API calls that require session context (e.g., `auth.api.updateUser`, `auth.api.listOrganizations`, `auth.api.getFullOrganization`, `auth.api.listInvitations`). Without the original request headers, better-auth cannot resolve the authenticated session. These calls will either fail silently, return empty results, or throw auth errors depending on the better-auth method.
**Fix:** Forward request headers from the route layer into `HandlerContext` (same fix as CR-01). Then replace `new Headers()` with `ctx.headers` in all affected handlers:
```typescript
// Example fix in update-profile.ts:
await auth.api.updateUser({
  body: updateData,
  headers: ctx.headers ?? new Headers(),
});
```

## Warnings

### WR-01: TypedEventBus.off() cannot remove listeners due to wrapping

**File:** `apps/api/src/core/event-bus.ts:78`
**Issue:** The `on()` method wraps the user-provided handler in an anonymous function for error isolation (line 53). The `off()` method accepts the original handler reference, but the EventEmitter stores the wrapper. Since the wrapper is not returned or exposed, callers can never successfully unsubscribe. The JSDoc at line 69-76 documents this limitation, but the API is effectively non-functional. If any module or test attempts to remove a listener, it will silently fail (no error thrown, listener remains active).
**Fix:** Return the wrapped handler from `on()` so callers can pass it to `off()`:
```typescript
on(event: string, handler: (data: any) => void | Promise<void>): (...args: any[]) => void {
  const wrapper = (data: unknown) => {
    try {
      const result = handler(data);
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch((err) => {
          logger.error({ err, event }, "Event subscriber error (async)");
        });
      }
    } catch (err) {
      logger.error({ err, event }, "Event subscriber error (sync)");
    }
  };
  this.emitter.on(event, wrapper);
  return wrapper; // Caller stores this for off()
}
```

### WR-02: New database connection pool created on every tenant.created event

**File:** `packages/modules/billing/src/hooks/on-tenant-created.ts:54`
**Issue:** `createDb(env.DATABASE_URL)` is called inside the event handler, which runs for every `tenant.created` event. Each call creates a new postgres.js connection pool. Over time with frequent tenant creation, this leads to connection pool exhaustion. The same pattern exists in `process-webhook.ts:46` and `sync-usage.ts:25`.
**Fix:** Move the `createDb()` call outside the handler (module-level singleton) or accept a database instance as a parameter:
```typescript
const db = createDb(env.DATABASE_URL);

export function registerBillingHooks(eventBus: { ... }): void {
  eventBus.on("tenant.created", async (data: unknown) => {
    // use db here instead of creating a new one
  });
}
```

### WR-03: Pagar.me getInvoices does not URL-encode query parameters

**File:** `packages/modules/billing/src/adapters/pagarme/pagarme-adapter.ts:310`
**Issue:** The customer ID is directly interpolated into the URL query string without encoding: `` `/charges?customer_id=${providerCustomerId}&size=${limit}` ``. If a customer ID contains special characters (unlikely with Pagar.me IDs, but a correctness issue), the request would fail or be malformed.
**Fix:** Use `encodeURIComponent` for safety:
```typescript
const charges = await this.request(
  "GET",
  `/charges?customer_id=${encodeURIComponent(providerCustomerId)}&size=${encodeURIComponent(String(limit))}`,
);
```

### WR-04: Billing module uses console.log/console.warn instead of pino logger

**File:** `packages/modules/billing/src/hooks/on-tenant-created.ts:48`
**File:** `packages/modules/billing/src/hooks/on-tenant-created.ts:68`
**File:** `packages/modules/billing/src/hooks/on-tenant-created.ts:73`
**File:** `packages/modules/billing/src/adapters/pagarme/pagarme-adapter.ts:123`
**File:** `packages/modules/billing/src/jobs/process-webhook.ts:91`
**File:** `packages/modules/billing/src/jobs/process-webhook.ts:97`
**Issue:** The project uses pino for structured logging (see `sync-usage.ts` which correctly uses pino). Several billing files use `console.log`, `console.warn`, and `console.error` instead, which bypasses structured logging, JSON formatting, and log level configuration.
**Fix:** Import and use pino in these files:
```typescript
import pino from "pino";
const logger = pino({ name: "billing:hooks" });

// Replace console.log with logger.info, console.warn with logger.warn, etc.
```

## Info

### IN-01: auth/routes.ts makeCtx has no-op emit function

**File:** `packages/modules/auth/src/routes.ts:50`
**Issue:** The `makeCtx` helper creates a `HandlerContext` with a no-op `emit` function: `(_event: string, _data: unknown) => {}`. Auth command handlers (e.g., `createInvitation`, `cancelInvitation`) call `ctx.emit()` to emit domain events, but these events are silently discarded since `makeCtx` does not wire up the TypedEventBus. This means domain events from auth routes are never delivered to subscribers.
**Fix:** Pass the `TypedEventBus.emit` function into `makeCtx`, or wire it through the module registry so auth route handlers emit real events.

### IN-02: Webhook event mappers use `new Date()` for occurredAt instead of provider timestamp

**File:** `packages/modules/billing/src/adapters/stripe/stripe-webhook-mapper.ts:60`
**File:** `packages/modules/billing/src/adapters/pagarme/pagarme-webhook-mapper.ts:60`
**Issue:** Both webhook mappers set `occurredAt: new Date()` (current wall-clock time) instead of extracting the timestamp from the provider event. The `process-webhook.ts` file documents this at line 69 (comment about IN-02). For out-of-order event protection to work correctly, `occurredAt` should reflect when the event actually occurred at the provider, not when the webhook was received.
**Fix:** Extract the provider timestamp:
```typescript
// Stripe: event.created is a Unix timestamp
occurredAt: rawEvent.data?.created
  ? new Date((rawEvent.data as any).created * 1000)
  : new Date(),

// Pagar.me: use data.created_at or similar field
occurredAt: data?.created_at
  ? new Date(data.created_at)
  : new Date(),
```

### IN-03: request-trace middleware uses type assertions for derived context

**File:** `apps/api/src/core/middleware/request-trace.ts:27-30`
**Issue:** The `onAfterResponse` handler casts `startTime as number`, `log as any`, and `set as any` to work around Elysia's type inference. While functional, these casts reduce type safety and could mask future type errors if the derive chain changes.
**Fix:** Consider using Elysia's generic type parameters or a dedicated state interface to avoid `as any` casts. This is a low-priority cleanup.

---

_Reviewed: 2026-04-16T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
