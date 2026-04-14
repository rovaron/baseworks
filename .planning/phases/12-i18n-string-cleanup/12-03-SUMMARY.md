---
phase: 12-i18n-string-cleanup
plan: 03
subsystem: backend
tags: [i18n, invite, email, bullmq, als, elysia, backend]
requirements: [INVT-02]
requires:
  - packages/i18n/src/index.ts
  - packages/modules/auth/src/routes.ts
  - packages/modules/billing/src/jobs/send-email.ts
provides:
  - request-scoped locale capture via AsyncLocalStorage + Elysia middleware
  - framework-agnostic interpolate(template, vars) helper in @baseworks/i18n
  - pt-BR + en invite.email.* localized string subtrees
  - pure-presentation TeamInviteEmail React component
  - worker-side pre-resolution of team-invite translations including subject
affects:
  - better-auth sendInvitationEmail callback now reads request locale
  - BullMQ email queue payload gains optional locale field
  - apps/api Elysia chain gains localeMiddleware between requestTrace and cors
tech-stack:
  added:
    - AsyncLocalStorage (node:async_hooks) for request-scoped locale
  patterns:
    - Worker pre-resolution of translated strings + pure presentation React Email template
    - Token interpolation via {variable} delimiters (matches next-intl / react-i18next)
    - Allowlist validation of cookie-sourced locale before dynamic import
key-files:
  created:
    - packages/modules/auth/src/locale-context.ts
  modified:
    - packages/i18n/src/index.ts
    - packages/i18n/src/locales/en/invite.json
    - packages/i18n/src/locales/pt-BR/invite.json
    - packages/modules/auth/src/index.ts
    - packages/modules/auth/src/auth.ts
    - packages/modules/auth/package.json
    - packages/modules/billing/src/templates/team-invite.tsx
    - packages/modules/billing/src/jobs/send-email.ts
    - packages/modules/billing/package.json
    - apps/api/src/index.ts
    - bun.lock
decisions:
  - Captured locale via AsyncLocalStorage.enterWith in Elysia .onRequest hook to avoid touching better-auth plugin config (D-02)
  - Widened getMessages return type to Record<string, Record<string, unknown>> to support nested subtree casts in the worker
  - Team-invite is the only template localized at send time; other 4 templates keep English copy per D-10
  - Added @baseworks/i18n workspace dep to both module-auth (for Locale type import) and module-billing (for getMessages/interpolate)
metrics:
  tasks_completed: 5
  files_created: 1
  files_modified: 10
  commits: 5
---

# Phase 12 Plan 03: Team Invite Email Localization Summary

Close GAP-1 from the v1.1 milestone audit by localizing the team-invite transactional email end-to-end using an AsyncLocalStorage-based request locale capture, worker-side translation pre-resolution, and a pure-presentation React Email template.

## Files Created

- `packages/modules/auth/src/locale-context.ts` (67 lines) — AsyncLocalStorage store, `getLocale()` accessor, `parseNextLocaleCookie` allowlist validator, and Elysia `localeMiddleware` plugin

## Files Modified (10)

- `packages/i18n/src/locales/en/invite.json` — added `email` top-level subtree
- `packages/i18n/src/locales/pt-BR/invite.json` — added `email` top-level subtree
- `packages/i18n/src/index.ts` — new `interpolate` export, widened `getMessages` return type
- `packages/modules/auth/src/index.ts` — re-export `localeMiddleware`, `getLocale`
- `packages/modules/auth/src/auth.ts` — sendInvitationEmail reads locale via `getLocale()` and puts it on BullMQ payload
- `packages/modules/auth/package.json` — added `@baseworks/i18n` workspace dep (blocking issue: locale-context.ts needs `Locale`/`locales`/`defaultLocale` imports — Rule 3 auto-fix)
- `packages/modules/billing/src/templates/team-invite.tsx` — refactored to pure presentation with `{inviteLink, heading, body, ctaLabel, footer}` prop shape
- `packages/modules/billing/src/jobs/send-email.ts` — new `resolveTeamInvite` helper, localized team-invite branch
- `packages/modules/billing/package.json` — added `@baseworks/i18n` workspace dep
- `apps/api/src/index.ts` — mounted `localeMiddleware` between `requestTraceMiddleware` and `cors`, before `authRoutes`
- `bun.lock` — workspace edge resolution

## Commits

| # | Hash | Task | Subject |
|---|------|------|---------|
| 1 | b76ef4e | Task 1 | feat(12-03): add invite.email subtree to en and pt-BR locales |
| 2 | 9f5014a | Task 2 | feat(12-03): add interpolate helper and widen getMessages return type |
| 3 | 54d66d3 | Task 3 | feat(12-03): add locale-context ALS module and wire Elysia middleware |
| 4 | 8c4eab7 | Task 4 | feat(12-03): make TeamInviteEmail pure presentation and read locale in callback |
| 5 | 7fe445f | Task 5 | feat(12-03): pre-resolve team-invite translations in send-email worker |

## Before / After — Critical Diffs

### TeamInviteEmail (team-invite.tsx)

Before (hardcoded English copy + 4 data props):

```tsx
interface TeamInviteEmailProps {
  inviteLink: string;
  organizationName: string;
  inviterName: string;
  role: string;
}
// ...
<Text style={{ fontSize: "24px", fontWeight: "bold" }}>
  You're invited to {organizationName}
</Text>
<Text>
  {inviterName} has invited you to join {organizationName} as a {role}.
</Text>
<Button ...>Accept Invitation</Button>
<Text style={{ color: "#71717a", fontSize: "14px" }}>
  If you were not expecting this invitation, you can ignore this email.
</Text>
```

After (pure presentation, pre-resolved strings):

```tsx
interface TeamInviteEmailProps {
  inviteLink: string;
  heading: string;
  body: string;
  ctaLabel: string;
  footer: string;
}
// ...
<Text style={{ fontSize: "24px", fontWeight: "bold" }}>{heading}</Text>
<Text>{body}</Text>
<Button ...>{ctaLabel}</Button>
<Text style={{ color: "#71717a", fontSize: "14px" }}>{footer}</Text>
```

Styling byte-identical: `"Arial, sans-serif"`, `"#f4f4f5"`, `"480px"`, `"#18181b"`, `"#71717a"` all preserved.

### sendInvitationEmail callback (auth.ts)

Before:

```ts
const queue = getEmailQueue();
const inviteLink = `${env.WEB_URL}/invite/${data.id}`;
if (queue) {
  await queue.add("team-invite", {
    to: data.email,
    template: "team-invite",
    data: { inviteLink, organizationName, inviterName, role },
  });
} else {
  console.log(`[AUTH] Team invite for ${data.email}: ${inviteLink}`);
}
```

After:

```ts
const locale = getLocale(); // NEW
const queue = getEmailQueue();
const inviteLink = `${env.WEB_URL}/invite/${data.id}`;
if (queue) {
  await queue.add("team-invite", {
    to: data.email,
    template: "team-invite",
    data: { inviteLink, organizationName, inviterName, role, locale }, // locale added
  });
} else {
  console.log(
    `[AUTH] Team invite for ${data.email} (locale=${locale}): ${inviteLink}`,
  );
}
```

`@internal` suppression branch at top preserved byte-identically.

### send-email.ts new `resolveTeamInvite` helper

```ts
async function resolveTeamInvite(data: {
  inviteLink: string;
  organizationName: string;
  inviterName: string;
  role: string;
  locale?: Locale;
}): Promise<{ props: ...; subject: string }> {
  const locale: Locale = data.locale ?? defaultLocale;
  const messages = await getMessages(locale);
  const email = messages.invite?.email as Record<...> | undefined;
  // defensive fallback to defaultLocale if subtree missing
  const fallback = locale === defaultLocale ? email : (((await getMessages(defaultLocale)).invite?.email as typeof email));
  const resolved = email ?? fallback;
  if (!resolved) throw new Error(`Missing invite.email messages for locale=${locale}`);
  const roleLabel = resolveRoleLabel(messages, data.role);
  const vars = { orgName: data.organizationName, inviterName: data.inviterName, roleLabel };
  return {
    props: {
      inviteLink: data.inviteLink,
      heading: interpolate(resolved.heading, vars),
      body: interpolate(resolved.body, vars),
      ctaLabel: resolved.cta,
      footer: resolved.footer,
    },
    subject: resolved.subject,
  };
}

// sendEmail branches:
if (template === "team-invite") {
  const { props, subject: resolvedSubject } = await resolveTeamInvite(templateData as ...);
  html = await render(TeamInviteEmail(props));
  subject = resolvedSubject;
} else {
  const Component = templates[template];
  if (!Component) throw new Error(`Unknown email template: ${template}`);
  html = await render(Component(templateData));
  subject = subjects[template] ?? "Notification";
}
```

Other 4 templates (welcome, password-reset, magic-link, billing-notification) retain their static subject + English content paths — the `else` branch is byte-identical to pre-Phase-12.

### apps/api/src/index.ts chain

Before:

```ts
.use(errorMiddleware)
.use(requestTraceMiddleware)
.use(cors({ ... }))
```

After:

```ts
.use(errorMiddleware)
.use(requestTraceMiddleware)
// Locale capture (Phase 12 D-02) -- reads NEXT_LOCALE cookie into AsyncLocalStorage
// so sendInvitationEmail and other auth callbacks can resolve the request locale
// without touching better-auth's plugin config.
.use(localeMiddleware)
.use(cors({ ... }))
```

Chain order verified: `requestTraceMiddleware` (line 47) < `localeMiddleware` (line 51) < `authRoutes` (line 97).

### invite.json new `email` subtree

English:

```json
"email": {
  "heading": "You're invited to {orgName}",
  "body": "{inviterName} has invited you to join {orgName} as a {roleLabel}.",
  "cta": "Accept Invitation",
  "footer": "If you were not expecting this invitation, you can ignore this email.",
  "subject": "You're Invited to Join a Team"
}
```

Portuguese:

```json
"email": {
  "heading": "Você foi convidado para {orgName}",
  "body": "{inviterName} convidou você para entrar em {orgName} como {roleLabel}.",
  "cta": "Aceitar Convite",
  "footer": "Se você não estava esperando este convite, pode ignorar este email.",
  "subject": "Você foi convidado para uma equipe"
}
```

Subject lengths: `30` (en) and `34` (pt-BR) chars — well under the 60-char limit.

## Verification Evidence

### JSON validity

```
$ bun -e "JSON.parse(require('fs').readFileSync('packages/i18n/src/locales/en/invite.json','utf8')); JSON.parse(require('fs').readFileSync('packages/i18n/src/locales/pt-BR/invite.json','utf8')); console.log('ok')"
ok
```

### interpolate smoke test

```
$ bun -e "import('./packages/i18n/src/index.ts').then(m => { ... })"
ok
# Covers: happy path, missing token, number coercion, repeated tokens
```

### Grep acceptance checks

| Check | Expected | Actual |
|-------|----------|--------|
| `grep -c "\"email\"" en/invite.json` | >= 1 | 1 |
| `grep -c "\"email\"" pt-BR/invite.json` | >= 1 | 1 |
| `grep -c "Aceitar Convite" pt-BR/invite.json` | >= 2 | 2 |
| `grep -c "export function interpolate" packages/i18n/src/index.ts` | 1 | 1 |
| `grep -c "Record<string, Record<string, unknown>>" packages/i18n/src/index.ts` | >= 1 | 2 |
| `grep -c "Record<string, Record<string, string>>" packages/i18n/src/index.ts` | 0 | 0 |
| `grep -c "AsyncLocalStorage" packages/modules/auth/src/locale-context.ts` | >= 1 | 2 |
| `grep -c "enterWith" packages/modules/auth/src/locale-context.ts` | >= 1 | 1 |
| `grep -c "export function getLocale" packages/modules/auth/src/locale-context.ts` | 1 | 1 |
| `grep -c "export const localeMiddleware" packages/modules/auth/src/locale-context.ts` | 1 | 1 |
| `grep -c "NEXT_LOCALE" packages/modules/auth/src/locale-context.ts` | >= 1 | 2 |
| `grep -c "localeMiddleware" packages/modules/auth/src/index.ts` | >= 1 | 1 |
| `grep -c "localeMiddleware" apps/api/src/index.ts` | >= 2 | 2 |
| `grep -c "You're invited to" team-invite.tsx` | 0 | 0 |
| `grep -c "Accept Invitation" team-invite.tsx` | 0 | 0 |
| `grep -c "If you were not expecting" team-invite.tsx` | 0 | 0 |
| `grep -c "organizationName" team-invite.tsx` | 0 | 0 |
| `grep -c "@baseworks/i18n" team-invite.tsx` | 0 | 0 |
| `grep -c "\"Arial, sans-serif\"" team-invite.tsx` | 1 | 1 |
| `grep -c "\"#18181b\"" team-invite.tsx` | 1 | 1 |
| `grep -c "getLocale" auth.ts` | >= 2 | 2 |
| `grep -c "endsWith(\"@internal\")" auth.ts` | 1 | 1 |
| `grep -c "Link-mode invite (no email)" auth.ts` | 1 | 1 |
| `grep -c "@baseworks/i18n" packages/modules/billing/package.json` | >= 1 | 1 |
| `grep -c "getMessages" send-email.ts` | >= 1 | 3 |
| `grep -c "interpolate" send-email.ts` | >= 2 | 3 |
| `grep -c "resolveTeamInvite" send-email.ts` | >= 2 | 4 |
| `grep -c "template === \"team-invite\"" send-email.ts` | >= 1 | 1 |
| `grep -c "Welcome to Baseworks!" send-email.ts` | 1 | 1 |
| `grep -c "Reset Your Password" send-email.ts` | 1 | 1 |
| `grep -c "Your Sign-in Link" send-email.ts` | 1 | 1 |
| `grep -c "Billing Update" send-email.ts` | 1 | 1 |

All 30+ grep acceptance checks pass.

### Elysia chain order check

```
$ awk '/\.use\(requestTraceMiddleware\)/{t=NR} /\.use\(localeMiddleware\)/{l=NR} /\.use\(authRoutes/{if(!a)a=NR} END{print t, l, a}' apps/api/src/index.ts
47 51 97
```

Trace(47) < Locale(51) < AuthRoutes(97) — correct insertion point.

### bun install — no cycle warnings

```
$ bun install 2>&1 | grep -iE "cycle|circular" | wc -l
0
```

`@baseworks/i18n` has zero workspace dependencies (it only re-exports JSON files), so the new `billing -> i18n` and `auth -> i18n` edges are both one-way and cycle-free.

### Typecheck

Baseline error count at merge base `9469cf2` (before this plan): **67 `error TS` occurrences**.

Error count at `HEAD` (7fe445f, after all 5 tasks): **67 `error TS` occurrences**.

No new TypeScript errors introduced by this plan. All 67 pre-existing errors are unrelated:

- `Cannot find module 'bullmq'` / `'nanoid'` — pre-existing root `tsconfig.json` moduleResolution issue, present in auth.ts line 7 before any edit and unchanged
- `Cannot find namespace 'JSX'` + `'react/jsx-runtime'` — pre-existing React type config issue affecting all 4 email templates and send-email.ts line 15 (formerly line 9); the line number shifted only because the import block grew
- Test file errors in `__tests__/invitation.test.ts`, `__tests__/billing.test.ts`, `__tests__/pagarme-adapter.test.ts`, `__tests__/queue.test.ts` — pre-existing test scaffolding issues outside this plan's scope

These are all out-of-scope per the Scope Boundary rule (only auto-fix issues directly caused by current task's changes). None were introduced or aggravated by Phase 12-03.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `@baseworks/i18n` workspace dep to `packages/modules/auth/package.json`**

- **Found during:** Task 3
- **Issue:** The plan listed `packages/modules/billing/package.json` as the module that needed a new `@baseworks/i18n` dep (for Task 5 consumers of `getMessages` + `interpolate`), but overlooked that the new `packages/modules/auth/src/locale-context.ts` also imports `defaultLocale`, `locales`, and the `Locale` type from `@baseworks/i18n`. Without adding the dep to `module-auth/package.json`, TypeScript's module resolver would fail (`Cannot find module '@baseworks/i18n'`).
- **Fix:** Added `"@baseworks/i18n": "workspace:*"` to `packages/modules/auth/package.json` dependencies, alphabetically sorted within the `@baseworks/*` scope. Re-ran `bun install` to refresh `bun.lock` with the new workspace edge.
- **Files modified:** `packages/modules/auth/package.json`
- **Commit:** 54d66d3 (bundled into Task 3 since the dep is logically part of creating locale-context.ts)
- **Cycle check:** `@baseworks/i18n` still has zero workspace dependencies, so `auth -> i18n` is a safe one-way edge. `bun install` exited 0 with no cycle warnings.

**2. [Non-deviation] Task 4 intentional bundled commit**

Task 4 in the plan lists `team-invite.tsx` and `auth.ts` as modified together. The plan itself states the two must land in the same commit because `auth.ts` imports from `./locale-context` (created in Task 3) and the template prop shape change means `auth.ts` no longer fully drives the template. Committed as one unit per plan instructions (commit 8c4eab7).

### Ask-first Deviations

None.

## Auth / Human-verify Gates

None hit. Plan was fully autonomous.

## D-10 Guarantee — Other Templates Untouched

Confirmed via grep that the following pre-Phase-12 hardcoded subjects remain byte-identical in `packages/modules/billing/src/jobs/send-email.ts`:

- `"Welcome to Baseworks!"` (welcome)
- `"Reset Your Password"` (password-reset)
- `"Your Sign-in Link"` (magic-link)
- `"Billing Update"` (billing-notification)

The `else` branch in `sendEmail` (templates[template] lookup + subjects[template] lookup + `render(Component(templateData))`) is byte-identical to the pre-Phase-12 code path — confirmed by diff review against commit `45a07a2`'s parent.

## @internal Suppression Guarantee

Confirmed via grep that the Phase 9 D-11 contract is preserved:

- `grep -c 'endsWith("@internal")' packages/modules/auth/src/auth.ts` → 1
- `grep -c "Link-mode invite (no email)" packages/modules/auth/src/auth.ts` → 1

The entire 4-line suppression branch at the top of `sendInvitationEmail` is byte-identical to the pre-Phase-12 version.

## Threat Model Outcome

All 9 STRIDE threats in the plan's `<threat_model>` have their dispositions met:

- **T-12-06 (Cookie locale tampering) — mitigate:** `parseNextLocaleCookie` validates against `locales as readonly string[]` allowlist. Unknown values fall through to `defaultLocale`. Verified by code inspection of `packages/modules/auth/src/locale-context.ts:42-50`.
- **T-12-07 (Dynamic import path traversal) — mitigate:** `getMessages` only accepts values from the allowlisted union. No path-traversal surface.
- **T-12-08 (Token injection in template) — mitigate:** `interpolate` regex is `/\{(\w+)\}/g` (word chars only), output flows into React Email JSX which escapes text nodes.
- **T-12-09 through T-12-14 — accept/mitigate:** No new code paths added that cross a trust boundary beyond the plan's design.

No threat flags — no new security surface introduced beyond what the threat register already documents.

## Known Stubs

None. All new code paths are wired end-to-end from cookie -> ALS -> better-auth callback -> BullMQ payload -> worker getMessages -> interpolate -> React Email render -> Resend send.

## Self-Check: PASSED

- `packages/modules/auth/src/locale-context.ts` — FOUND
- `packages/i18n/src/locales/en/invite.json` email subtree — FOUND
- `packages/i18n/src/locales/pt-BR/invite.json` email subtree — FOUND
- `packages/i18n/src/index.ts` interpolate export — FOUND
- `apps/api/src/index.ts` localeMiddleware mount — FOUND
- Commit `b76ef4e` — FOUND
- Commit `9f5014a` — FOUND
- Commit `54d66d3` — FOUND
- Commit `8c4eab7` — FOUND
- Commit `7fe445f` — FOUND
