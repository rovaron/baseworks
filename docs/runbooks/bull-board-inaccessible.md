# Bull-board inaccessible — admin queue UI not loading

> Source alert: [docs/alerts/sentry/bull-board-inaccessible.json](../alerts/sentry/bull-board-inaccessible.json)

## Trigger

Sentry Issue Alert `bull-board-inaccessible` fires when 401/403 responses for `/admin/bull-board/*` exceed threshold within a 5-minute window, OR when CSP `frame-ancestors` violations are reported by the admin dashboard. Maps to `docs/alerts/sentry/bull-board-inaccessible.json`.

## Symptoms

- Admin dashboard → Jobs page renders an empty / blank iframe.
- Direct navigation to `/admin/bull-board` returns `401 Unauthorized` (no session) or `403 Forbidden` (wrong role).
- bull-board static assets (CSS, JS) return 401 in the Network tab — see Phase 22 D-01..04 for why this is by design.
- Browser console shows `Refused to frame ... violates Content Security Policy directive: frame-ancestors`.
- API pino logs include `requireRole: insufficient role` events on `/admin/bull-board` paths.

## Triage

> These commands assume `docker-compose.yml` from the repo root. K8s / PaaS users translate to `kubectl exec` / equivalent.

> **Wait 5 minutes before action** to confirm this is not a deploy blip. The alert's frequency window is 5m. A user who briefly hit the page before logging in produces a transient 401 batch that resolves on its own.

1. Confirm the api is up:

   ```bash
   docker compose ps api
   curl -i http://localhost:3000/health
   ```

2. Probe `/admin/bull-board` unauthenticated — expect `401`:

   ```bash
   curl -i http://localhost:3000/admin/bull-board
   ```

   Expected response: `401 Unauthorized`. A `200` here would be a security regression — bull-board is gated by `requireRole("owner")` (see `apps/api/src/routes/bull-board.ts:73-78` for the plugin composition).

3. Probe `/admin/bull-board` with an owner session cookie — expect `200 HTML`:

   ```bash
   curl -i -H "cookie: <owner session>" http://localhost:3000/admin/bull-board
   ```

   If you do not have an owner session, sign in to the admin dashboard, open DevTools → Application → Cookies, and copy the better-auth session cookie value.

4. Probe a static asset path — expect `200`:

   ```bash
   curl -i -H "cookie: <owner session>" http://localhost:3000/admin/bull-board/static/main.js
   ```

   `401` here is the expected and documented behaviour from Phase 22 D-01..04 — every asset request flows through `requireRole("owner")`. This is NOT a bug; it is the security model. The fix is "use a session" not "remove the gate."

5. Inspect the browser DevTools console for CSP violations:

   - Open the admin dashboard → Jobs page.
   - DevTools → Console → look for: `Refused to frame 'http://localhost:3000/' because it violates the following Content Security Policy directive: "frame-ancestors http://localhost:5173"`.
   - That directive is set by `apps/api/src/routes/bull-board.ts:73-75` from `$ADMIN_URL`. A mismatch means the iframe origin (the Vite dev server) is not in the allow-list.

6. Verify the env vars driving this surface:

   ```bash
   docker compose exec api printenv | grep -E 'ADMIN_URL|BULL_BOARD_READ_ONLY'
   ```

   `BULL_BOARD_READ_ONLY` defaults to `"true"` (see `packages/config/src/env.ts:49`); set to `"false"` only when you need to retry / remove jobs from the dashboard. `ADMIN_URL` is the iframe parent origin used in `frame-ancestors`.

## The 4 failure modes (Phase 22 D-01..04)

The mount path is `/admin/bull-board` (per `apps/api/src/routes/bull-board.ts:42-43`). All four failure modes flow through that path. Walk through them in order:

### 1. 401 (no session)

The user is not logged in. `requireRole("owner")` throws `Unauthorized` because `derive` has no userId.

- **Fix:** Log in as an owner first, then revisit `/admin/bull-board`.
- **Diagnostic:** Network tab shows `401` on the very first request (the HTML doc itself). No cookies present in the request.

### 2. 403 (wrong role)

The user is logged in but does not have `owner` on the active organization. better-auth's role check rejects.

- **Fix:** Assign the owner role through better-auth admin UI / SQL update, OR use the `getFullOrganization()` workaround (documented in Phase 13 notes — known better-auth limitation).
- **Diagnostic:** Network tab shows `403` after the session cookie is present. `derive` returned a userId but `requireRole` rejected.

### 3. CSP frame-ancestors block

The iframe parent origin (the admin dashboard) does not match `$ADMIN_URL`. Browser refuses to embed.

- **Fix:** Align `$ADMIN_URL` with the actual admin URL. For local dev, `http://localhost:5173`. For staging/prod, the hosted admin URL.
- **Diagnostic:** Browser DevTools console shows the `Refused to frame` line. Network tab shows `200 OK` on the HTML doc — the response is fine, the BROWSER blocks rendering.

### 4. Static asset 401 (expected, NOT a bug)

bull-board's CSS/JS load through the same `requireRole("owner")` plugin. Each asset request needs the owner session cookie.

- **Fix:** Nothing — this is by design. The Vite proxy in admin dev forwards cookies; production deployments need the dashboard and api on the same parent domain (or a cookie-forwarding proxy).
- **Diagnostic:** Network tab shows `401` on `/admin/bull-board/static/*.js` requests AFTER the HTML doc loaded `200`. The HTML rendered, the JS did not.

## Resolution

### Most likely: not logged in as owner (cases 1 + 2)

Sign in to the admin dashboard with an owner-role account, navigate to Jobs, refresh. The iframe should render bull-board's queue list with a Job Monitor title bar.

If the user is logged in but lacks owner, run a one-shot SQL update on the `member` table to grant owner OR have an existing owner promote them via the better-auth admin endpoints.

### If that did not work: CSP origin mismatch (case 3)

Set `ADMIN_URL` to match the actual admin URL the iframe is hosted at:

```bash
# .env
ADMIN_URL=http://localhost:5173    # local dev
# OR for staging
ADMIN_URL=https://admin.staging.example.com
```

Restart api:

```bash
docker compose restart api
```

The CSP header `content-security-policy: frame-ancestors '$ADMIN_URL'` is set on every request via `onRequest` (per `apps/api/src/routes/bull-board.ts:73-75`).

### If that did not work: BULL_BOARD_READ_ONLY rejecting destructive actions

If you can SEE the dashboard but Retry / Remove buttons do nothing, `BULL_BOARD_READ_ONLY="true"` is the default (per `packages/config/src/env.ts:49`). To enable destructive actions for an incident response window:

```bash
# .env
BULL_BOARD_READ_ONLY=false
```

Restart api. **Set it back to `"true"` after the incident** — read-only is the safer default for production.

## Escalation

If stuck longer than 30 minutes:

- Open an issue with: the failure mode case (1/2/3/4), the user's role on the active organization, `ADMIN_URL` value, browser DevTools console output (CSP violations), Network tab screenshot of the failed request.
- Post in repo discussions with the same artefacts.
- Check upstream:
  - bull-board release notes — https://github.com/felixmosh/bull-board/releases
  - Bun isolated-install + uiBasePath workaround — https://github.com/oven-sh/bun/issues/5809
- For CSP-specific issues, your reverse proxy / CDN may be stripping or rewriting `Content-Security-Policy` headers. Check there before suspecting api code.
- Page yourself for the next attempt.

See also:

- [queue-backing-up.md](./queue-backing-up.md) — When you NEED bull-board for diagnosis.
- [auth-outage.md](./auth-outage.md) — When the failure mode is "session itself broken" rather than RBAC.
- [../observability/trace-propagation.md](../observability/trace-propagation.md) — Forward-looking: how OTel context will eventually surface in bull-board UI.
