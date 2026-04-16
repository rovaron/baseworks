# JSDoc Style Guide

This guide standardizes JSDoc across the Baseworks codebase. All exported symbols
(functions, types, interfaces, classes, constants) must have a JSDoc block unless
explicitly exempted. The goal is consistent IDE tooltips, self-documenting APIs,
and maintainable inline documentation that stays accurate as the code evolves.

---

## General Rules

- **Line width:** 100 characters max (matches Biome formatter `lineWidth: 100`).
- **Indent:** 2-space indent inside comment blocks (` * ` continuation lines).
- **No `@type` in `.ts` files:** TypeScript already expresses types; `@type` is redundant.
- **`@warning` is allowed:** Non-standard tag, but Biome ignores unknown tags. Use it for
  security-critical constraints (e.g., bypassing tenant scoping).
- **Always include `@param` and `@returns`:** Even when TypeScript expresses the types,
  these tags provide constraint info and appear in IDE tooltips.
- **Technical-precise tone:** Describe what the code does, not what the developer should feel.
  Use domain terminology. Avoid filler words ("basically", "simply", "just").
- **One declarative sentence opener:** Every JSDoc block starts with a single sentence
  stating what the export does. Use present tense, active voice.

---

## Tag Ordering

Always use this tag order within a JSDoc block:

1. Description paragraph(s)
2. `@param` tags (one per parameter, in signature order)
3. `@returns`
4. `@throws`
5. `@example`
6. `@see` (optional cross-references)
7. `Per X-YY:` references (inline prose in description, NOT a tag)

---

## Templates by Export Type

### `defineCommand` / `defineQuery` Handlers

```typescript
/**
 * [One-line action statement -- verb + object + outcome.]
 *
 * [Optional: elaborate on non-obvious logic, modes, or side effects.
 *  Skip if the one-liner is sufficient.]
 *
 * @param input - [Brief description of validated input shape]
 * @param ctx   - Handler context: tenantId, userId, db, emit
 * @returns Result<[OutputType]> -- [describe what data is in success case]
 * @throws [If any exception can propagate past the try/catch]
 *
 * Per X-YY: [Design reference if relevant.]
 */
export const myHandler = defineCommand(InputSchema, async (input, ctx) => { ... });
```

### Plain Functions

```typescript
/**
 * [One-line purpose statement.]
 *
 * [Elaboration if non-obvious.]
 *
 * @param name - [Description with constraints, not just restating the type]
 * @returns [What it returns and why]
 * @throws [If it can throw]
 *
 * @example
 * const db = scopedDb(rawDb, "tenant-123");
 * const rows = await db.select(examples);
 */
export function myFunction(param: Type): ReturnType { ... }
```

### Interfaces / Types

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

### Classes

```typescript
/**
 * [Class purpose -- one declarative sentence.]
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
   * [Method doc -- only for public methods with non-obvious behavior.]
   * @param name - [Description]
   * @returns [What it returns]
   */
  publicMethod(name: string): void { ... }

  // Trivially named getters (getFoo, getBar) need no JSDoc
}
```

### Elysia Plugin Exports

```typescript
/**
 * [Plugin purpose -- one sentence.]
 *
 * [Non-obvious routing, scoping, or ordering constraints.]
 * [Reference to `as: 'scoped'` vs `as: 'global'` if relevant.]
 *
 * Per X-YY: [Design reference.]
 */
export const myPlugin = new Elysia({ name: "..." }).derive(...)
```

### Schema Table Files

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

## Good vs Bad Examples

### Example 1: Function Documentation

**Bad:**

```typescript
/** Creates a tenant. */
export const createTenant = defineCommand(...)
```

**Good:**

```typescript
/**
 * Create a new tenant organization and assign the requesting user as owner.
 *
 * Inserts an organization record via better-auth, sets it as the user's
 * active organization, and emits a `tenant:created` domain event for
 * downstream listeners (e.g., billing customer provisioning).
 *
 * @param input - Validated tenant creation data: name (2-50 chars), slug
 * @param ctx   - Handler context: tenantId, userId, db, emit
 * @returns Result<Organization> -- the created organization record
 */
export const createTenant = defineCommand(...)
```

### Example 2: Parameter Description

**Bad:**

```typescript
/**
 * @param name - The name
 * @param email - The email
 */
```

**Good:**

```typescript
/**
 * @param name - Display name for the organization, 2-50 characters
 * @param email - Invitee email address; must not already be a member
 */
```

### Example 3: Exported Type

**Bad:**

```typescript
// No JSDoc at all
export interface HandlerContext {
  tenantId: string;
  userId?: string;
  db: any;
  emit: (event: string, data: unknown) => void;
}
```

**Good:**

```typescript
/**
 * Context object passed to all CQRS command and query handlers.
 *
 * Provides tenant-scoped database access, user identity, and the
 * ability to emit domain events. Constructed by the route layer
 * from the authenticated session.
 */
export interface HandlerContext {
  /** UUID of the active tenant (organization) for this request. */
  tenantId: string;
  /** UUID of the authenticated user. Undefined for system-level operations. */
  userId?: string;
  /** Tenant-scoped Drizzle database instance (ScopedDb). */
  db: any;
  /** Emit a domain event to the typed event bus. */
  emit: (event: string, data: unknown) => void;
}
```

---

## @example Guidelines

Add `@example` blocks to the 10-15 most-used public API functions. Keep examples:

- **Minimal:** 3-5 lines of runnable code
- **No boilerplate:** Skip imports, setup, and teardown
- **Realistic:** Use domain-relevant values (tenant IDs, organization names)
- **Self-contained:** The example should make sense without reading surrounding code

**Target functions for @example:**

- `defineCommand` / `defineQuery` (packages/shared)
- `ok` / `err` (packages/shared)
- `scopedDb` (packages/db)
- `CqrsBus.execute` / `CqrsBus.query` (apps/api)
- `TypedEventBus.emit` / `TypedEventBus.on` (apps/api)
- `ModuleRegistry.loadAll` (apps/api)
- `requireRole` (packages/modules/auth)
- `getPaymentProvider` (packages/modules/billing)

---

## When to Skip JSDoc

- **Barrel re-export files** (`index.ts`): These only re-export from other modules.
  The source files have the JSDoc.
- **Trivially self-documenting accessors:** `getFoo()`, `getBar()`, `isEnabled()` --
  if the name says it all and there are no constraints, skip the doc.
- **Test files:** `*.test.ts`, `*.spec.ts` -- test names are the documentation.
- **Standard shadcn components:** Components copied via `shadcn` CLI in `packages/ui`
  that have not been modified. If customized, document the customization.
- **Internal/private functions:** Non-exported helpers within a file. Add a doc only
  if the logic is complex or non-obvious.
