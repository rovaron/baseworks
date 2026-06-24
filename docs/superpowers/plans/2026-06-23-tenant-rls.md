# Tenant Row-Level Security (RLS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cross-tenant data access impossible at the PostgreSQL layer — independent of whether application queries remember a `tenant_id` predicate.

**Architecture:** Add a second, non-owner Postgres login role (`baseworks_rls`) that is subject to RLS. Enable RLS + a `tenant_isolation` policy on the five tenant-scoped tables, scoped `TO baseworks_rls`, matching `tenant_id = current_setting('app.tenant_id', true)`. Because the policy is **not** `FORCE`d, the table-owner role (`baseworks`, used by migrations, admin routes, and workers) bypasses RLS automatically — so cross-tenant code needs zero changes. Tenant request handlers run their DB work through a new `withTenant(rlsDb, tenantId, fn)` helper that opens a transaction and sets `app.tenant_id` **transaction-locally** (mandatory: the postgres.js pool reuses connections, so a session-level `SET` would leak across tenants). `current_setting(..., true)` returns NULL when unset, so a forgotten setting fails closed (zero rows) rather than open.

**Tech Stack:** Drizzle ORM 0.45 (`pgPolicy`/`pgRole`/`enableRLS`), drizzle-kit 0.31, postgres.js, PostgreSQL 16, Bun test, Elysia.

---

## Key decisions & constraints (read before starting)

1. **Two roles, owner bypasses.** Tables are owned by `baseworks` (the existing `DATABASE_URL` role). Postgres exempts a table's owner from RLS *unless* `FORCE ROW LEVEL SECURITY` is set — we deliberately do **not** force it. Result: admin routes, workers/jobs, and migrations (all on the owner role) are unrestricted with no code change; only the new `baseworks_rls` role is constrained. Do **not** add `FORCE` — it would break every cross-tenant path.
2. **Transaction-scoped setting only.** Use `set_config('app.tenant_id', $1, true)` (the `true` = `is_local`, transaction-scoped) — never `SET` (session) or `set_config(..., false)`. The pool (max 10) reuses connections; a session-level value would bleed into the next tenant's request on the same connection. This is the single most important correctness rule.
3. **Fail closed.** `current_setting('app.tenant_id', true)` returns SQL NULL when unset; `tenant_id = NULL` is never true, so an RLS-role query with no tenant set returns/affects zero rows. Never write a policy that treats "unset" as "allow all."
4. **Scope of RLS tables (exact, verified):** `billing_customers`, `usage_records`, `examples`, `files`, `tenant_storage_usage`. NOT `webhook_events`, NOT `storage_job_runs`, NOT any auth/org table (those are not tenant-scoped).
5. **Cross-tenant code stays on the owner connection.** `apps/api/src/routes/admin.ts`, every `packages/modules/*/src/jobs/**`, hooks, and `health/storage-health.ts` keep using `getDb()` (owner role) — they are cross-tenant by design and must bypass RLS. Their existing `// scoped-db-allow:` annotations remain accurate.
6. **RLS is defense-in-depth, not a replacement for the existing predicates.** Leave the files module's manual `eq(files.tenantId, tenantId)` filters in place; RLS is the backstop. Removing them is explicitly out of scope (a separate, later cleanup once RLS is proven in production).

## File structure

| File | Responsibility |
| --- | --- |
| `packages/db/src/schema/rls.ts` (create) | `pgRole("baseworks_rls").existing()` + a `tenantRlsPolicy(table)` helper returning the shared `pgPolicy`. Single source of the policy definition. |
| `packages/db/src/schema/{billing,example,storage}.ts` (modify) | Attach `tenantRlsPolicy(...)` to the 5 tenant tables. |
| `packages/db/src/helpers/with-tenant.ts` (create) | `withTenant(db, tenantId, fn)` — transaction + `set_config` local. |
| `packages/db/src/connection.ts` (modify) | Add `getRlsDb()` (second pool on `DATABASE_URL_RLS`); extend `closeDb()` to end both pools. |
| `packages/db/src/index.ts` (modify) | Export `getRlsDb`, `withTenant`, `rlsRole`. |
| `packages/config/src/env.ts` (modify) | Add optional `DATABASE_URL_RLS`. |
| `packages/db/migrations/00NN_*.sql` (generated) | `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` for the 5 tables. |
| `scripts/db-setup-rls-role.sql` (create) | Idempotent role creation + grants (ops/bootstrap, run as owner/superuser). |
| `scripts/db-setup-rls-role.ts` (create) | Bun runner that applies the SQL to a target DB (local + CI). |
| `docker-compose.yml` + `scripts/db-init/` (modify) | Run the role setup on local Postgres init. |
| `apps/api/src/core/middleware/tenant.ts` (modify, later phase) | Expose a request-scoped RLS executor (`ctx.withTenant`). |
| `packages/modules/files/src/commands/*.ts`, `queries/*.ts` (modify, later phase) | Run tenant DB work through the request RLS tx. |
| `docs/integrations/tenant-isolation.md` (create) | Operator/dev doc: the model, the env vars, how to add a new tenant table. |
| `.env.example` (modify) | Document `DATABASE_URL_RLS`. |

---

## Phase 0 — RLS role provisioning (ops)

### Task 0.1: Idempotent role-setup SQL

**Files:**
- Create: `scripts/db-setup-rls-role.sql`

- [ ] **Step 1: Write the SQL**

```sql
-- scripts/db-setup-rls-role.sql
-- Creates the NON-OWNER, RLS-enforced login role used by tenant request paths.
-- Run as the database owner/superuser. Idempotent. The password is interpolated
-- by scripts/db-setup-rls-role.ts from BASEWORKS_RLS_PASSWORD (never committed).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baseworks_rls') THEN
    EXECUTE format('CREATE ROLE baseworks_rls LOGIN NOBYPASSRLS PASSWORD %L', :'rls_password');
  ELSE
    EXECUTE format('ALTER ROLE baseworks_rls LOGIN NOBYPASSRLS PASSWORD %L', :'rls_password');
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO baseworks_rls;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO baseworks_rls;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO baseworks_rls;
-- Future tables created by the owner are auto-granted to the RLS role.
ALTER DEFAULT PRIVILEGES FOR ROLE baseworks IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO baseworks_rls;
ALTER DEFAULT PRIVILEGES FOR ROLE baseworks IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO baseworks_rls;
```

- [ ] **Step 2: Commit**

```bash
git add scripts/db-setup-rls-role.sql
git commit -m "chore(db): RLS role provisioning SQL"
```

### Task 0.2: Bun runner for the role setup

**Files:**
- Create: `scripts/db-setup-rls-role.ts`

- [ ] **Step 1: Write the runner**

```ts
// scripts/db-setup-rls-role.ts
// Applies scripts/db-setup-rls-role.sql to DATABASE_URL (owner connection),
// passing BASEWORKS_RLS_PASSWORD as the psql variable `rls_password`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

const ownerUrl = process.env.DATABASE_URL;
const rlsPassword = process.env.BASEWORKS_RLS_PASSWORD;
if (!ownerUrl) throw new Error("DATABASE_URL is required");
if (!rlsPassword) throw new Error("BASEWORKS_RLS_PASSWORD is required");

const sqlText = readFileSync(resolve(import.meta.dir, "db-setup-rls-role.sql"), "utf8").replace(
  /:'rls_password'/g,
  // postgres.js parameterization can't reach inside DO/format; inline-quote safely.
  `'${rlsPassword.replace(/'/g, "''")}'`,
);

const sql = postgres(ownerUrl, { max: 1 });
try {
  await sql.unsafe(sqlText);
  console.log("rls-role-setup: ok");
} finally {
  await sql.end({ timeout: 5 });
}
```

- [ ] **Step 2: Add scripts to package.json**

Modify `package.json` scripts (after `db:push`):

```json
"db:setup-rls": "bun scripts/db-setup-rls-role.ts",
```

- [ ] **Step 3: Run against local Postgres**

Run: `BASEWORKS_RLS_PASSWORD=baseworks_rls_dev bun run db:setup-rls`
Expected: prints `rls-role-setup: ok`

- [ ] **Step 4: Verify the role exists and is NOBYPASSRLS**

Run: `docker compose exec -T postgres psql -U baseworks -d baseworks -tAc "SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname='baseworks_rls'"`
Expected: `baseworks_rls|f`

- [ ] **Step 5: Commit**

```bash
git add scripts/db-setup-rls-role.ts package.json
git commit -m "chore(db): RLS role setup runner + db:setup-rls script"
```

### Task 0.3: Wire role setup into local Docker init + document env

**Files:**
- Modify: `docker-compose.yml` (postgres service init)
- Modify: `.env.example`

- [ ] **Step 1: Add the RLS connection var to `.env.example`**

```bash
# RLS (tenant isolation): a NON-OWNER role used only by tenant request paths.
# Same host/db as DATABASE_URL but the baseworks_rls login. Provision with
# `bun run db:setup-rls` (needs BASEWORKS_RLS_PASSWORD).
DATABASE_URL_RLS=postgres://baseworks_rls:baseworks_rls_dev@localhost:5432/baseworks
BASEWORKS_RLS_PASSWORD=baseworks_rls_dev
```

- [ ] **Step 2: Mount an init hook on the postgres service**

In `docker-compose.yml`, document that `db:setup-rls` must run after migrations (init SQL can't depend on app tables existing). Add a comment under the `postgres` service:

```yaml
    # Tenant RLS: after `bun run db:migrate`, run `bun run db:setup-rls` once to
    # create the baseworks_rls role + grants. CI does this in its DB setup step.
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "chore(db): document DATABASE_URL_RLS + role setup ordering"
```

---

## Phase 1 — Connection layer + `withTenant` primitive

### Task 1.1: `DATABASE_URL_RLS` env (optional)

**Files:**
- Modify: `packages/config/src/env.ts`

- [ ] **Step 1: Add the optional var**

Find the server env schema object and add (next to `DATABASE_URL`):

```ts
DATABASE_URL_RLS: z.string().url().optional(),
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/config/src/env.ts
git commit -m "feat(config): add optional DATABASE_URL_RLS"
```

### Task 1.2: `getRlsDb()` second pool

**Files:**
- Modify: `packages/db/src/connection.ts`
- Test: `packages/db/src/__tests__/connection-rls.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/__tests__/connection-rls.test.ts
import { describe, expect, test } from "bun:test";
import { getRlsDb } from "../connection";

describe("getRlsDb", () => {
  test("returns a singleton when DATABASE_URL_RLS is set", () => {
    process.env.DATABASE_URL_RLS ??= "postgres://baseworks_rls:baseworks_rls_dev@localhost:5432/baseworks";
    const a = getRlsDb();
    const b = getRlsDb();
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/db/src/__tests__/connection-rls.test.ts`
Expected: FAIL — `getRlsDb` is not exported.

- [ ] **Step 3: Implement `getRlsDb` + extend `closeDb`**

In `packages/db/src/connection.ts`, after the `getDb` definition:

```ts
let _rlsDb: DbInstance | undefined;

/**
 * Lazily-initialized pool on the NON-OWNER `baseworks_rls` role (RLS-enforced).
 * Used ONLY by tenant request paths, always through `withTenant()`. Falls back
 * to DATABASE_URL when DATABASE_URL_RLS is unset (dev convenience) — note that
 * the owner role bypasses RLS, so isolation is only enforced when the RLS URL
 * is configured. validateStorageEnv-style prod gating is added in Phase 5.
 */
export function getRlsDb(
  connectionString: string = (process.env.DATABASE_URL_RLS ?? process.env.DATABASE_URL) as string,
): DbInstance {
  if (!_rlsDb) _rlsDb = createDb(connectionString);
  return _rlsDb;
}
```

Then update `closeDb` to end both pools:

```ts
export async function closeDb(): Promise<void> {
  for (const inst of [_db, _rlsDb]) {
    const sql = (inst as (DbInstance & { $sql?: { end: (o?: { timeout?: number }) => Promise<void> } }) | undefined)?.$sql;
    if (sql) await sql.end({ timeout: 5 });
  }
  _db = undefined;
  _rlsDb = undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/db/src/__tests__/connection-rls.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/connection.ts packages/db/src/__tests__/connection-rls.test.ts
git commit -m "feat(db): getRlsDb() second pool for the RLS role"
```

### Task 1.3: `withTenant` primitive

**Files:**
- Create: `packages/db/src/helpers/with-tenant.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/__tests__/with-tenant.test.ts`

- [ ] **Step 1: Write the failing test (asserts the local setting is applied inside the tx)**

```ts
// packages/db/src/__tests__/with-tenant.test.ts
import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { getRlsDb } from "../connection";
import { withTenant } from "../helpers/with-tenant";

const RLS_URL = process.env.DATABASE_URL_RLS ?? "postgres://baseworks_rls:baseworks_rls_dev@localhost:5432/baseworks";
let canConnect = false;
beforeAll(async () => {
  process.env.DATABASE_URL_RLS ??= RLS_URL;
  try {
    await getRlsDb().execute(sql`select 1`);
    canConnect = true;
  } catch {
    canConnect = false;
  }
});

describe("withTenant", () => {
  test("sets app.tenant_id transaction-locally", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: RLS role / Postgres unavailable");
      return;
    }
    const seen = await withTenant(getRlsDb(), "tenant-abc", async (tx) => {
      const rows = (await tx.execute(sql`select current_setting('app.tenant_id', true) as t`)) as unknown as Array<{ t: string }>;
      return rows[0]?.t;
    });
    expect(seen).toBe("tenant-abc");

    // After the tx, the setting must NOT leak on the pooled connection.
    const after = (await getRlsDb().execute(sql`select current_setting('app.tenant_id', true) as t`)) as unknown as Array<{ t: string | null }>;
    expect(after[0]?.t == null || after[0]?.t === "").toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/db/src/__tests__/with-tenant.test.ts`
Expected: FAIL — module `../helpers/with-tenant` not found.

- [ ] **Step 3: Implement `withTenant`**

```ts
// packages/db/src/helpers/with-tenant.ts
import { sql } from "drizzle-orm";
import type { DbInstance } from "../connection";

/**
 * Run `fn` inside a transaction with `app.tenant_id` set TRANSACTION-LOCALLY
 * (`set_config(..., true)`). RLS policies on tenant tables read this via
 * `current_setting('app.tenant_id', true)`. The local scope is mandatory: the
 * postgres.js pool reuses connections, so a session-level setting would leak
 * into the next tenant's request. `db` MUST be the RLS-role pool (`getRlsDb()`)
 * for the policy to apply — the owner role bypasses RLS.
 */
export async function withTenant<T>(
  db: DbInstance,
  tenantId: string,
  fn: (tx: Parameters<Parameters<DbInstance["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
```

- [ ] **Step 4: Export from the package barrel**

In `packages/db/src/index.ts`, add:

```ts
export { withTenant } from "./helpers/with-tenant";
export { getRlsDb } from "./connection";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/db/src/__tests__/with-tenant.test.ts`
Expected: PASS (or SKIP if Postgres/RLS role absent — acceptable locally before Phase 0 ran).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/helpers/with-tenant.ts packages/db/src/index.ts packages/db/src/__tests__/with-tenant.test.ts
git commit -m "feat(db): withTenant() transaction-local tenant context"
```

---

## Phase 2 — RLS policies on tenant tables

### Task 2.1: Shared policy helper + role declaration

**Files:**
- Create: `packages/db/src/schema/rls.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the helper**

```ts
// packages/db/src/schema/rls.ts
import { sql } from "drizzle-orm";
import { type AnyPgColumn, pgPolicy, pgRole } from "drizzle-orm/pg-core";

/**
 * The non-owner, RLS-enforced login role. `.existing()` tells drizzle-kit the
 * role is provisioned out-of-band (scripts/db-setup-rls-role.sql) — do NOT emit
 * CREATE ROLE in migrations (roles are cluster-level + carry secrets).
 */
export const rlsRole = pgRole("baseworks_rls").existing();

/**
 * The shared per-tenant isolation policy. Applies ONLY to `baseworks_rls`; the
 * table owner (baseworks) bypasses RLS since we never FORCE it. `current_setting
 * (..., true)` is NULL when unset → fail-closed (zero rows). WITH CHECK blocks
 * writing a row stamped for a different tenant.
 *
 * Pass the table's tenant_id column so the policy text is unambiguous.
 */
export function tenantRlsPolicy(name: string, tenantIdCol: AnyPgColumn) {
  return pgPolicy(name, {
    as: "permissive",
    for: "all",
    to: rlsRole,
    using: sql`${tenantIdCol} = current_setting('app.tenant_id', true)`,
    withCheck: sql`${tenantIdCol} = current_setting('app.tenant_id', true)`,
  });
}
```

- [ ] **Step 2: Export `rlsRole` from the barrel**

In `packages/db/src/index.ts` add:

```ts
export { rlsRole, tenantRlsPolicy } from "./schema/rls";
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/rls.ts packages/db/src/index.ts
git commit -m "feat(db): shared tenant RLS policy + baseworks_rls role decl"
```

### Task 2.2: Attach the policy to all five tenant tables

**Files:**
- Modify: `packages/db/src/schema/storage.ts` (`files`, `tenant_storage_usage`)
- Modify: `packages/db/src/schema/billing.ts` (`billing_customers`, `usage_records`)
- Modify: `packages/db/src/schema/example.ts` (`examples`)

Drizzle attaches policies via the table's "extra config" callback (the 3rd `pgTable` arg that returns an array). Each table already has such a callback for indexes — append the policy to that returned array. `enableRLS` is implied by the presence of a policy.

- [ ] **Step 1: `files` + `tenant_storage_usage` (storage.ts)**

Add the import at the top of `packages/db/src/schema/storage.ts`:

```ts
import { tenantRlsPolicy } from "./rls";
```

In the `files` table's extra-config array (the `(t) => [ ... ]` callback), append:

```ts
tenantRlsPolicy("files_tenant_isolation", t.tenantId),
```

`tenant_storage_usage` currently has no extra-config callback (its `tenantId` is the primary key). Add one:

```ts
export const tenantStorageUsage = pgTable(
  "tenant_storage_usage",
  {
    tenantId: tenantIdColumn().primaryKey(),
    // ...existing columns unchanged...
  },
  (t) => [tenantRlsPolicy("tenant_storage_usage_tenant_isolation", t.tenantId)],
);
```

- [ ] **Step 2: `billing_customers` + `usage_records` (billing.ts)**

Add `import { tenantRlsPolicy } from "./rls";`, then append to each table's extra-config array:

```ts
tenantRlsPolicy("billing_customers_tenant_isolation", t.tenantId),
```
```ts
tenantRlsPolicy("usage_records_tenant_isolation", t.tenantId),
```

(If a table lacks an extra-config callback, add `(t) => [ tenantRlsPolicy(...) ]` as the 3rd arg, mirroring the `tenant_storage_usage` edit.)

- [ ] **Step 3: `examples` (example.ts)**

Add `import { tenantRlsPolicy } from "./rls";`, then append to the `examples` extra-config array:

```ts
tenantRlsPolicy("examples_tenant_isolation", t.tenantId),
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Generate the migration**

Run: `bun run db:generate` (the repo's `drizzle-kit generate` script)
Expected: a new `packages/db/migrations/00NN_*.sql` containing, for each of the five tables, `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` and `CREATE POLICY "<name>" ON ... AS PERMISSIVE FOR ALL TO "baseworks_rls" USING (...) WITH CHECK (...);`.

- [ ] **Step 6: Inspect the generated SQL**

Open the new migration file. Confirm: (a) exactly the five tables, (b) `TO "baseworks_rls"`, (c) NO `FORCE ROW LEVEL SECURITY`, (d) NO `CREATE ROLE`. If `FORCE` or `CREATE ROLE` appears, fix the schema (`.existing()` on the role; no `forceRLS()` anywhere) and regenerate.

- [ ] **Step 7: Apply the migration locally**

Run: `bun run db:migrate`
Expected: applies cleanly. Then re-run `bun run db:setup-rls` so the role's grants cover any newly created objects.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema/*.ts packages/db/migrations/
git commit -m "feat(db): enable RLS + tenant_isolation policy on the 5 tenant tables"
```

### Task 2.3: The load-bearing RLS proof test (DB-level isolation)

**Files:**
- Test: `packages/db/src/__tests__/rls-isolation.test.ts`

- [ ] **Step 1: Write the test**

```ts
// packages/db/src/__tests__/rls-isolation.test.ts
// Proves RLS at the DB layer: the RLS role sees ONLY the active tenant's rows
// and cannot write another tenant's row; the owner role bypasses RLS.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { examples } from "../schema/example";
import { getDb, getRlsDb } from "../connection";
import { withTenant } from "../helpers/with-tenant";

const A = "rls-tenant-A";
const B = "rls-tenant-B";
let ok = false;

beforeAll(async () => {
  process.env.DATABASE_URL_RLS ??= "postgres://baseworks_rls:baseworks_rls_dev@localhost:5432/baseworks";
  try {
    // Seed two tenants' rows via the OWNER connection (bypasses RLS).
    await getDb().insert(examples).values([
      { tenantId: A, title: "a-row" } as any,
      { tenantId: B, title: "b-row" } as any,
    ]);
    ok = true;
  } catch {
    ok = false;
  }
});

afterAll(async () => {
  if (ok) await getDb().delete(examples).where(sql`tenant_id in (${A}, ${B})`);
});

describe("RLS tenant isolation", () => {
  test("RLS role sees only the active tenant's rows", async () => {
    if (!ok) return console.warn("SKIPPED: Postgres/RLS unavailable");
    const rows = await withTenant(getRlsDb(), A, async (tx) =>
      tx.execute(sql`select tenant_id from examples`),
    );
    const tenants = new Set((rows as unknown as Array<{ tenant_id: string }>).map((r) => r.tenant_id));
    expect(tenants.has(A)).toBe(true);
    expect(tenants.has(B)).toBe(false);
  });

  test("RLS role cannot INSERT a row for a different tenant (WITH CHECK)", async () => {
    if (!ok) return console.warn("SKIPPED");
    let threw = false;
    try {
      await withTenant(getRlsDb(), A, async (tx) => {
        await tx.execute(sql`insert into examples (tenant_id, title) values (${B}, 'evil')`);
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("owner role bypasses RLS (sees both)", async () => {
    if (!ok) return console.warn("SKIPPED");
    const rows = (await getDb().execute(sql`select tenant_id from examples where tenant_id in (${A}, ${B})`)) as unknown as unknown[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});
```

> Note: adjust the `examples` insert columns (`title`) to the actual non-null columns of the `examples` table — open `packages/db/src/schema/example.ts` and match its required fields.

- [ ] **Step 2: Run it**

Run: `bun test packages/db/src/__tests__/rls-isolation.test.ts`
Expected: 3 PASS. If the first test shows both tenants, RLS is NOT engaging — confirm the test connects as `baseworks_rls` (not the owner) and that the migration + `db:setup-rls` ran.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/__tests__/rls-isolation.test.ts
git commit -m "test(db): prove RLS tenant isolation at the DB layer"
```

---

## Phase 3 — Wire the request path (start with the example module)

### Task 3.1: Expose a request-scoped RLS executor on the handler context

**Files:**
- Modify: `packages/shared/src/types/cqrs.ts` (`HandlerContext`)
- Modify: `apps/api/src/core/middleware/tenant.ts`
- Modify: `apps/api/src/index.ts` (where `HandlerContext` is constructed — search for `scopedDb(`)

- [ ] **Step 1: Add `withTenant` to `HandlerContext`**

In `packages/shared/src/types/cqrs.ts`, add to the `HandlerContext` interface:

```ts
  /**
   * Run a function against an RLS-scoped transaction for THIS request's tenant.
   * DB statements inside are constrained to ctx.tenantId by Postgres RLS,
   * independent of any WHERE clause. Prefer this for tenant reads/writes.
   */
  withTenant?: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
```

- [ ] **Step 2: Construct it where the context is built**

In `apps/api/src/index.ts`, find where `db: scopedDb(getDb(), tenantId)` is set on the handler context and add alongside it:

```ts
import { getRlsDb, withTenant } from "@baseworks/db";
// ...
withTenant: <T>(fn: (tx: any) => Promise<T>) => withTenant(getRlsDb(), tenantId, fn),
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/cqrs.ts apps/api/src/index.ts
git commit -m "feat(api): expose ctx.withTenant RLS executor per request"
```

### Task 3.2: Migrate the example module to `ctx.withTenant` + integration proof

**Files:**
- Modify: `packages/modules/example/src/commands/*.ts`, `queries/*.ts` (whichever touch `examples`)
- Test: `packages/modules/example/src/__tests__/rls-scoped.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/modules/example/src/__tests__/rls-scoped.test.ts
import { describe, expect, test } from "bun:test";
// Drive the example create+list handlers with ctx.withTenant for tenant A,
// seed a row for tenant B via the owner db, assert list returns only A's rows.
// (Fill in the concrete handler imports + ctx shape from the example module;
//  mirror packages/modules/auth/src/__integration__/permissions.test.ts harness.)
test.todo("example list returns only the active tenant's rows under RLS");
```

- [ ] **Step 2: Replace `scopedDb`/`getDb` reads in the example handlers**

For each example query/command handler, run the DB work through `ctx.withTenant`:

```ts
// before: const rows = await ctx.db.select(examples);
// after:
const rows = await ctx.withTenant!((tx) => tx.select().from(examples));
```

- [ ] **Step 3: Flesh out and run the test**

Replace the `test.todo` with a real test using the example handlers (create two tenants' rows, list as tenant A, assert isolation). Run: `bun test packages/modules/example/src/__tests__/rls-scoped.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/modules/example/src
git commit -m "feat(example): route tenant DB access through ctx.withTenant (RLS)"
```

---

## Phase 4 — Migrate the files module tenant handlers

> Only the SIX tenant request handlers migrate. `admin-files.ts` (operator, cross-tenant), every `jobs/*`, `hooks/*`, and `health/storage-health.ts` stay on `getDb()` (owner role, RLS-bypassing) and keep their `scoped-db-allow` annotations.

The transformation per handler: replace the handler's own `const db = getDb(env.DATABASE_URL)` + `db.transaction(...)` with `ctx.withTenant!(async (tx) => { ... })`, passing `tx` where `db`/`tx` was used. The quota helpers (`reserveQuota`, `markUploaded`, `decrementUsed`) already accept a `db` arg — pass `tx`. Manual `eq(files.tenantId, tenantId)` predicates STAY (defense-in-depth).

### Task 4.1: `queries/list-for-record.ts`

**Files:**
- Modify: `packages/modules/files/src/queries/list-for-record.ts`
- Test: `packages/modules/files/src/__integration__/rls-list.test.ts`

- [ ] **Step 1: Write a failing cross-tenant integration test**

```ts
// packages/modules/files/src/__integration__/rls-list.test.ts
// Seed files rows for tenant A and tenant B via the owner db; invoke
// list-for-record with ctx.withTenant bound to A; assert only A's files return
// EVEN IF the handler's manual tenant predicate were removed (RLS backstop).
// Mirror the existing files __integration__ harness for env + getDb seeding.
import { describe, expect, test } from "bun:test";
test.todo("list-for-record returns only the active tenant's files under RLS");
```

- [ ] **Step 2: Run it (todo → no fail yet); then implement the handler change**

Replace the handler's `const db = getDb(...)` + query with:

```ts
const rows = await ctx.withTenant!((tx) =>
  tx
    .select(/* same projection */)
    .from(files)
    .where(and(eq(files.tenantId, ctx.tenantId), /* existing owner/status/deletedAt predicates */)),
);
```

- [ ] **Step 3: Flesh out the test (real seeding + assertion) and run**

Run: `bun test packages/modules/files/src/__integration__/rls-list.test.ts`
Expected: PASS.

- [ ] **Step 4: Run the full files suite (no regressions)**

Run: `bun test packages/modules/files/src/__tests__ packages/modules/files/src/__integration__`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/modules/files/src/queries/list-for-record.ts packages/modules/files/src/__integration__/rls-list.test.ts
git commit -m "feat(files): list-for-record via ctx.withTenant (RLS-backed)"
```

### Task 4.2: `queries/get-read-url.ts`

- [ ] **Step 1:** Wrap the single-file lookup in `ctx.withTenant!((tx) => tx.select()...where(and(eq(files.id, input.fileId), eq(files.tenantId, ctx.tenantId), ...)))`.
- [ ] **Step 2:** Run `bun test packages/modules/files/src/__integration__` — expected PASS.
- [ ] **Step 3:** Commit: `feat(files): get-read-url via ctx.withTenant`.

### Task 4.3: `commands/sign-upload.ts` (quota reserve)

**Files:**
- Modify: `packages/modules/files/src/commands/sign-upload.ts`

- [ ] **Step 1:** Replace `const db = getDb(...)` with a single `ctx.withTenant!(async (tx) => { ... })` wrapping the existing body. Pass `tx` to `reserveQuota(tx, ctx.tenantId, size, defaultLimit)` and to the `files` insert. Keep the manual tenant stamping on the insert (`tenantId: ctx.tenantId`).
- [ ] **Step 2:** Run the live-DB sign-upload suite (incl. the 50-concurrent race test): `bun test packages/modules/files/src/__tests__/` and the relevant `__integration__`/`__unit__`. Expected: PASS, including the quota race (RLS adds a tx but the atomic UPDATE semantics are unchanged).
- [ ] **Step 3:** Commit: `feat(files): sign-upload + reserveQuota via ctx.withTenant`.

> ⚠️ Verify the 50-concurrent quota race test still passes — it is the load-bearing correctness test for sign-upload. RLS wraps each call in its own transaction; the conditional `UPDATE ... WHERE ... <= limit RETURNING` remains atomic per row.

### Task 4.4: `commands/complete-upload.ts` (markUploaded)

- [ ] **Step 1:** Wrap the body in `ctx.withTenant!`; pass `tx` to `markUploaded(tx, ...)` and the status-transition update. The handler already opens `db.transaction` internally — replace that with the `withTenant` tx (do not nest a second transaction).
- [ ] **Step 2:** Run `bun test packages/modules/files/src/__tests__/` (complete-upload live tests). Expected PASS.
- [ ] **Step 3:** Commit: `feat(files): complete-upload via ctx.withTenant`.

### Task 4.5: `commands/delete-file.ts` (soft-delete + refund)

- [ ] **Step 1:** Replace the handler's `db.transaction(...)` with `ctx.withTenant!(async (tx) => { ... })`; the inner `SELECT ... FOR UPDATE` and `softDeleteRow(tx, ctx.tenantId, row)` run on `tx`. Keep post-commit storage delete/emit outside the tx as today.
- [ ] **Step 2:** Run `bun test packages/modules/files/src/__tests__/` (delete + quota-refund tests). Expected PASS.
- [ ] **Step 3:** Commit: `feat(files): delete-file via ctx.withTenant`.

### Task 4.6: `commands/attach-file.ts` (cascade-on-replace)

- [ ] **Step 1:** Wrap the handler's transaction in `ctx.withTenant!`; the cascade `softDeleteRow` calls run on `tx`.
- [ ] **Step 2:** Run `bun test packages/modules/files/src/__tests__/` (attach + cascade tests). Expected PASS.
- [ ] **Step 3:** Commit: `feat(files): attach-file via ctx.withTenant`.

### Task 4.7: Tighten the lint guard for migrated handlers

**Files:**
- Modify: `packages/modules/files/src/commands/{sign-upload,complete-upload,delete-file,attach-file}.ts`, `queries/{get-read-url,list-for-record}.ts` (remove now-obsolete `getDb` + `scoped-db-allow` once they no longer call `getDb`)
- Verify: `scripts/lint-no-unscoped-tenant-db.sh`

- [ ] **Step 1:** After Tasks 4.1–4.6, these six files should no longer call `getDb`/`createDb`. Remove the leftover import and the `scoped-db-allow` annotations from them.
- [ ] **Step 2:** Run: `bash scripts/lint-no-unscoped-tenant-db.sh` — expected exit 0 (the remaining annotated sites are `admin-files.ts` only, which stays cross-tenant).
- [ ] **Step 3:** Run full lint + typecheck: `bun run lint && bun run typecheck`. Expected: clean.
- [ ] **Step 4:** Commit: `chore(files): drop obsolete getDb + scoped-db-allow on RLS-migrated handlers`.

---

## Phase 5 — Rollout, ops, prod gating, docs

### Task 5.1: Prod gating — require `DATABASE_URL_RLS` outside dev/test

**Files:**
- Modify: `packages/config/src/env.ts` (or the validate helpers in `apps/api`)
- Test: `packages/config/src/__tests__/env-rls.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/config/src/__tests__/env-rls.test.ts
import { describe, expect, test } from "bun:test";
import { assertRlsConfigured } from "../env";

describe("assertRlsConfigured", () => {
  test("throws in production when DATABASE_URL_RLS is unset", () => {
    expect(() => assertRlsConfigured("production", undefined)).toThrow(/DATABASE_URL_RLS/);
  });
  test("allows dev/test without it", () => {
    expect(() => assertRlsConfigured("test", undefined)).not.toThrow();
  });
});
```

- [ ] **Step 2: Implement `assertRlsConfigured`**

```ts
// packages/config/src/env.ts
export function assertRlsConfigured(nodeEnv: string | undefined, rlsUrl: string | undefined): void {
  if (nodeEnv === "production" && !rlsUrl) {
    throw new Error(
      "DATABASE_URL_RLS is required in production — tenant isolation (RLS) is enforced only on the baseworks_rls role. " +
        "Provision it with `bun run db:setup-rls` and set DATABASE_URL_RLS.",
    );
  }
}
```

- [ ] **Step 3:** Call `assertRlsConfigured(env.NODE_ENV, env.DATABASE_URL_RLS)` at API boot in `apps/api/src/index.ts` (next to the other `validate*` calls).
- [ ] **Step 4:** Run: `bun test packages/config/src/__tests__/env-rls.test.ts` — expected PASS.
- [ ] **Step 5:** Commit: `feat(config): require DATABASE_URL_RLS in production`.

### Task 5.2: CI — provision the RLS role before tests

**Files:**
- Modify: the CI workflow that runs `bun run test` (e.g. `.github/workflows/validate.yml`)

- [ ] **Step 1:** After the DB migrate step, add `BASEWORKS_RLS_PASSWORD: baseworks_rls_dev` to the job env and a step `bun run db:setup-rls`, plus `DATABASE_URL_RLS: postgres://baseworks_rls:baseworks_rls_dev@localhost:5432/<db>`.
- [ ] **Step 2:** Push a branch and confirm the RLS tests (`rls-isolation`, `with-tenant`, files RLS integration) run (not skip) and pass in CI.
- [ ] **Step 3:** Commit: `ci: provision baseworks_rls role + DATABASE_URL_RLS for tests`.

### Task 5.3: Operator/dev documentation

**Files:**
- Create: `docs/integrations/tenant-isolation.md`

- [ ] **Step 1:** Document: the two-role model (owner bypasses, `baseworks_rls` enforced, no FORCE); the `app.tenant_id` transaction-local setting; `withTenant`/`ctx.withTenant`; the exact tenant-table list; **how to add a new tenant table** (use `tenantIdColumn()` + append `tenantRlsPolicy("<table>_tenant_isolation", t.tenantId)`, regenerate migration, re-run `db:setup-rls`); and the rule that cross-tenant code (admin/jobs) uses `getDb()` (owner).
- [ ] **Step 2:** Add a one-line pointer from `CLAUDE.md` (the "Row-level security available… later" note now points here).
- [ ] **Step 3:** Commit: `docs: tenant isolation (RLS) integration guide`.

### Task 5.4: Make new-tenant-table RLS non-optional (guard)

**Files:**
- Create: `scripts/lint-rls-coverage.sh`
- Modify: `package.json` (`lint` chain)

- [ ] **Step 1:** Write a guard that greps `packages/db/src/schema/*.ts` for tables using `tenantIdColumn()` and asserts each also references `tenantRlsPolicy(` — failing if a tenant table has no policy (prevents a new tenant table silently shipping without RLS). Annotate exceptions with `// rls-allow: <reason>`.
- [ ] **Step 2:** Run it — expected exit 0 for the 5 covered tables.
- [ ] **Step 3:** Wire into `lint` as `lint:rls-coverage`; run `bun run lint`. Expected clean.
- [ ] **Step 4:** Commit: `chore(db): lint guard requiring RLS policy on every tenant table`.

---

## Risks & rollback

- **Pooling leak (highest risk):** any tenant DB statement that runs OUTSIDE `withTenant` on the RLS pool sees zero rows (fail-closed) — annoying but safe. The dangerous inverse (session-level `SET` leaking across tenants) is prevented by using `set_config(..., true)` exclusively. Never add a plain `SET app.tenant_id`.
- **Owner accidentally constrained:** only happens if someone adds `FORCE ROW LEVEL SECURITY`. The Task 2.2/Step 6 inspection + a note in the docs guard against it.
- **Quota race regression:** Phase 4.3/4.4 wrap quota ops in a per-call transaction. Mitigation: the existing 50-concurrent race test is the gate — it must pass unchanged.
- **Rollback:** RLS can be disabled per table without app changes: `ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;` (owner already bypasses; the RLS pool would then see all rows again). A down-migration that drops the policies + disables RLS is the clean revert; the `withTenant` wrapping is harmless if RLS is off.
- **Sequencing:** Phases 0→2 are infra and safe to land first (no behavior change for the owner role, which is all the app uses until Phase 3). Phase 3+ flips request paths onto the RLS pool — land per-module and watch for fail-closed (empty results) in staging.

## Self-review notes

- **Spec coverage:** role provisioning (P0), connection + primitive (P1), policies + DB-level proof (P2), request wiring + example (P3), files handlers + guard (P4), prod gating + CI + docs + coverage guard (P5). All of option D covered.
- **Types/names consistency:** `getRlsDb`, `withTenant`, `rlsRole`, `tenantRlsPolicy`, `ctx.withTenant`, `app.tenant_id`, role `baseworks_rls`, env `DATABASE_URL_RLS` / `BASEWORKS_RLS_PASSWORD` used consistently across tasks.
- **Open items for the implementer to confirm against live code (not placeholders, verifications):** the exact required columns of `examples` (Task 2.3 seed), the exact `db:generate`/`db:migrate` script names in `package.json`, and the precise location of the `scopedDb(getDb(), tenantId)` context construction in `apps/api/src/index.ts` (Task 3.1).
```
