---
created: 2026-04-26T14:37:34.684Z
title: Repair drizzle migration journal inconsistency
area: database
files:
  - packages/db/migrations/0001_rename_stripe_to_provider.sql
  - packages/db/migrations/meta/_journal.json
  - packages/db/migrations/meta/0000_snapshot.json
  - packages/db/drizzle.config.ts
---

## Problem

`bun run db:migrate` fails silently (exits code 1 after spinner). Root cause: the migration folder is in an inconsistent state.

State on disk (verified 2026-04-26):
- `packages/db/migrations/0001_rename_stripe_to_provider.sql` exists
- `packages/db/migrations/meta/_journal.json` references `0000_wealthy_black_queen` (idx 0) — but no `0000_*.sql` file exists
- `packages/db/migrations/meta/0000_snapshot.json` exists (schema snapshot, not SQL)
- DB tables exist (11 tables — `account`, `billing_customers`, `examples`, `invitation`, `member`, `organization`, `session`, `usage_records`, `user`, `verification`, `webhook_events`) presumably from an earlier `db:push`
- `drizzle.__drizzle_migrations` tracking table is empty
- `billing_customers` still has the OLD column names (`stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`) — migration 0001 was never applied

Effect: `db:migrate` reads the journal, looks for `0000_wealthy_black_queen.sql`, doesn't find it, exits 1 with no error message. New contributors cloning the repo can't bootstrap via documented `bun run db:migrate` flow — they're forced to use `db:push` which bypasses the migration history entirely.

This was discovered during v1.3 observability milestone testing setup. It did not block testing (observability tests don't depend on the column rename), but it's a real onboarding hazard for fork users — the project's stated workflow (drizzle-kit generate + migrate per CLAUDE.md tech stack) is broken.

## Solution

TBD — pick one of:

**Option 1: Reconstruct the missing 0000 migration from snapshot**
- The `meta/0000_snapshot.json` is the schema state at migration 0000 — could regenerate the SQL from it (or hand-write the CREATE TABLE statements matching the snapshot).
- Then run `db:migrate` against a fresh DB to verify both 0000 + 0001 apply cleanly.
- Risk: hand-written SQL drifts from what drizzle-kit would actually have generated.

**Option 2: Reset migration history**
- Delete `packages/db/migrations/*` entirely
- Run `bun run db:generate` against current schema → produces a single fresh `0000_*.sql` baseline that matches the live schema state.
- Update onboarding docs: "for forks, run `db:push` first to create the tables, then `db:generate` will produce a baseline migration."
- Cleanest going forward; loses the historical migration record (which is already incomplete).

**Option 3: Document `db:push` as the dev workflow, keep migrations for prod only**
- Acknowledge migrations folder is stale.
- Document: `db:push` for dev/fork bootstrapping; migrations regenerated before each milestone release.
- Lowest effort, highest tech-debt.

Option 2 is probably the right call for a starter-kit repo where forkers expect `bun run db:migrate` to "just work" on a fresh clone. The historical migration record has limited value in a fork-and-customize template.
