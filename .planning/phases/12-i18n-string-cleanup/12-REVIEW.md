---
phase: 12-i18n-string-cleanup
reviewed: 2026-04-14T00:00:00Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - apps/admin/src/layouts/admin-layout.tsx
  - apps/admin/src/lib/i18n.ts
  - apps/api/src/index.ts
  - apps/web/app/(auth)/layout.tsx
  - apps/web/app/(dashboard)/layout.tsx
  - packages/i18n/src/index.ts
  - packages/i18n/src/locales/en/invite.json
  - packages/i18n/src/locales/pt-BR/invite.json
  - packages/modules/auth/package.json
  - packages/modules/auth/src/auth.ts
  - packages/modules/auth/src/index.ts
  - packages/modules/auth/src/locale-context.ts
  - packages/modules/billing/package.json
  - packages/modules/billing/src/jobs/send-email.ts
  - packages/modules/billing/src/templates/team-invite.tsx
  - packages/ui/src/components/__tests__/skip-link.a11y.test.tsx
  - packages/ui/src/components/skip-link.tsx
findings:
  critical: 0
  warning: 4
  info: 7
  total: 11
status: issues_found
---

# Phase 12: Code Review Report

**Reviewed:** 2026-04-14
**Depth:** standard
**Files Reviewed:** 17
**Status:** issues_found

## Summary

Phase 12 i18n string cleanup landed three sub-phases: skip-link localization,
admin invite namespace, and team-invite email localization. The implementation
is generally well-structured: the `localeMiddleware` + `AsyncLocalStorage`
approach cleanly avoids touching better-auth internals, the `TeamInviteEmail`
React Email template was correctly refactored into a pure presentation
component, and the `interpolate()` helper in `@baseworks/i18n` is a tidy,
single-purpose utility.

No Critical issues were found — there are no security vulnerabilities, no
secret leaks, and no crashes on the happy path. Findings cluster around
defensive correctness (silent `subject` fallback gap, `enterWith` async
context caveat, eager fallback loading) and a few stale code-quality items
(legacy `JSX.Element` typing, unused `templates["team-invite"]` entry,
inconsistent UI subpath imports, an English grammar nit).

## Warnings

### WR-01: `resolveTeamInvite` may emit `undefined` subject if locale subtree is partial

**File:** `packages/modules/billing/src/jobs/send-email.ts:79-106`
**Issue:** The fallback logic only fires when the entire `invite.email` subtree
is missing for the current locale. If a translator adds the locale's
`invite.email` block but forgets the `subject` key (or any individual key),
`resolved.subject`, `resolved.heading`, etc. will be `undefined`. That string
is then handed to Resend as the email subject and to the React component as
text — Resend will accept `undefined` and render an empty subject line,
violating the D-09/D-10 intent.
**Fix:** Validate per-key, not per-subtree, and fall back to English on a
key-by-key basis. Example:

```typescript
const enEmail = (await getMessages(defaultLocale)).invite?.email as
  | Record<"heading" | "body" | "cta" | "footer" | "subject", string>
  | undefined;
const localeEmail = email; // already loaded above

const pick = (key: "heading" | "body" | "cta" | "footer" | "subject") => {
  const v = localeEmail?.[key] ?? enEmail?.[key];
  if (!v) {
    throw new Error(
      `Missing invite.email.${key} for locale=${locale} (and fallback ${defaultLocale})`,
    );
  }
  return v;
};

return {
  props: {
    inviteLink: data.inviteLink,
    heading: interpolate(pick("heading"), vars),
    body: interpolate(pick("body"), vars),
    ctaLabel: pick("cta"),
    footer: pick("footer"),
  },
  subject: pick("subject"),
};
```

### WR-02: `enterWith` leaks AsyncLocalStorage across the request lifetime

**File:** `packages/modules/auth/src/locale-context.ts:62-68`
**Issue:** `localeStorage.enterWith({ locale })` mutates the current async
context for the rest of the chain. In Bun/Node this generally works for
per-request flows because each incoming request runs on its own async stack,
but `enterWith` is documented as a footgun: any code that runs in the same
async chain *after* the request completes (e.g. a `setImmediate`/microtask
scheduled inside an Elysia plugin and not properly awaited, or background
work attached to the same chain) will inherit the last-seen locale instead of
the per-request one. Node's docs explicitly recommend `run()` for HTTP
middleware. The current setup also makes it impossible for the server to
ever "exit" a locale scope — every request permanently overwrites the prior
context.
**Fix:** Prefer `localeStorage.run(...)` wrapping the downstream handler.
Elysia exposes this via `derive` + a wrapping pattern, or use `onRequest` +
a context reset in `onAfterResponse`. Minimum mitigation: add a regression
test that fires two interleaved requests with different `NEXT_LOCALE`
cookies and asserts each `getLocale()` returns the correct value.

### WR-03: Non-null assertion on optional OAuth secrets crashes silently in dev

**File:** `packages/modules/auth/src/auth.ts:31-43`
**Issue:** `env.GOOGLE_CLIENT_SECRET!` and `env.GITHUB_CLIENT_SECRET!` use
non-null assertions, but the only gate is whether `*_CLIENT_ID` is set. If a
developer copies `GOOGLE_CLIENT_ID` into `.env` and forgets the secret, the
assertion lies — better-auth receives `clientSecret: undefined` and OAuth
fails at first attempt with an opaque downstream error. Not a security
vulnerability (no real bypass) but a correctness/onboarding bug. Phase 12
did not introduce this code, but it is in scope for files reviewed.
**Fix:** Validate both env vars together before adding the provider:

```typescript
if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  };
} else if (env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET) {
  logger.warn("Google OAuth partially configured — both CLIENT_ID and CLIENT_SECRET required");
}
```

### WR-04: `derive` callback uses `ctx: any`, defeating Eden Treaty type inference

**File:** `apps/api/src/index.ts:100-114`
**Issue:** The `.derive({ as: "scoped" }, (ctx: any) => {...})` callback casts
context to `any`, which silently swallows downstream type errors and
contradicts the comment on lines 41-42 ("No `as any` casts -- each plugin
is used directly in the chain"). Same applies to the DELETE `/api/tenant`
handler on line 123. Phase 12 did not introduce these but they are in
scope for the file edit.
**Fix:** Replace `any` with the actual derived type. Since `tenantMiddleware`
is what populates `tenantId`/`userId`/`requestId`, type the callback against
the inferred Elysia context, e.g.:

```typescript
.derive({ as: "scoped" }, (ctx) => {
  const tenantId = ctx.tenantId as string;
  const userId = ctx.userId as string;
  return {
    handlerCtx: { ... } satisfies HandlerContext,
  };
})
```

If the middleware does not propagate types, fix the middleware's return
shape so callers do not need `any`.

## Info

### IN-01: Eager `getMessages(defaultLocale)` call when locale-specific subtree exists

**File:** `packages/modules/billing/src/jobs/send-email.ts:79-83`
**Issue:** Even when `email` (the locale-specific subtree) is fully present,
the ternary still calls `await getMessages(defaultLocale)` if `locale !==
defaultLocale`, doing one extra disk/IO round-trip per non-EN team-invite
that is then thrown away on line 83.
**Fix:** Guard the fallback load behind an `email == null` check:

```typescript
let resolved = email;
if (!resolved) {
  const fallbackMessages = await getMessages(defaultLocale);
  resolved = fallbackMessages.invite?.email as typeof email;
}
if (!resolved) {
  throw new Error(`Missing invite.email messages for locale=${locale}`);
}
```

This is moot once WR-01 is fixed (per-key fallback obviates the subtree
fallback entirely).

### IN-02: `JSX.Element` global type is deprecated under React 19

**File:** `packages/modules/billing/src/jobs/send-email.ts:15`
**Issue:** `Record<string, (data: any) => JSX.Element>` relies on the
global `JSX.Element` namespace, which `@types/react` 19+ removed in favor
of `React.JSX.Element`. This may compile today depending on
`tsconfig.json`'s `jsx` setting and any leftover ambient declarations, but
it is a known migration footgun.
**Fix:** Use `React.JSX.Element` (and add `import type * as React from
"react"`) or, better, `ReactElement` from `react`.

### IN-03: Dead `templates["team-invite"]` entry

**File:** `packages/modules/billing/src/jobs/send-email.ts:23, 137-151`
**Issue:** The `team-invite` branch on line 137 always handles the team
invite case, so the `templates["team-invite"]` map entry is unreachable.
The comment on line 20-22 acknowledges this but the entry remains. Dead
code attracts incorrect future edits.
**Fix:** Remove the `templates["team-invite"]` entry and its `subjects`
counterpart, or convert the comment into a `// dead-code: kept for
dispatcher symmetry` mark and delete the assignment. Same for the
`subjects["team-invite"]` fallback string on line 34.

### IN-04: Inconsistent `@baseworks/ui` import paths

**File:** `apps/web/app/(auth)/layout.tsx:2` vs `apps/admin/src/layouts/admin-layout.tsx:18`
**Issue:** The web auth layout imports via the subpath
`@baseworks/ui/components/skip-link`, while admin imports `SkipToContent`
from the package root barrel `@baseworks/ui`. Both work because of the
`./*` export in `packages/ui/package.json`, but the inconsistency makes
greps and refactors harder.
**Fix:** Pick one style (recommend the barrel `@baseworks/ui` to match
admin and the rest of the project) and apply consistently.

### IN-05: Unused `err` bindings in health-check catches

**File:** `apps/api/src/index.ts:69, 81`
**Issue:** `catch (err)` is bound but never used; the error message hard-codes
`"Failed to connect"`. This loses real diagnostic info (e.g. timeout vs
auth failure) from production logs.
**Fix:** Either drop the binding (`catch {`) or log the underlying error:

```typescript
} catch (err) {
  logger.warn({ err }, "health check: database unreachable");
  checks.database = { status: "down", error: (err as Error).message };
}
```

### IN-06: English `invite.email.body` has incorrect article ("as a Owner")

**File:** `packages/i18n/src/locales/en/invite.json:82`
**Issue:** The template `"{inviterName} has invited you to join {orgName} as
a {roleLabel}."` produces ungrammatical output for `roleLabel` values
starting with a vowel — e.g. "as a Admin", "as a Owner". This is a
visible quality issue in customer-facing transactional email.
**Fix:** Drop the article entirely (`"...to join {orgName} as
{roleLabel}."`) or restructure the sentence. Avoid trying to encode
a/an logic in the template — that path leads to per-language hacks. The
restructure also matches the pt-BR translation, which already omits the
article.

### IN-07: pt-BR `invite.email.subject` likely violates the project's "no diacritics in JSON" pattern

**File:** `packages/i18n/src/locales/pt-BR/invite.json:81-85`
**Issue:** Most pt-BR strings in this file (and the rest of the locale)
strip diacritics (`Configuracoes`, `voce`, `nao`), but the `email.*`
subtree uses full diacritics (`Você`, `não`). Either the rest of the
locale is wrong (which is a content fix, not a code fix), or this entry
will get "normalized" later and break the production email subject. This
inconsistency was probably introduced without noticing the existing
pattern.
**Fix:** Decide on a single policy in CONTEXT.md and apply it uniformly.
If the codebase is intentionally diacritic-free for some operational
reason (terminal logging, ASCII-safe DB columns), restore them in
`email.*` to match. If not, it is worth a follow-up task to add diacritics
across the whole pt-BR locale for user-visible UI text.

---

_Reviewed: 2026-04-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
