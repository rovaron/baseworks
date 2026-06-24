# Tenant Isolation (Row-Level Security)

Baseworks isolates tenant data at **two layers**:

1. **Application** — tenant request handlers filter by `tenant_id` (the `organization.id`), and `ScopedDb`/manual predicates scope queries.
2. **Database (RLS)** — PostgreSQL Row-Level Security enforces isolation **even if a query forgets its predicate**. This is the backstop described here.

> `organization.id` **is** the `tenantId`. Auth/identity tables (`user`, `session`, `organization`, `member`, …) are NOT tenant-scoped and are NOT under RLS.

## The two-role model

| Role | Used by | RLS |
|------|---------|-----|
| `baseworks` (owner) | migrations, admin routes (`/api/admin/*`), workers/jobs, hooks, health | **bypasses** RLS (table owner, and we never `FORCE` it) |
| `baseworks_rls` (non-owner login) | tenant **request** handlers, via `ctx.withTenant` | **enforced** |

Because the owner is exempt from a non-`FORCE`d policy, all cross-tenant code keeps working unchanged on the owner connection; only the `baseworks_rls` role — which serves tenant requests — is constrained.

## How a request is scoped

Tenant handlers run their DB work through `ctx.withTenant` (resolved with `requireWithTenant(ctx)`):

```ts
const rows = await requireWithTenant(ctx)((tx) =>
  tx.select().from(files).where(and(eq(files.tenantId, ctx.tenantId), /* … */)),
);
```

`withTenant(getRlsDb(), tenantId, fn)` opens **one transaction** and sets the tenant **transaction-locally**:

```sql
select set_config('app.tenant_id', $1, true);  -- true = local to this tx
```

The policy on each tenant table is:

```sql
… AS PERMISSIVE FOR ALL TO baseworks_rls
USING      (tenant_id = current_setting('app.tenant_id', true))
WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
```

- **Transaction-local is mandatory** — the postgres.js pool reuses connections, so a session-level `SET` would leak the tenant into the next request. Never use a plain `SET app.tenant_id`.
- **Fail-closed** — `current_setting('app.tenant_id', true)` is `NULL` when unset, so an RLS-role query with no tenant set matches **zero** rows (never all rows).

## Configuration

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | owner connection (migrations, admin, workers) |
| `DATABASE_URL_RLS` | `baseworks_rls` connection for tenant requests. **Required in production** (`assertRlsConfigured` crashes boot otherwise). Falls back to `DATABASE_URL` in dev/test. |
| `BASEWORKS_RLS_PASSWORD` | password used by `db:setup-rls` to create/rotate the role |

**Provisioning order (every fresh environment):**

```bash
bun run db:setup-rls   # create baseworks_rls + grants + default privileges  (BEFORE migrate)
bun run db:migrate     # migration 0009 creates the policies TO baseworks_rls
```

`db:setup-rls` must run **before** `db:migrate`: the policy migration references the role, and `ALTER DEFAULT PRIVILEGES` must precede the owner creating the tables so the RLS role is auto-granted on them. CI does this in `.github/workflows/validate.yml`.

## Adding a new tenant-scoped table

1. Define the table with `tenantIdColumn()`.
2. Append the shared policy in the table's extra-config array:

```ts
import { tenantRlsPolicy } from "./rls";

export const widgets = pgTable(
  "widgets",
  { tenantId: tenantIdColumn(), /* … */ },
  (t) => [
    index("widgets_tenant_id_idx").on(t.tenantId),
    tenantRlsPolicy("widgets_tenant_isolation", t.tenantId),
  ],
);
```

3. `bun run db:generate && bun run db:migrate`, then `bun run db:setup-rls` (idempotent; ensures grants).
4. Access it from request handlers via `ctx.withTenant`.

The `lint:rls-coverage` guard (in `bun run lint`) **fails the build** if a table uses `tenantIdColumn()` without a `tenantRlsPolicy(...)`. To intentionally opt out, add an inline `// rls-allow: <reason>` comment.

## Tenant tables under RLS (current)

`billing_customers`, `usage_records`, `examples`, `files`, `tenant_storage_usage`.

## Caveats

- RLS is **defense-in-depth** — keep the explicit `eq(tenantId)` predicates in handlers too.
- Cross-tenant code (admin/jobs/hooks/health) intentionally uses `getDb()` (owner) and bypasses RLS. The `lint:tenant-db` guard requires any raw DB access in request handlers (`commands/`, `queries/`) to be annotated `// scoped-db-allow: <reason>`.
- A handler that runs a tenant query **outside** `ctx.withTenant` on the RLS pool will see zero rows (fail-closed) — annoying but safe.
