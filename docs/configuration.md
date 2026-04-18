# Configuration

This document covers environment variables, module loading, provider selection, and deployment configuration. `packages/config/src/env.ts` is the source of truth for every variable below; Zod validation there runs at process startup and crashes the process on missing or invalid required values.

---

## Environment variables

Variables are loaded by Bun natively (no `dotenv` dependency) and validated at startup by a Zod schema in `packages/config/src/env.ts`. Missing required variables crash the process with a typed error message. The table below mirrors the schema in declaration order; `packages/config/src/env.ts` remains authoritative if the table ever drifts.

| Env var | Required | Default | Purpose |
|---------|----------|---------|---------|
| `DATABASE_URL` | yes | — | Postgres connection string used by every app. |
| `NODE_ENV` | no | `development` | Enum `development` / `production` / `test`. |
| `PORT` | no | `3000` | API HTTP port. |
| `REDIS_URL` | conditional | — | Required when `INSTANCE_ROLE=worker` or `all`; asserted by `assertRedisUrl`. |
| `LOG_LEVEL` | no | `info` | Pino log level (`debug` / `info` / `warn` / `error`). |
| `INSTANCE_ROLE` | no | `all` | Enum `api` / `worker` / `all` — controls which modules boot. |
| `BETTER_AUTH_SECRET` | yes | — | ≥ 32-char secret for better-auth session signing. |
| `BETTER_AUTH_URL` | no | `http://localhost:3000` | Public base URL for better-auth. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | — | OAuth Google (enables Google sign-in when both set). |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | no | — | OAuth GitHub. |
| `PAYMENT_PROVIDER` | no | `stripe` | Enum `stripe` / `pagarme`. |
| `STRIPE_SECRET_KEY` | conditional | — | Required when `PAYMENT_PROVIDER=stripe` (non-test). |
| `STRIPE_WEBHOOK_SECRET` | no | — | Stripe webhook signature secret. |
| `PAGARME_SECRET_KEY` | conditional | — | Required when `PAYMENT_PROVIDER=pagarme` (non-test). |
| `PAGARME_WEBHOOK_SECRET` | no | — | Pagar.me webhook signature secret. |
| `RESEND_API_KEY` | no | — | Resend API key; the email dispatcher gracefully skips when absent. |
| `WEB_URL` | no | `http://localhost:3000` | Next.js customer app URL. |
| `ADMIN_URL` | no | `http://localhost:5173` | Vite admin SPA URL. |
| `WORKER_HEALTH_PORT` | no | `3001` | HTTP port for the worker health endpoint. |

`packages/config/src/env.ts` is the canonical schema. The table above mirrors it and may drift during refactors — the Zod schema is always authoritative.

### How env loading works

Bun reads `.env`, `.env.local`, `.env.{NODE_ENV}`, and `.env.{NODE_ENV}.local` from the repo root at process start and populates `process.env`. `packages/config/src/env.ts` then invokes `createEnv({ server: serverSchema, runtimeEnv: process.env, emptyStringAsUndefined: true })` from `@t3-oss/env-core`, which builds a typed `env` object validated against the Zod schema. Empty strings are coerced to `undefined` so an unset value in a `.env` file is treated identically to an absent entry.

### Variable groups

- **Database** — `DATABASE_URL` is required everywhere. The ORM is Drizzle over `postgres` (postgres.js); the string must be a valid `postgres://` URL.
- **Runtime role** — `INSTANCE_ROLE` selects which modules boot (`api`, `worker`, or `all`) and feeds `assertRedisUrl`. `PORT` and `WORKER_HEALTH_PORT` are role-specific HTTP ports.
- **Session signing** — `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` configure the better-auth handler. The secret is enforced at `≥ 32` chars; the URL is the public base that better-auth uses when constructing callback URLs.
- **OAuth** — Google and GitHub client pairs are optional. Each provider enables itself only when both ID and secret are set, so a deployment may enable one, both, or neither.
- **Billing** — `PAYMENT_PROVIDER` selects the active adapter; the corresponding `{STRIPE,PAGARME}_SECRET_KEY` is then required in non-test environments. Webhook secrets are checked when webhook routes receive requests, not at boot.
- **Email** — `RESEND_API_KEY` is optional. Absence is not an error; the email dispatcher logs and returns.
- **Frontend URLs** — `WEB_URL` and `ADMIN_URL` populate the CORS allowlist in `apps/api/src/index.ts:56-61` so browser requests from those origins are accepted with credentials.

## Startup guards

### validatePaymentProviderEnv

`packages/config/src/env.ts::validatePaymentProviderEnv` enforces provider-specific secrets. When `PAYMENT_PROVIDER=stripe` and `STRIPE_SECRET_KEY` is missing, or when `PAYMENT_PROVIDER=pagarme` and `PAGARME_SECRET_KEY` is missing, the function throws in non-test environments so the process fails fast at startup. In `NODE_ENV=test`, it warns instead of throwing so the billing module can be imported by the test runner without real provider keys.

### assertRedisUrl

`packages/config/src/env.ts::assertRedisUrl` throws when `INSTANCE_ROLE` is `worker` or `all` and `REDIS_URL` is missing. Called by `apps/api/src/worker.ts:12` before the worker boots. The API-only role (`INSTANCE_ROLE=api`) is exempt — the API process does not itself dispatch BullMQ jobs; enqueue happens through event-bus hooks that skip gracefully when `REDIS_URL` is absent.

## Module loading

Which modules boot is controlled by two locations.

### Static import map

`apps/api/src/core/registry.ts::moduleImportMap` declares the known module IDs and their `import()` callbacks. Bun statically analyzes these imports so tree-shaking and workspace resolution stay correct — there is no string-interpolated dynamic loading. Adding a new module requires adding it here so `ModuleRegistry.loadAll()` can dynamically import it.

### Active modules per role

`apps/api/src/index.ts:25-28` declares the module array for the API role (currently `["auth", "billing", "example"]`). `apps/api/src/worker.ts:21-24` declares the array for the worker role (currently `["example", "billing"]`). A module name must appear in the appropriate role's array or it will not load. Keep both arrays in sync unless a module is role-specific.

### Event-bus hooks

Modules that enqueue BullMQ jobs in response to domain events wire an additional `register{Module}Hooks(eventBus)` call in `apps/api/src/index.ts`. `registerBillingHooks` and `registerExampleHooks` are the two current consumers; each subscribes to its module's events on `registry.getEventBus()` and forwards to the appropriate queue. Adding this wiring is part of the module-registration checklist — forgetting it leaves the event-to-job path silently disconnected.

## Provider selection

The billing module loads the payment provider via `getPaymentProvider` in `packages/modules/billing/src/provider-factory.ts`. The function branches on `PAYMENT_PROVIDER` and returns a lazy singleton — the adapter module is imported only when first needed, so tests and environments that do not use billing never pay the SDK load cost. Adding a third provider follows the same port-and-adapter pattern Pagar.me followed alongside Stripe — see [billing integration](./integrations/billing.md) §"Add another payment provider".

## Deployment configuration

### docker-compose.yml

Dev and CI use `docker-compose.yml` which launches `postgres:16`, `redis:7`, `api`, `worker`, and `admin` services. Start with `bun docker:up`, stop with `bun docker:down`. The `postgres` and `redis` services bind ports 5432 and 6379 respectively so the host-side `bun api` process can connect without running inside a container.

### Dockerfiles

Production images are built from `Dockerfile.api`, `Dockerfile.worker`, and `Dockerfile.admin`. Multi-stage builds are used to keep runtime images minimal: a builder stage runs `bun install --production=false` and `bun run build` where applicable, and the runtime stage copies only the compiled output and production dependencies.

### Worker health endpoint

`apps/api/src/worker.ts:84-125` mounts an HTTP server on `WORKER_HEALTH_PORT` (default 3001) serving `GET /health` for Docker and Kubernetes liveness probes. The response includes Redis connectivity (`redis.ping()`) and active worker count with per-queue status, so orchestrators can restart the pod when Redis becomes unreachable or workers fail to start.

## Security notes

- Never commit real secret values. All examples in this repository's documentation use placeholder values such as `sk_test_xxx` or `your-secret-here`.
- `BETTER_AUTH_SECRET` MUST be at least 32 characters (enforced by `z.string().min(32)`).
- Webhook secrets (`STRIPE_WEBHOOK_SECRET`, `PAGARME_WEBHOOK_SECRET`) are required in production for signature verification. Missing webhook secrets allow spoofed webhook events.
- `RESEND_API_KEY` absence is treated as "email not configured" — the dispatcher logs and returns without throwing. This is intentional for dev and test environments.

## Next steps

- [Getting started](./getting-started.md) — minimum env setup for local dev.
- [Add a module](./add-a-module.md) — where module env vars are read.
- Integration docs under [integrations/](./integrations/) — per-integration env var requirements.
