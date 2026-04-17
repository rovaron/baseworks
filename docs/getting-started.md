# Getting Started

Baseworks is a production-grade monorepo starter kit for multitenant SaaS and freelance projects. This guide walks you from a fresh clone to a running API, worker, and backend test suite. The prerequisites you need are listed in the next section.

---

## Prerequisites

| Tool | Version | Purpose |
| --- | --- | --- |
| [Bun](https://bun.sh) | 1.1+ | Runtime, package manager, test runner. Native TypeScript; no separate build step. |
| [Docker](https://docs.docker.com/get-docker/) | latest | Runs local Postgres 16 and Redis 7 via `docker-compose.yml`. |
| Git | any | Clone the repository. |

The commands below assume a POSIX-compatible shell (bash, zsh, Git Bash on Windows, or WSL2). Root-level `bun` scripts in `package.json` are cross-platform; direct shell pipelines assume POSIX.

## 1. Clone and install

```bash
git clone <your-repo-url>
cd baseworks
bun install
```

`bun install` resolves all workspaces (`apps/*`, `packages/*`, `packages/modules/*`) in one pass. The resulting `bun.lockb` is committed.

## 2. Configure environment variables

Environment variables are loaded by Bun natively and validated at startup by `packages/config/src/env.ts`. Copy the template below into a `.env` file at the repo root and fill in the values you need.

```bash
# Required
DATABASE_URL=postgres://postgres:postgres@localhost:5432/baseworks
BETTER_AUTH_SECRET=replace-with-a-random-string-at-least-32-chars
REDIS_URL=redis://localhost:6379

# Optional — populate as you enable features
STRIPE_SECRET_KEY=sk_test_replace_me
STRIPE_WEBHOOK_SECRET=whsec_replace_me
RESEND_API_KEY=re_replace_me
```

The full list of environment variables and their defaults lives in `packages/config/src/env.ts`. All secret values above are placeholders; never commit real keys. The `sk_test_`, `whsec_`, and `re_` prefixes show the expected shape so you can recognize real keys when you paste them in.

## 3. Start Postgres and Redis

```bash
bun docker:up
```

This invokes `docker compose up -d` and starts a `postgres:16` container and a `redis:7` container as declared in `docker-compose.yml`. Verify the containers are running with `docker compose ps`.

## 4. Apply database migrations

```bash
bun db:migrate
```

`bun db:migrate` runs the Drizzle migrator against `DATABASE_URL`. For a clean development database you may use `bun db:push` instead to push the current schema without creating a migration file.

## 5. Run the API server

```bash
bun api
```

This starts the Elysia API from `apps/api/src/index.ts` in watch mode on port 3000 (configurable via `PORT`). Swagger UI is mounted at `/swagger` when the swagger plugin is enabled.

## 6. Run the BullMQ worker

```bash
bun worker
```

This starts `apps/api/src/worker.ts`. It requires `REDIS_URL` (asserted at startup by `assertRedisUrl` in `packages/config/src/env.ts`). A health endpoint is exposed on `WORKER_HEALTH_PORT` (default 3001).

## 7. Run the tests

```bash
bun test
```

Bun's built-in test runner auto-discovers `*.test.ts` files across the monorepo. React component tests via Vitest are planned but not yet wired — all current tests run under `bun test`. See [testing.md](./testing.md) for the full testing guide.

## 8. Run the frontends (optional)

```bash
bun dev:web
```

```bash
bun dev:admin
```

`dev:web` starts the Next.js customer app on port 3000 (conflicts with `bun api`; start them on different `PORT` values when running both). `dev:admin` starts the Vite admin SPA on port 5173.

## Next steps

- [Architecture overview](./architecture.md) — understand the module system, CQRS flow, request lifecycle, and tenant scoping.
- [Add a module](./add-a-module.md) — follow an annotated walkthrough of `packages/modules/example`.
- [Configuration](./configuration.md) — full env var reference and module loading.
- [Testing](./testing.md) — mock patterns and test runner scope.
- [Integrations](./integrations/) — better-auth, billing, BullMQ, email.

## Troubleshooting

### Port 3000 already in use

Set `PORT=3001 bun api` to move the API to a free port.

### REDIS_URL missing when starting worker

Export `REDIS_URL=redis://localhost:6379` or ensure `bun docker:up` completed successfully.

### STRIPE_SECRET_KEY not set warning in tests

Expected in `NODE_ENV=test`; `validatePaymentProviderEnv` in `packages/config/src/env.ts::validatePaymentProviderEnv` logs a warning instead of throwing in test mode.
