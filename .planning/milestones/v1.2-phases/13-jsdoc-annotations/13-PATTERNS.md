# Phase 13: JSDoc Annotations — Patterns

**Extracted:** 2026-04-16
**Focus:** Existing JSDoc style, file inventory, annotation gaps, and prescriptive templates

---

## 1. Canonical JSDoc Style (Gold Standards)

### 1.1 Handler JSDoc — `create-invitation.ts`

The codebase's best existing handler block. Use this as the structural template for all
`defineCommand`/`defineQuery` handlers.

```typescript
// packages/modules/auth/src/commands/create-invitation.ts

/**
 * Create an invitation to join an organization.
 *
 * Supports two modes:
 * - "email": Uses the provided email address. The sendInvitationEmail callback
 *   in auth.ts will enqueue an email to this address.
 * - "link": Generates a placeholder email `link-invite-{nanoid}@internal`.
 *   The sendInvitationEmail callback detects the @internal suffix and returns
 *   early, suppressing email delivery. The invitation ID is returned for
 *   constructing a shareable URL.
 *
 * Per D-04: Single invite dialog supports email and shareable link modes.
 * Per D-13: Only admin and member roles are assignable (owner is not).
 * Per INVT-01/INVT-03: Email invite and shareable link creation.
 */
export const createInvitation = defineCommand(...)
```

**Characteristics of the gold standard:**
- Opening line: one declarative sentence stating what the export does
- Blank line, then elaboration paragraph(s) for non-obvious behavior
- `Per X-YY:` references link implementation to design decisions (optional but encouraged)
- No `@param` or `@returns` on `defineCommand`/`defineQuery` exports — the wrapping pattern
  obscures them; put semantics in prose instead
- No `@example` for routine CRUD handlers

### 1.2 Infrastructure JSDoc — `registry.ts` / `cqrs.ts`

Class-level and method-level docs. Class gets a summary block; methods get one-liners or
short blocks for non-obvious behavior.

```typescript
// apps/api/src/core/registry.ts

/**
 * Config-driven module registry. Loads modules listed in config,
 * registers their commands/queries into the CQRS bus, and attaches routes.
 */
export class ModuleRegistry { ... }

/**
 * Returns the auth module's routes plugin for mounting BEFORE tenant middleware.
 * Auth routes (signup, login, OAuth callbacks) must not require tenant context.
 */
getAuthRoutes(): any { ... }

/**
 * Returns a single Elysia plugin that chains all non-auth, non-billing module routes.
 * Used in the app composition chain to preserve type inference for Eden Treaty.
 */
getModuleRoutes(): Elysia<any> { ... }
```

Methods with obvious names (`getCqrs`, `getEventBus`, `getLoaded`, `getLoadedNames`) have
**no JSDoc** currently. The standard: add a one-line block only when behavior is non-obvious
or has a constraint; skip trivially self-documenting accessors.

### 1.3 Helper/Warning JSDoc — `scoped-db.ts` / `unscoped-db.ts`

Use `@warning` tag inline within member docs for security-critical constraints:

```typescript
// packages/db/src/helpers/scoped-db.ts

/**
 * The underlying Drizzle instance for complex queries.
 * @warning Use with caution -- no automatic tenant filtering.
 */
raw: DbInstance;

/**
 * Creates a tenant-scoped database wrapper that auto-applies tenant_id
 * filtering on all select/insert/update/delete operations.
 */
export function scopedDb(db: DbInstance, tenantId: string): ScopedDb { ... }
```

```typescript
// packages/db/src/helpers/unscoped-db.ts

/**
 * Returns the raw Drizzle instance for admin/system operations
 * that need cross-tenant access. Audit trail recommended.
 *
 * @warning No automatic tenant filtering. Use only for admin operations,
 * system migrations, or cross-tenant reporting.
 */
export function unscopedDb(db: DbInstance): DbInstance { ... }
```

### 1.4 Middleware JSDoc — `tenant.ts` / `error.ts` / `request-trace.ts`

Middleware plugins get a single block on the `export const` describing purpose, behavior,
and any non-obvious constraints (scoping, ordering, pitfalls):

```typescript
// apps/api/src/core/middleware/tenant.ts

/**
 * Tenant context middleware. Derives tenantId from the authenticated session's
 * activeOrganizationId. Replaces Phase 1's x-tenant-id header extraction.
 *
 * Per D-16: tenantId comes from session, not header.
 * Per T-02-05: Cross-tenant access prevented by deriving tenantId from server-side session.
 * Per T-02-09: activeOrganizationId stored server-side in session table; client cannot spoof.
 *
 * Uses `as: 'scoped'` so the derive applies only to routes registered
 * after this middleware in the same plugin scope (not to routes like /health
 * or /api/auth/* registered before it).
 *
 * Per Pitfall 3: If activeOrganizationId is null (e.g., just signed up),
 * auto-selects the user's first organization.
 */
export const tenantMiddleware = new Elysia(...)
```

### 1.5 Schema Table JSDoc — `auth.ts` / `billing.ts`

Table files get a file-level block comment (NOT a JSDoc block — it sits above all imports).
Individual table `export const` declarations get no doc unless the table has a non-obvious
design constraint.

```typescript
// packages/db/src/schema/auth.ts

/**
 * better-auth core tables + organization plugin tables.
 * Generated based on better-auth v1.5.x schema requirements.
 *
 * IMPORTANT: These tables do NOT have tenantIdColumn().
 * Auth/org tables ARE the auth system -- they don't belong to a tenant.
 * The organization IS the tenant (organization.id = tenantId).
 */
```

```typescript
// packages/db/src/schema/billing.ts

/**
 * Billing module tables.
 *
 * Per D-02: billing_customers links tenants to payment provider customers.
 * Per D-07: webhook_events stores provider webhook events for idempotency and audit.
 * Per D-11: usage_records tracks metered usage for provider billing.
 *
 * The `lastEventAt` column in billing_customers supports event ordering
 * protection (Pitfall 3): only update billing_customers if the incoming
 * webhook event's `created` timestamp is newer than `lastEventAt`.
 *
 * Column names are provider-agnostic (providerCustomerId, providerSubscriptionId, etc.)
 * to support multiple payment providers (Stripe, Pagar.me, etc.).
 */
```

---

## 2. JSDoc Template by Export Type

### 2.1 `defineCommand` / `defineQuery` Handlers

```typescript
/**
 * [One-line action statement — verb + object + outcome.]
 *
 * [Optional: elaborate on non-obvious logic, modes, or side effects.
 *  Skip if the one-liner is sufficient.]
 *
 * @param input - [Brief description of validated input shape]
 * @param ctx   - Handler context: tenantId, userId, db, emit
 * @returns     - Result<[OutputType]> — [describe what data is in success case]
 * @throws      - [If any exception can propagate past the try/catch]
 *
 * Per X-YY: [Design reference if relevant.]
 */
export const myHandler = defineCommand(InputSchema, async (input, ctx) => { ... });
```

**When to include `@param`/`@returns`:** Per D-03, always include them even though TypeScript
expresses the types. Exception: trivial CRUD where `input` and `ctx` are self-evident and
`returns` is just `Result<{ updated: boolean }>` — add them anyway for IDE tooltips.

**When to add `@throws`:** When a code path re-throws (e.g., `processWebhook` rethrows for
BullMQ retry). Most handlers catch everything and return `err(...)`, so `@throws` is omitted.

### 2.2 Plain Functions

```typescript
/**
 * [One-line purpose statement.]
 *
 * [Elaboration if non-obvious.]
 *
 * @param name - [Description]
 * @returns    - [What it returns and why]
 * @throws     - [If it can throw]
 *
 * @example
 * const db = scopedDb(rawDb, "tenant-123");
 * const rows = await db.select(examples);
 */
export function myFunction(param: Type): ReturnType { ... }
```

### 2.3 Interfaces / Types

```typescript
/**
 * [What this type represents in the domain. One to three sentences.]
 *
 * [Elaborate on constraints, optionality semantics, or extension points.]
 */
export interface MyInterface {
  /** [Inline member doc for non-obvious fields only] */
  sensitiveField: string;
  normalField: string; // no inline doc needed
}
```

### 2.4 Classes

```typescript
/**
 * [Class purpose — one declarative sentence.]
 *
 * [Design notes: what problem it solves, how it relates to other components.]
 */
export class MyClass {
  /**
   * [Constructor doc if non-trivial initialization occurs.]
   * @param config - [Description]
   */
  constructor(config: Config) { ... }

  /**
   * [Method doc — only for public methods with non-obvious behavior.]
   * @param name - [Description]
   * @returns    - [What it returns]
   */
  publicMethod(name: string): void { ... }

  // Trivially named getters (getFoo, getBar) need no JSDoc
}
```

### 2.5 Elysia Plugin Exports

```typescript
/**
 * [Plugin purpose — one sentence.]
 *
 * [Non-obvious routing, scoping, or ordering constraints.]
 * [Reference to `as: 'scoped'` vs `as: 'global'` if relevant.]
 *
 * Per X-YY: [Design reference.]
 */
export const myPlugin = new Elysia({ name: "..." }).derive(...)
```

### 2.6 Schema Table Files

File-level block (before imports):
```typescript
/**
 * [Module name] tables.
 *
 * [Design constraints: tenant isolation approach, generation source, etc.]
 * [Column naming conventions if non-standard.]
 */

import { pgTable, ... } from "drizzle-orm/pg-core";
```

Individual tables get a JSDoc block only if there is a non-obvious constraint
(e.g., auth tables intentionally lack `tenantIdColumn`).

---

## 3. `@example` Placement Guide (D-05/D-06)

Per decisions, 10–15 total examples across the codebase. Target list:

**Public API entry points (5-7):**
- `defineCommand` — `packages/shared/src/types/cqrs.ts`
- `defineQuery` — `packages/shared/src/types/cqrs.ts`
- `CqrsBus.execute` / `CqrsBus.query` — `apps/api/src/core/cqrs.ts`
- `TypedEventBus.emit` / `TypedEventBus.on` — `apps/api/src/core/event-bus.ts`
- `scopedDb` — `packages/db/src/helpers/scoped-db.ts`
- `ModuleRegistry` constructor + `loadAll` — `apps/api/src/core/registry.ts`

**Complex / non-obvious functions (5-7):**
- `ok` / `err` + `Result<T>` usage pattern — `packages/shared/src/result.ts`
- `requireRole` — `packages/modules/auth/src/middleware.ts`
- `getPaymentProvider` (lazy singleton) — `packages/modules/billing/src/provider-factory.ts`
- `registerBillingHooks` — `packages/modules/billing/src/hooks/on-tenant-created.ts`
- `createInvitation` (link vs email mode) — already documented; add `@example` only

**Example format (D-06 — minimal, 3-5 lines):**
```typescript
 * @example
 * const result = await bus.execute("auth:create-tenant", { name: "Acme" }, ctx);
 * if (!result.success) throw new Error(result.error);
 * return result.data;
```

---

## 4. Tag Ordering Standard

Always use this tag order within a JSDoc block:

1. Description paragraph(s)
2. `@param` tags (one per parameter, in signature order)
3. `@returns`
4. `@throws`
5. `@example`
6. `@see` (optional cross-references)
7. `Per X-YY:` references (inline prose, NOT a tag — keep as prose in description)

**Biome compatibility note:** Biome 2.0 (`biome.json` in repo root) has no JSDoc-specific lint
rules configured. All standard JSDoc syntax is compatible. Do not use `@type` in `.ts` files
(redundant and Biome may flag it). `@warning` is non-standard but harmless — Biome ignores
unknown tags.

---

## 5. File-by-File Inventory

### 5.1 `packages/shared` — 6 files

| File | Exports | Current JSDoc | Action |
|------|---------|---------------|--------|
| `src/types/cqrs.ts` | `Result<T>`, `HandlerContext`, `CommandHandler`, `QueryHandler`, `defineCommand`, `defineQuery` | None | Add docs to all 6 exports; add `@example` to `defineCommand`/`defineQuery` |
| `src/types/context.ts` | `TenantContext`, `AppContext` | None | Add interface-level docs |
| `src/types/module.ts` | `JobDefinition`, `ModuleDefinition` | Partial (ModuleDefinition has block) | Normalize; add `JobDefinition` doc |
| `src/types/events.ts` | `DomainEvents` | None | Add interface doc + extension `@example` |
| `src/result.ts` | `ok`, `err` | None | Add function docs; add `@example` to both |
| `src/index.ts` | Re-exports only | None | No JSDoc needed on barrel file |

### 5.2 `packages/db` — 11 files

| File | Exports | Current JSDoc | Action |
|------|---------|---------------|--------|
| `src/connection.ts` | `createDb`, `DbInstance` | None | Add function doc + `@example` |
| `src/helpers/scoped-db.ts` | `ScopedDb`, `scopedDb` | Good (interface + function) | Normalize to standard; add `@example` to `scopedDb` |
| `src/helpers/unscoped-db.ts` | `unscopedDb` | Good | Normalize; verify tag order |
| `src/schema/base.ts` | `primaryKeyColumn`, `tenantIdColumn`, `timestampColumns` | None | Add function docs |
| `src/schema/auth.ts` | 6 tables | Good (file-level block) | Normalize; no per-table docs needed |
| `src/schema/billing.ts` | 3 tables | Good (file-level block) | Normalize; verify tag order |
| `src/schema/example.ts` | `examples` | None | Add table-level comment |
| `src/schema/index.ts` | Re-exports | None | No JSDoc needed |
| `src/index.ts` | Re-exports | None | No JSDoc needed |
| `src/__tests__/connection.test.ts` | — | — | Skip (tests excluded) |
| `src/__tests__/scoped-db.test.ts` | — | — | Skip (tests excluded) |

### 5.3 Auth Module — `packages/modules/auth/src/`

**Commands (8 files):**

| File | Current JSDoc | Gap |
|------|---------------|-----|
| `commands/create-invitation.ts` | Good (gold standard) | Add `@param`/`@returns`/`@throws` per D-03 |
| `commands/accept-invitation.ts` | Good block | Add `@param`/`@returns` |
| `commands/reject-invitation.ts` | Unknown — not read | Audit + add if missing |
| `commands/cancel-invitation.ts` | Unknown — not read | Audit + add if missing |
| `commands/create-tenant.ts` | Good block | Add `@param`/`@returns` |
| `commands/delete-tenant.ts` | Good block | Add `@param`/`@returns` |
| `commands/update-tenant.ts` | Unknown — not read | Audit + add if missing |
| `commands/update-profile.ts` | Good block | Add `@param`/`@returns` |

**Queries (6 files):**

| File | Current JSDoc | Gap |
|------|---------------|-----|
| `queries/get-tenant.ts` | Good block | Add `@param`/`@returns` |
| `queries/list-tenants.ts` | Unknown — not read | Audit + add if missing |
| `queries/list-members.ts` | Unknown — not read | Audit + add if missing |
| `queries/get-profile.ts` | Unknown — not read | Audit + add if missing |
| `queries/get-invitation.ts` | Unknown — not read | Audit + add if missing |
| `queries/list-invitations.ts` | Unknown — not read | Audit + add if missing |

**Other auth files:**

| File | Current JSDoc | Gap |
|------|---------------|-----|
| `middleware.ts` | Good (`betterAuthPlugin` + `requireRole`) | Add `@param`/`@returns` to `requireRole`; add `@example` |
| `routes.ts` | Good (plugin-level block + `makeCtx` inline) | Add `@param`/`@returns` to `makeCtx` |
| `hooks/auto-create-tenant.ts` | Excellent (export-less, doc-only file) | No change needed |
| `locale-context.ts` | Unknown — not read | Audit |
| `auth.ts` | Unknown — not read | Audit |
| `index.ts` | Unknown — not read | Barrel likely; no JSDoc needed |

### 5.4 Billing Module — `packages/modules/billing/src/`

**Commands (6 files):**

| File | Current JSDoc | Gap |
|------|---------------|-----|
| `commands/create-checkout-session.ts` | Good block | Add `@param`/`@returns` |
| `commands/cancel-subscription.ts` | Good block | Add `@param`/`@returns` |
| `commands/change-subscription.ts` | Unknown — not read | Audit + add |
| `commands/create-one-time-payment.ts` | Unknown — not read | Audit + add |
| `commands/create-portal-session.ts` | Unknown — not read | Audit + add |
| `commands/record-usage.ts` | Unknown — not read | Audit + add |

**Queries (2 files):**

| File | Current JSDoc | Gap |
|------|---------------|-----|
| `queries/get-subscription-status.ts` | Unknown — not read | Audit + add |
| `queries/get-billing-history.ts` | Unknown — not read | Audit + add |

**Port & adapter files:**

| File | Current JSDoc | Gap |
|------|---------------|-----|
| `ports/payment-provider.ts` | Good (file-level + interface overview) | Add `@param`/`@returns` to each method signature |
| `ports/types.ts` | Good (file-level block) | Add interface-level docs to all 14 interfaces |
| `adapters/stripe/stripe-adapter.ts` | Unknown — not read | Audit; implements PaymentProvider |
| `adapters/stripe/stripe-webhook-mapper.ts` | Unknown — not read | Audit |
| `adapters/pagarme/pagarme-adapter.ts` | Unknown — not read | Audit |
| `adapters/pagarme/pagarme-webhook-mapper.ts` | Unknown — not read | Audit |

**Infrastructure / hooks / jobs:**

| File | Current JSDoc | Gap |
|------|---------------|-----|
| `provider-factory.ts` | Good (factory + helpers) | Add `@param`/`@returns` to all 3 exported functions; add `@example` to `getPaymentProvider` |
| `hooks/on-tenant-created.ts` | Good (`registerBillingHooks`) | Add `@returns`; normalize tone |
| `jobs/process-webhook.ts` | Good (file-level + sub-handlers) | Add `@param`/`@returns`/`@throws` to `processWebhook`; sub-handlers already documented |
| `jobs/sync-usage.ts` | Unknown — not read | Audit + add |
| `jobs/send-email.ts` | Unknown — not read | Audit + add |
| `schema.ts` | Unknown — not read | Audit |
| `routes.ts` | Unknown — not read | Audit |
| `index.ts` | Unknown — not read | Barrel likely; skip |

### 5.5 Example Module — `packages/modules/example/src/`

| File | Current JSDoc | Gap |
|------|---------------|-----|
| `commands/create-example.ts` | **None** | Add full handler block + `@param`/`@returns` |
| `queries/list-examples.ts` | Unknown — not read | Audit + add |
| `routes.ts` | Unknown — not read | Audit + add |
| `index.ts` | Unknown — not read | Barrel likely; skip |

### 5.6 Core Infrastructure — `apps/api/src/core/`

| File | Current JSDoc | Gap |
|------|---------------|-----|
| `cqrs.ts` | **Partial** — class has one-line block; all methods have no JSDoc | Add method-level docs to all 6 public methods; add `@example` to `execute`/`query` |
| `event-bus.ts` | **Partial** — class has good block; methods `emit`/`on`/`off` have no JSDoc | Add method-level docs; add `@example` to `emit`/`on` |
| `registry.ts` | Good (class + 3 methods) | Add docs to undocumented methods: `attachRoutes`, `getCqrs`, `getEventBus`, `getLoaded`, `getLoadedNames` |
| `middleware/tenant.ts` | Good (full block) | Add `@returns` to `derive` callback |
| `middleware/error.ts` | Good (one-line) | Expand: document HTTP status mapping behavior |
| `middleware/request-trace.ts` | Good (full block) | Normalize tag order |

---

## 6. Existing Gaps Summary (D-04 Rewrite Targets)

The following files have JSDoc blocks that need rewriting to match the standard — they exist
but are below the bar (missing `@param`/`@returns`, prose-only without tags, or terse):

- **`packages/db/src/schema/example.ts`** — No table comment at all
- **`packages/shared/src/types/cqrs.ts`** — No JSDoc on any of the 6 exports
- **`packages/shared/src/result.ts`** — No JSDoc on `ok`/`err`
- **`packages/modules/example/src/commands/create-example.ts`** — No handler block
- **`apps/api/src/core/cqrs.ts`** — Class has one-line doc; all methods have none
- **`apps/api/src/core/event-bus.ts`** — Class has doc; `emit`/`on`/`off` have none

---

## 7. Biome Compatibility Rules

Biome 2.0 config at `biome.json` (root):
- `formatter.indentStyle: "space"`, `indentWidth: 2`, `lineWidth: 100`
- JSDoc comment lines must stay within 100-character line width
- No JSDoc-specific lint rules enabled — all standard JSDoc syntax accepted
- `@warning` (non-standard) is tolerated — Biome ignores unknown tags
- Do **not** use `/** @type {Foo} */` in `.ts` files — redundant and noisy
- Multi-line JSDoc must use ` * ` continuation lines (2-space indent inside block aligns
  naturally with Biome's 2-space formatter)

---

## 8. Style Guide Location Decision

Create `docs/jsdoc-style-guide.md` at repo root (not inside `.planning/`). This makes it
findable by contributors via standard `docs/` convention and is referenced by implementors
during annotation work. The style guide codifies sections 2–4 of this PATTERNS.md in
prescriptive form.

---

*Patterns extracted: 2026-04-16*
*Phase: 13-jsdoc-annotations*
