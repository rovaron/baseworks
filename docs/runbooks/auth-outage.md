# Auth outage — better-auth login failure spike

> Source alert: [docs/alerts/sentry/auth-outage.json](../alerts/sentry/auth-outage.json)

## Trigger

Sentry Issue Alert `auth-outage` fires when `>=50` events tagged `kind=auth` (or originating from `/api/auth/*`) land within a 5-minute window. Maps to `docs/alerts/sentry/auth-outage.json`.

## Symptoms

- `/api/auth/sign-in` and `/api/auth/sign-up` return 500 unexpectedly. Users see "Login failed" toasts they did not before.
- `/api/auth/session` returns 500 instead of `200 with null` for unauthenticated users.
- API pino logs include `auth: invalid session`, `Error: relation "user" does not exist`, or `Error: ETIMEDOUT` from the auth tables.
- Sentry / GlitchTip Issues view shows a sharp spike of events tagged `module=auth` or with stack frames from `better-auth/dist/`.
- Customer reports: "I can't log in" — suddenly, after a deploy or env change.

## Triage

> These commands assume `docker-compose.yml` from the repo root. K8s / PaaS users translate to `kubectl exec` / equivalent.

> **Wait 5 minutes before action** to confirm this is not a deploy blip. The alert's frequency window is 5m. A rolling deploy that briefly drained the api process can produce a transient batch of auth events that resolves on its own.

1. Confirm the infrastructure layer first:

   ```bash
   docker compose ps
   ```

   If postgres or redis are down, see [db-down.md](./db-down.md) or [redis-down.md](./redis-down.md) — auth depends on both. Auth recovery is downstream.

2. Tail the api logs filtered for auth lines:

   ```bash
   docker compose logs api --tail 200 -f | grep -iE 'auth|better-auth|sign-in|sign-up|session'
   ```

   Look for repeating exception types. Common groupings:
   - `relation "user" does not exist` — schema drift; auth migrations did not run.
   - `Invalid SECRET` / `BETTER_AUTH_SECRET` empty — env misconfig.
   - `Invalid trusted origin` — `BETTER_AUTH_TRUSTED_ORIGINS` mismatch with the actual frontend URL.
   - `JWT expired` / `Invalid signature` — clock skew between containers OR a rotated secret.

3. Probe the unauthenticated session endpoint:

   ```bash
   curl -i http://localhost:3000/api/auth/session
   ```

   Expected: `200 OK` with `{"data":null,"error":null}` (no logged-in user). A `401` here is expected if your config requires auth. A `500` is the real signal — better-auth itself is failing, not just rejecting bad credentials.

4. Check Sentry / GlitchTip for the active Issue:
   - Open the `auth-outage` Issue.
   - Group by error message — a single root cause typically dominates.
   - Inspect the `tags` for `tenantId`, `userId`, and `release`. A spike scoped to one `release` confirms a deploy regression.

5. (If you have an owner session) probe the auth contributor through `/health/detailed`:

   ```bash
   curl -s -H "cookie: <owner session>" http://localhost:3000/health/detailed | jq '.data.modules[] | select(.name == "auth")'
   ```

   The `auth` module entry exists per the registry-loaded list from `apps/api/src/index.ts:64-67`. Status defaults to `"healthy"` per Phase 22 D-16 unless the auth module ships a `HealthContributor` (none in v1.3).

## Resolution

### Most likely: better-auth schema drift (post-deploy)

A new release upgraded `better-auth` and added columns / tables that the running DB does not have. Apply migrations:

```bash
docker compose exec api bun run db:migrate
docker compose logs api --tail 50  # confirm api is healthy after migrate
```

Drizzle's `_journal.json` (at `packages/db/drizzle/meta/_journal.json`) tracks applied migrations. If migrations are out of order vs the journal, Drizzle will reject the run — see [../integrations/better-auth.md](../integrations/better-auth.md) for the canonical migration flow and the better-auth → Drizzle adapter contract.

### If that did not work: session cookie domain mismatch

After a domain rename or a frontend URL change, `BETTER_AUTH_TRUSTED_ORIGINS` may no longer include the actual frontend origin. Login redirects fail with "Invalid trusted origin" in the api logs.

```bash
docker compose exec api printenv BETTER_AUTH_TRUSTED_ORIGINS
docker compose exec api printenv BETTER_AUTH_SECRET | head -c 10
```

`BETTER_AUTH_TRUSTED_ORIGINS` should be a comma-separated list including every frontend URL (web app, admin dashboard, Vercel preview deploys if applicable). Update the env file and restart:

```bash
docker compose restart api
```

### If that did not work: secret rotation without restart

If `BETTER_AUTH_SECRET` was rotated but the api process was not restarted, every existing session token will fail validation while new sessions issued during the same process lifetime work. Stale tokens accumulate.

```bash
docker compose restart api
```

After restart, all existing sessions are invalidated server-side. Users must log in again. Communicate this if you can — the customer impact is "logged out without warning."

### If that did not work: clock skew between containers

If you see `JWT expired` errors across all sessions, container clocks may have drifted. Check:

```bash
docker compose exec api date
docker compose exec postgres date
date  # host clock
```

Clocks should be within a few seconds. Container clocks drift if the host runs `ntpd` but the container does not have access to `/etc/timezone`. On a fresh restart of the host or `systemctl restart systemd-timesyncd`, this self-corrects.

## Escalation

If stuck longer than 30 minutes:

- Open an issue with: timestamp of the spike onset, current `release` tag, the dominant error message from Sentry, the output of `bun run db:migrate` (or a screenshot of the journal vs migrations folder), and the affected user count from `auth-outage` Issue.
- Post in repo discussions with the same artefacts.
- Check upstream provider status:
  - better-auth release notes — https://github.com/better-auth/better-auth/releases
  - Drizzle release notes — https://orm.drizzle.team/changelog
- If your fork uses OAuth providers (Google, GitHub, Apple), check those providers' status pages — a callback URL mismatch on the provider side surfaces here as "auth outage" too.
- Page yourself for the next attempt rather than burning out.

See also:

- [db-down.md](./db-down.md) — auth tables live in postgres; DB outage cascades.
- [redis-down.md](./redis-down.md) — if Redis is the session store, Redis outage cascades.
- [../integrations/better-auth.md](../integrations/better-auth.md) — canonical auth flow.
