---
phase: 12-i18n-string-cleanup
plan: 03
type: execute
wave: 2
depends_on: [12-01, 12-02]
files_modified:
  - packages/i18n/src/locales/en/invite.json
  - packages/i18n/src/locales/pt-BR/invite.json
  - packages/i18n/src/index.ts
  - packages/modules/auth/src/locale-context.ts
  - packages/modules/auth/src/index.ts
  - packages/modules/auth/src/auth.ts
  - packages/modules/billing/package.json
  - packages/modules/billing/src/templates/team-invite.tsx
  - packages/modules/billing/src/jobs/send-email.ts
  - apps/api/src/index.ts
autonomous: true
requirements:
  - INVT-02
tags: [i18n, invite, email, bullmq, als, elysia, backend]

must_haves:
  truths:
    - "Pt-BR invitee receives the team-invite email with Portuguese subject, heading, body, CTA, and footer"
    - "English invitee continues to receive byte-identical (layout/color/font) English email as before Phase 12"
    - "TeamInviteEmail component has zero knowledge of packages/i18n and no i18n imports (pure presentation)"
    - "sendInvitationEmail callback resolves recipient locale from AsyncLocalStorage and puts it on the BullMQ job payload"
    - "Email worker (send-email.ts) pre-resolves all invite strings via getMessages(locale) before calling render()"
    - "Locale is captured from NEXT_LOCALE cookie at the outermost Elysia layer and propagated via AsyncLocalStorage.enterWith so better-auth's mounted handler is inside the locale scope"
    - "ALS fallback when no locale is captured is defaultLocale from @baseworks/i18n (currently 'en')"
    - "@internal email suppression branch in sendInvitationEmail is preserved unchanged (Phase 9 D-11 contract)"
    - "Other email templates (welcome, password-reset, magic-link, billing-notification) keep their current hardcoded English subject and content (out of scope per D-10)"
  artifacts:
    - path: "packages/i18n/src/locales/en/invite.json"
      provides: "English invite.email.* subtree (heading, body, cta, footer, subject) matching current hardcoded copy"
      contains: "\"email\""
    - path: "packages/i18n/src/locales/pt-BR/invite.json"
      provides: "Portuguese invite.email.* subtree matching tone of existing entries"
      contains: "\"email\""
    - path: "packages/i18n/src/index.ts"
      provides: "interpolate(template, vars) utility exported for framework-agnostic {variable} token substitution"
      contains: "export function interpolate"
    - path: "packages/modules/auth/src/locale-context.ts"
      provides: "AsyncLocalStorage-based request locale capture + Elysia middleware reading NEXT_LOCALE cookie"
      contains: "AsyncLocalStorage"
    - path: "packages/modules/auth/src/auth.ts"
      provides: "sendInvitationEmail callback reading locale from ALS and passing it on the BullMQ job payload"
      contains: "locale"
    - path: "packages/modules/billing/src/templates/team-invite.tsx"
      provides: "Pure presentation React Email component with prop shape { inviteLink, heading, body, ctaLabel, footer }"
      contains: "ctaLabel"
    - path: "packages/modules/billing/src/jobs/send-email.ts"
      provides: "Email worker that pre-resolves invite translations via getMessages(locale) and localizes subject for team-invite branch only"
      contains: "getMessages"
    - path: "apps/api/src/index.ts"
      provides: "Elysia chain with locale middleware mounted as the outermost layer before authRoutes"
      contains: "localeMiddleware"
    - path: "packages/modules/billing/package.json"
      provides: "billing module depends on @baseworks/i18n workspace package"
      contains: "@baseworks/i18n"
  key_links:
    - from: "apps/api/src/index.ts"
      to: "packages/modules/auth/src/locale-context.ts"
      via: ".use(localeMiddleware) before .use(authRoutes)"
      pattern: "localeMiddleware"
    - from: "packages/modules/auth/src/auth.ts"
      to: "packages/modules/auth/src/locale-context.ts"
      via: "getLocale() call inside sendInvitationEmail callback"
      pattern: "getLocale"
    - from: "packages/modules/auth/src/auth.ts"
      to: "packages/modules/billing/src/jobs/send-email.ts"
      via: "BullMQ email queue job payload with locale field"
      pattern: "locale"
    - from: "packages/modules/billing/src/jobs/send-email.ts"
      to: "packages/i18n/src/index.ts"
      via: "getMessages(locale) + interpolate(template, vars) import"
      pattern: "getMessages|interpolate"
    - from: "packages/modules/billing/src/jobs/send-email.ts"
      to: "packages/modules/billing/src/templates/team-invite.tsx"
      via: "TeamInviteEmail({ inviteLink, heading, body, ctaLabel, footer }) render call with pre-resolved strings"
      pattern: "TeamInviteEmail"
---

<objective>
Close GAP-1 from the v1.1 milestone audit by localizing the team-invite transactional email end-to-end. Pt-BR invitees must receive a fully Portuguese email (subject + body + CTA + footer); English invitees must continue to receive a byte-identical English email. Closes requirement INVT-02 fully (the existing draft satisfies "invited user receives email" but fails the implicit locale expectation flagged by the integration auditor).

Purpose: today `packages/modules/billing/src/templates/team-invite.tsx` hardcodes four English strings and `sendInvitationEmail` in `packages/modules/auth/src/auth.ts:89` passes no locale to the render pipeline. The fix has three moving parts — (1) an AsyncLocalStorage-based request locale capture module so `sendInvitationEmail` can read the inviter's active locale without touching better-auth's plugin config (D-02, D-03), (2) a pre-resolution step in the email worker that calls `getMessages(locale)` and passes flat translated strings to the template (D-05, D-06), and (3) new `invite.email.*` JSON keys in both locales (D-08). Subject line localization is scoped to the team-invite branch only (D-09, D-10) so other templates stay untouched.

Output:
- New `invite.email.{heading, body, cta, footer, subject}` subtrees in `en/invite.json` and `pt-BR/invite.json`
- New `interpolate(template, vars)` export in `@baseworks/i18n` using `{variable}` delimiters
- New `packages/modules/auth/src/locale-context.ts` exporting an ALS store, `getLocale()`, and an Elysia `localeMiddleware` plugin
- `apps/api/src/index.ts` wired so `localeMiddleware` is the outermost layer (before `authRoutes`)
- `sendInvitationEmail` callback resolves locale from ALS and adds it to the BullMQ job payload at lines 101-109
- `TeamInviteEmail` refactored to pure presentation: `{ inviteLink, heading, body, ctaLabel, footer }` props, zero i18n imports, byte-identical visual styling
- `send-email.ts` pre-resolves invite strings via `getMessages(locale)` + `interpolate` and localizes the subject for `template === "team-invite"` only
- `@baseworks/i18n` added to `packages/modules/billing/package.json`
</objective>

<execution_context>
@C:/Projetos/baseworks/.claude/get-shit-done/workflows/execute-plan.md
@C:/Projetos/baseworks/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/12-i18n-string-cleanup/12-CONTEXT.md
@.planning/v1.1-MILESTONE-AUDIT.md

<interfaces>
<!-- Contracts the executor needs. Pre-resolved — no codebase exploration required. -->

Current TeamInviteEmail signature (packages/modules/billing/src/templates/team-invite.tsx):
```typescript
interface TeamInviteEmailProps {
  inviteLink: string;
  organizationName: string;
  inviterName: string;
  role: string;
}
```

NEW TeamInviteEmail signature (per D-06 — pure presentation, no interpolation, no i18n imports):
```typescript
interface TeamInviteEmailProps {
  inviteLink: string;
  heading: string;   // pre-interpolated, e.g. "You're invited to Acme" / "Você foi convidado para Acme"
  body: string;      // pre-interpolated, e.g. "Alice has invited you to join Acme as a Member."
  ctaLabel: string;  // e.g. "Accept Invitation" / "Aceitar Convite"
  footer: string;    // e.g. "If you were not expecting this invitation, you can ignore this email."
}
```

Current sendInvitationEmail payload (packages/modules/auth/src/auth.ts:101-109):
```typescript
await queue.add("team-invite", {
  to: data.email,
  template: "team-invite",
  data: {
    inviteLink,
    organizationName: data.organization.name,
    inviterName: data.inviter.user.name || data.inviter.user.email,
    role: data.role,
  },
});
```

NEW sendInvitationEmail payload (per D-04 — add locale, keep existing data fields because send-email.ts needs them for interpolation):
```typescript
const locale = getLocale(); // resolves from ALS, falls back to defaultLocale ("en")
await queue.add("team-invite", {
  to: data.email,
  template: "team-invite",
  data: {
    inviteLink,
    organizationName: data.organization.name,
    inviterName: data.inviter.user.name || data.inviter.user.email,
    role: data.role,       // kept — send-email.ts uses it to look up translated role label
    locale,                // NEW — drives getMessages() in send-email.ts
  },
});
```

Existing @internal suppression branch (packages/modules/auth/src/auth.ts:93-96) — MUST be preserved unchanged:
```typescript
if (data.email.endsWith("@internal")) {
  console.log(`[AUTH] Link-mode invite (no email): ${data.email}`);
  return;
}
```

Existing getMessages loader signature (packages/i18n/src/index.ts:28):
```typescript
export async function getMessages(locale: Locale): Promise<Record<string, Record<string, string>>>
```

It returns a `{ [namespace]: { [flat-key-path]: value } }` object. For nested keys like `invite.email.heading`, the returned shape is `messages.invite.email.heading` because `getMessages` preserves the JSON structure. Confirm by reading the loader and the invite.json files listed in `<read_first>`.

NEW interpolate utility to be added to packages/i18n/src/index.ts:
```typescript
/**
 * Replace {variable} tokens in a template string. Matches the {/} delimiters
 * used by next-intl and the react-i18next config in apps/admin/src/lib/i18n.ts:45-46.
 * Unknown tokens are left in place (no throw).
 */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return key in vars ? String(vars[key]) : match;
  });
}
```

NEW locale-context.ts (packages/modules/auth/src/locale-context.ts) — shape to be created:
```typescript
import { AsyncLocalStorage } from "node:async_hooks";
import { Elysia } from "elysia";
import { defaultLocale, type Locale, locales } from "@baseworks/i18n";

interface LocaleStore {
  locale: Locale;
}

const localeStorage = new AsyncLocalStorage<LocaleStore>();

/**
 * Read the current request's locale from AsyncLocalStorage.
 * Returns defaultLocale ("en") if no store is set (worker context, background job,
 * or non-HTTP caller).
 */
export function getLocale(): Locale {
  const store = localeStorage.getStore();
  return store?.locale ?? defaultLocale;
}

/**
 * Parse the NEXT_LOCALE cookie from a raw Cookie header. Returns null if absent
 * or the value is not a supported locale.
 */
function parseNextLocaleCookie(cookieHeader: string | null | undefined): Locale | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  if (!match) return null;
  const value = decodeURIComponent(match[1]);
  return (locales as readonly string[]).includes(value) ? (value as Locale) : null;
}

/**
 * Elysia middleware that captures the request locale into AsyncLocalStorage.
 * Resolution order:
 *   1. NEXT_LOCALE cookie (set by next-intl in apps/web)
 *   2. defaultLocale from @baseworks/i18n (currently "en")
 *
 * Full Accept-Language q-value parsing is intentionally deferred (CONTEXT.md
 * Deferred Ideas). We use enterWith() so downstream handlers — including
 * better-auth's mounted handler and its sendInvitationEmail callback — see
 * the locale via getLocale() without any callback wrapping.
 */
export const localeMiddleware = new Elysia({ name: "locale-context" }).onRequest(
  ({ request }) => {
    const cookieHeader = request.headers.get("cookie");
    const locale = parseNextLocaleCookie(cookieHeader) ?? defaultLocale;
    localeStorage.enterWith({ locale });
  },
);
```

Elysia middleware registration pattern (apps/api/src/core/middleware/request-trace.ts:10-18 shows the canonical style):
```typescript
import { Elysia } from "elysia";
export const fooMiddleware = new Elysia({ name: "foo" }).derive({ as: "global" }, (ctx) => ({ ... }));
```

The `.onRequest` lifecycle hook fires for every incoming request BEFORE any `.derive` handlers run, and it runs inside the same async context as the downstream handlers, which is exactly what `enterWith` needs.

Current apps/api/src/index.ts chain order (lines 43-127) — localeMiddleware must slot in BEFORE .use(authRoutes) and ideally right after errorMiddleware:
```typescript
const app = new Elysia()
  .use(errorMiddleware)
  .use(requestTraceMiddleware)
  .use(cors({ ... }))
  .use(swagger())
  .get("/health", async () => { ... })
  .use(authRoutes ?? new Elysia())     // <-- locale must already be captured by the time this runs
  .use(tenantMiddleware)
  ...
```

NEW chain (insert .use(localeMiddleware) after requestTraceMiddleware, before cors — the locale capture should happen for every request including auth routes):
```typescript
const app = new Elysia()
  .use(errorMiddleware)
  .use(requestTraceMiddleware)
  .use(localeMiddleware)               // <-- NEW
  .use(cors({ ... }))
  .use(swagger())
  .get("/health", async () => { ... })
  .use(authRoutes ?? new Elysia())
  ...
```

Existing subjects map (packages/modules/billing/src/jobs/send-email.ts:17-23) — the team-invite entry becomes dynamic; others stay static per D-10:
```typescript
const subjects: Record<string, string> = {
  "welcome": "Welcome to Baseworks!",
  "password-reset": "Reset Your Password",
  "magic-link": "Your Sign-in Link",
  "billing-notification": "Billing Update",
  "team-invite": "You're Invited to Join a Team",   // <-- this one is replaced by localized resolution
};
```
</interfaces>

@packages/modules/billing/src/templates/team-invite.tsx
@packages/modules/billing/src/jobs/send-email.ts
@packages/modules/auth/src/auth.ts
@packages/modules/auth/src/index.ts
@packages/i18n/src/index.ts
@packages/i18n/src/locales/en/invite.json
@packages/i18n/src/locales/pt-BR/invite.json
@packages/modules/billing/package.json
@apps/api/src/index.ts
@apps/admin/src/lib/i18n.ts
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Add invite.email.* subtree to both locale JSON files</name>
  <files>
    packages/i18n/src/locales/en/invite.json,
    packages/i18n/src/locales/pt-BR/invite.json
  </files>
  <read_first>
    - packages/i18n/src/locales/en/invite.json (full 80-line file — existing top-level keys: settings, members, pending, dialog, roles, actions, toast, accept, cancel)
    - packages/i18n/src/locales/pt-BR/invite.json (full 80-line file — same top-level structure in pt-BR)
    - packages/modules/billing/src/templates/team-invite.tsx (lines 21-35 — English copy that must be preserved byte-identically under the new `email` subtree)
    - .planning/phases/12-i18n-string-cleanup/12-CONTEXT.md (D-08, D-09, §Specifics lines 178-183 — subject line MUST be ≤ 60 chars in both languages)
  </read_first>
  <behavior>
    - `invite.email.heading` in English matches the current `team-invite.tsx` line 21-23 copy: "You're invited to {orgName}"
    - `invite.email.body` in English is the interpolated template matching line 24-26: "{inviterName} has invited you to join {orgName} as a {roleLabel}."
    - `invite.email.cta` in English = "Accept Invitation" (matches line 31)
    - `invite.email.footer` in English = "If you were not expecting this invitation, you can ignore this email." (matches line 34-35)
    - `invite.email.subject` in English = "You're Invited to Join a Team" (matches current subjects map line 22 — ≤ 60 chars ✓)
    - Portuguese counterparts use `você` formal tone, match the tone of existing pt-BR entries in the same file (e.g. "Você foi convidado", "Aceitar Convite"), and every string ≤ 60 chars for the subject only
    - JSON remains valid (`bun run -F @baseworks/i18n typecheck` — or equivalent — parses without error)
    - Top-level key ordering is preserved: append `email` as the final top-level key to keep the diff minimal
    - No existing top-level keys (settings, members, pending, dialog, roles, actions, toast, accept, cancel) are modified
  </behavior>
  <action>
    Single purpose: add a new top-level `email` object to both locale files. No runtime code depends on this yet (Tasks 2-5 wire it up), so this task is safe to land first and introduces zero risk.

    **Step 1 — packages/i18n/src/locales/en/invite.json**

    Append a new `"email"` top-level key AFTER the existing `"cancel"` block (lines 75-79). The final file becomes:

    ```json
    {
      "settings": { ... unchanged ... },
      "members": { ... unchanged ... },
      "pending": { ... unchanged ... },
      "dialog": { ... unchanged ... },
      "roles": { ... unchanged ... },
      "actions": { ... unchanged ... },
      "toast": { ... unchanged ... },
      "accept": { ... unchanged ... },
      "cancel": { ... unchanged ... },
      "email": {
        "heading": "You're invited to {orgName}",
        "body": "{inviterName} has invited you to join {orgName} as a {roleLabel}.",
        "cta": "Accept Invitation",
        "footer": "If you were not expecting this invitation, you can ignore this email.",
        "subject": "You're Invited to Join a Team"
      }
    }
    ```

    Concrete diff instruction: change the final `  }` (closing `cancel` at line 79) followed by the closing `}` at line 80 to:
    ```json
      },
      "email": {
        "heading": "You're invited to {orgName}",
        "body": "{inviterName} has invited you to join {orgName} as a {roleLabel}.",
        "cta": "Accept Invitation",
        "footer": "If you were not expecting this invitation, you can ignore this email.",
        "subject": "You're Invited to Join a Team"
      }
    }
    ```

    Invariants:
    - Use `{orgName}`, `{inviterName}`, `{roleLabel}` (NOT `{organizationName}` or `{role}`) — these are the variable names the interpolation helper in `send-email.ts` will pass. The template in `team-invite.tsx` today uses `{organizationName}` and `{role}` as React props; with pre-resolution the interpolation happens in the worker using the names declared here. Pick the names and use them consistently in every step downstream.
    - English heading matches lines 21-23 exactly except for the `{orgName}` token replacement.
    - English body matches lines 24-26 exactly with three token replacements.
    - Subject must stay ≤ 60 chars: "You're Invited to Join a Team" is 30 chars ✓.

    **Step 2 — packages/i18n/src/locales/pt-BR/invite.json**

    Append the same `email` top-level block with idiomatic pt-BR translations. Match the tone of existing entries (formal "você" form, sentence-case matching English sentences):

    ```json
      },
      "email": {
        "heading": "Você foi convidado para {orgName}",
        "body": "{inviterName} convidou você para entrar em {orgName} como {roleLabel}.",
        "cta": "Aceitar Convite",
        "footer": "Se você não estava esperando este convite, pode ignorar este email.",
        "subject": "Você foi convidado para uma equipe"
      }
    }
    ```

    Pt-BR conventions to match the rest of the file:
    - "Aceitar Convite" is already used at `actions.accept` line 50 — reuse exact capitalization for visual consistency.
    - The rest of the file uses accented characters ("ç", "ã", "ô") so DO include accents in the new block (the existing file is UTF-8 without BOM — check encoding before writing).
    - Note: some existing keys like `settings.title` = "Configuracoes" (line 3) are unaccented, but the pattern is inconsistent. Prefer accented Portuguese for the new `email` subtree since it is user-visible transactional email content where proper orthography matters.
    - Subject length: "Você foi convidado para uma equipe" = 34 chars ✓ (well under 60).

    **Step 3 — JSON validity check**

    Both files must remain valid JSON. Run `bun -e "JSON.parse(require('fs').readFileSync('packages/i18n/src/locales/en/invite.json','utf8'))"` and the same for pt-BR. Both must exit 0.

    **Do NOT** touch:
    - Any existing top-level key or its children.
    - `packages/i18n/src/index.ts` in this task (Task 2 handles the interpolate helper).
    - Any other locale file (billing, dashboard, etc.).
  </action>
  <verify>
    <automated>bun -e "const en=JSON.parse(require('fs').readFileSync('packages/i18n/src/locales/en/invite.json','utf8')); const pt=JSON.parse(require('fs').readFileSync('packages/i18n/src/locales/pt-BR/invite.json','utf8')); if(!en.email||!pt.email) throw new Error('missing email subtree'); for(const k of ['heading','body','cta','footer','subject']){if(!en.email[k])throw new Error('en missing '+k); if(!pt.email[k])throw new Error('pt missing '+k);} if(en.email.subject.length>60||pt.email.subject.length>60)throw new Error('subject too long'); console.log('ok')"</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c '"email"' packages/i18n/src/locales/en/invite.json` returns `>= 1` (new subtree exists)
    - `grep -c '"email"' packages/i18n/src/locales/pt-BR/invite.json` returns `>= 1`
    - `grep -c '"heading"' packages/i18n/src/locales/en/invite.json` returns `>= 1` (from CONTEXT.md specifics §7)
    - `grep -c '"heading"' packages/i18n/src/locales/pt-BR/invite.json` returns `>= 1`
    - `grep -c '"body"' packages/i18n/src/locales/en/invite.json` returns `>= 1`
    - `grep -c '"cta"' packages/i18n/src/locales/en/invite.json` returns `>= 1`
    - `grep -c '"footer"' packages/i18n/src/locales/en/invite.json` returns `>= 1`
    - `grep -c '"subject"' packages/i18n/src/locales/en/invite.json` returns `>= 1` (from CONTEXT.md specifics §7)
    - `grep -c '"subject"' packages/i18n/src/locales/pt-BR/invite.json` returns `>= 1`
    - `grep -c "You're invited to {orgName}" packages/i18n/src/locales/en/invite.json` returns `1`
    - `grep -c "Você foi convidado para {orgName}" packages/i18n/src/locales/pt-BR/invite.json` returns `1`
    - `grep -c "Aceitar Convite" packages/i18n/src/locales/pt-BR/invite.json` returns `>= 2` (existing `actions.accept` + new `email.cta`)
    - Both files are valid JSON (automated verify command exits 0)
    - Both subject strings are ≤ 60 chars (automated verify command)
    - All existing top-level keys (settings, members, pending, dialog, roles, actions, toast, accept, cancel) still parse — `bun -e "const en=JSON.parse(require('fs').readFileSync('packages/i18n/src/locales/en/invite.json','utf8')); for(const k of ['settings','members','pending','dialog','roles','actions','toast','accept','cancel','email']){if(!(k in en))throw new Error('missing '+k);}"` exits 0
  </acceptance_criteria>
  <done>
    - Both `invite.json` files contain a new `email` top-level block with heading, body, cta, footer, subject
    - English values are byte-identical to current `team-invite.tsx` copy except for variable tokens
    - Portuguese values use formal `você` and match the tone of existing pt-BR entries
    - Both files are valid JSON
    - Both subject strings ≤ 60 chars
    - No existing top-level keys are modified
    - All acceptance criteria grep checks pass
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Export interpolate(template, vars) utility from @baseworks/i18n</name>
  <files>packages/i18n/src/index.ts</files>
  <read_first>
    - packages/i18n/src/index.ts (full 35-line file — existing exports: defaultLocale, locales, namespaces, 6 enXxx + 6 ptBRXxx re-exports, getMessages async loader)
    - apps/admin/src/lib/i18n.ts (lines 43-47 — confirms interpolation delimiters are `{` / `}` matching next-intl defaults)
    - .planning/phases/12-i18n-string-cleanup/12-CONTEXT.md (D-07 — "tiny internal helper that replaces {variable} tokens", "Planner's discretion on exact location — likely a small exported function in packages/i18n/src/index.ts")
  </read_first>
  <behavior>
    - `interpolate("hello {name}", { name: "world" })` returns `"hello world"`
    - `interpolate("no vars here", {})` returns `"no vars here"`
    - `interpolate("{a} and {b}", { a: "1", b: "2" })` returns `"1 and 2"`
    - `interpolate("{missing}", {})` returns `"{missing}"` (unknown tokens left in place, no throw)
    - `interpolate("{n} items", { n: 3 })` returns `"3 items"` (numbers coerced to string)
    - `interpolate("{a}{a}{a}", { a: "x" })` returns `"xxx"` (same token multiple times)
    - The helper is a named export from `@baseworks/i18n`
    - Existing exports (defaultLocale, locales, namespaces, getMessages, enXxx, ptBRXxx) are untouched
  </behavior>
  <action>
    Two coordinated changes to `packages/i18n/src/index.ts`: (1) widen `getMessages`'s return type so Task 5 can cast subtrees without TS2352, and (2) append a new `interpolate` named export at the END of the file. Do not reorder existing exports. The only runtime-behavior change is the new `interpolate` function — the `getMessages` widening is a type-level-only edit.

    **Step 0 — widen getMessages return type in packages/i18n/src/index.ts (type-safety prereq for Task 5)**

    The current `getMessages` loader has no explicit return type and the local `messages` variable is annotated as `Record<string, Record<string, string>>` at line 29. TypeScript therefore infers the function return type as `Promise<Record<string, Record<string, string>>>`, which is a runtime lie — every JSON file in `packages/i18n/src/locales/**/*.json` contains nested object subtrees (`invite.email.heading`, `invite.roles.member`, `common.errors.required`, etc.), not flat string dicts.

    This is a latent type-system footgun that bites Task 5 specifically: `resolveTeamInvite` needs to cast `messages.invite?.email` from `unknown` (or any object subtree) to `Record<"heading"|"body"|"cta"|"footer"|"subject", string>`. With the current narrow `Record<string, string>` inner type, that cast is a TS2352 error (`Conversion of type string to type Record<...> may be a mistake because neither type sufficiently overlaps`), because TypeScript sees `messages.invite?.email` as `string | undefined` at the type level. Widening the leaf from `string` to `unknown` is safe — existing callers (next-intl in apps/web, react-i18next in apps/admin) already treat the return value as `any` at the use site — and it accurately reflects that JSON values can be nested objects, strings, arrays, or primitives.

    Make two coordinated edits to `packages/i18n/src/index.ts`:

    Edit 1 — line 28 (function declaration): add an explicit return type annotation.

    Change:
    ```typescript
    export async function getMessages(locale: Locale) {
    ```
    to:
    ```typescript
    export async function getMessages(locale: Locale): Promise<Record<string, Record<string, unknown>>> {
    ```

    Edit 2 — line 29 (local variable annotation): widen the leaf type from `string` to `unknown` so the body is consistent with the new return type.

    Change:
    ```typescript
      const messages: Record<string, Record<string, string>> = {};
    ```
    to:
    ```typescript
      const messages: Record<string, Record<string, unknown>> = {};
    ```

    Invariants:
    - No other lines in `packages/i18n/src/index.ts` are touched by Step 0 (imports, re-exports, locales const, namespaces const, loop body, return statement all stay byte-identical).
    - The new return type annotation and the widened local annotation must agree (`unknown` in both places) — otherwise TypeScript will flag the assignment.
    - No new imports required — `unknown` is a TypeScript built-in keyword.
    - This widening is what unblocks Task 5 `resolveTeamInvite` to cast `messages.invite?.email` to `Record<"heading"|"body"|"cta"|"footer"|"subject", string> | undefined` without TS2352 (casting from `unknown` to any object type is always allowed).

    Why not just use `as unknown as` double-cast in Task 5 instead? That pattern suppresses the type checker at every call site and teaches future code to ignore the declared type of `getMessages`. Fixing the declaration once, here, is the right layer.


    **Step 1 — append interpolate function to packages/i18n/src/index.ts**

    After the closing `}` of the `getMessages` function (line 35), append:

    ```typescript

    /**
     * Replace {variable} tokens in a template string.
     *
     * Uses the same {/} delimiters as next-intl (defaults) and the react-i18next
     * config at apps/admin/src/lib/i18n.ts:45-46. Unknown tokens are preserved
     * in place (no throw) so partial interpolation is safe.
     *
     * @example
     *   interpolate("You're invited to {orgName}", { orgName: "Acme" })
     *   // => "You're invited to Acme"
     */
    export function interpolate(
      template: string,
      vars: Record<string, string | number>,
    ): string {
      return template.replace(/\{(\w+)\}/g, (match, key) => {
        return key in vars ? String(vars[key]) : match;
      });
    }
    ```

    Invariants:
    - Regex `/\{(\w+)\}/g` matches `{wordchars}` — letters, digits, underscore. Matches the tokens used in invite.json (`{orgName}`, `{inviterName}`, `{roleLabel}`, `{email}`, `{name}`, etc.).
    - `g` flag required — must replace all occurrences, not just the first.
    - Unknown tokens fall through via `return match` — preserves the literal `{foo}` substring.
    - Number-to-string coercion via `String(vars[key])` so `interpolate("{n}", { n: 3 })` works.
    - Function is pure — no side effects, no throw, no I/O.

    **Do NOT**:
    - Export from a new file — keep it colocated with other package exports per D-07 discretion note.
    - Add a default export — `@baseworks/i18n` has no default export; adding one now would change the public API shape.
    - Touch the `locales` const, the `namespaces` const, or any re-export. (Step 0 is the ONLY place that touches `getMessages` — Step 1 must not re-edit the function body or signature.)
    - Add unit tests in this plan — this plan is not a TDD plan, and the interpolate behavior will be exercised end-to-end by Task 5 (send-email.ts) which has its own acceptance grep checks. A dedicated test file would exceed scope.

    **Step 2 — verify bun can resolve the new export**

    Run `bun -e "import { interpolate } from './packages/i18n/src/index.ts'; console.log(interpolate('hello {x}', { x: 'world' }))"` from the repo root. Expected output: `hello world`. If the module path resolution fails, fall back to `bun -e "(await import('./packages/i18n/src/index.ts')).interpolate('hello {x}', { x: 'world' })"`.
  </action>
  <verify>
    <automated>bun -e "import('./packages/i18n/src/index.ts').then(m => { if(m.interpolate('hello {x}',{x:'world'})!=='hello world')throw new Error('a'); if(m.interpolate('{missing}',{})!=='{missing}')throw new Error('b'); if(m.interpolate('{n}',{n:3})!=='3')throw new Error('c'); if(m.interpolate('{a}{a}',{a:'z'})!=='zz')throw new Error('d'); console.log('ok'); })" &amp;&amp; test $(grep -c "Record<string, Record<string, unknown>>" packages/i18n/src/index.ts) -ge 1 &amp;&amp; test $(grep -c "Record<string, Record<string, string>>" packages/i18n/src/index.ts) -eq 0</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "Record<string, Record<string, unknown>>" packages/i18n/src/index.ts` returns `>= 1` (Step 0 return-type widening landed — covers both the function signature annotation and the local `messages` variable annotation)
    - `grep -c "Record<string, Record<string, string>>" packages/i18n/src/index.ts` returns `0` (old narrow type fully replaced — no leftover `string` leaf annotation that would re-narrow the return type)
    - `grep -c "Promise<Record<string, Record<string, unknown>>>" packages/i18n/src/index.ts` returns `1` (explicit return type annotation present on `getMessages`)
    - `grep -c "export function interpolate" packages/i18n/src/index.ts` returns `1`
    - `grep -c "{(\\\\w+)}" packages/i18n/src/index.ts` returns `>= 1` (regex literal present — accepts either escaped or unescaped form)
    - `grep -c "export async function getMessages" packages/i18n/src/index.ts` returns `1` (existing export preserved)
    - `grep -c "export const defaultLocale" packages/i18n/src/index.ts` returns `1` (existing export preserved)
    - `grep -c "export const namespaces" packages/i18n/src/index.ts` returns `1` (existing export preserved)
    - The automated verify command exits 0 (interpolate works for 4 cases: happy path, missing token, number, repeat)
    - `bun run -F @baseworks/i18n typecheck 2>&1` exits 0 (TypeScript compiles — note: check if this package has a typecheck script; if not, `bun x tsc --noEmit --project packages/i18n/tsconfig.json` or just rely on the runtime check above)
  </acceptance_criteria>
  <done>
    - `getMessages` return type widened to `Promise<Record<string, Record<string, unknown>>>` (explicit annotation on the function signature AND the local `messages` variable)
    - Old narrow annotation `Record<string, Record<string, string>>` fully removed from the file
    - `interpolate` function exported from `packages/i18n/src/index.ts`
    - Function handles: happy path, missing tokens, number coercion, repeated tokens
    - All existing exports untouched (besides the `getMessages` return type annotation widening, which is a type-level-only change with no runtime behavior impact)
    - Runtime smoke test passes
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Create locale-context.ts ALS module + wire Elysia localeMiddleware</name>
  <files>
    packages/modules/auth/src/locale-context.ts,
    packages/modules/auth/src/index.ts,
    apps/api/src/index.ts
  </files>
  <read_first>
    - packages/modules/auth/src/index.ts (existing 69 lines — module definition with routes, commands, queries, events)
    - packages/modules/auth/src/middleware.ts (reference for Elysia plugin style — `new Elysia({ name: "..." }).macro(...)` at line 15, `.derive({ as: "scoped" }, ...)` at line 43)
    - packages/modules/auth/src/routes.ts (line 40: `.mount(auth.handler)` — this is where better-auth's handler is mounted; localeMiddleware must be upstream of this so ALS is populated before the mounted handler runs)
    - apps/api/src/index.ts (lines 43-128 — full Elysia chain; localeMiddleware slots in after requestTraceMiddleware and before cors)
    - apps/api/src/core/middleware/request-trace.ts (full file — reference for `new Elysia({ name: "..." }).derive(...)` / `.onAfterResponse(...)` / `.onRequest(...)` patterns. Note this file uses `.derive({ as: "global" }, ...)`; we use `.onRequest` instead because we need to call `enterWith` which has no return value and fires on every request regardless of route match.)
    - packages/i18n/src/index.ts (line 1-7 — confirm `defaultLocale`, `locales`, `Locale` type are all exported)
    - .planning/phases/12-i18n-string-cleanup/12-CONTEXT.md (D-01, D-02, D-03, §Claude's Discretion for ALS module naming/shape)
    - CLAUDE.md (Bun runtime constraint — `node:async_hooks` is available in Bun ≥ 1.0)
  </read_first>
  <behavior>
    - New file `packages/modules/auth/src/locale-context.ts` exports: `getLocale()`, `localeMiddleware` (Elysia plugin)
    - `getLocale()` returns `defaultLocale` when called outside any request (e.g. from a BullMQ worker process) — no throw
    - When a request arrives with `Cookie: NEXT_LOCALE=pt-BR`, `getLocale()` called from anywhere downstream in the request chain (including better-auth's mounted handler and its sendInvitationEmail callback) returns `"pt-BR"`
    - When a request arrives with no `NEXT_LOCALE` cookie, `getLocale()` returns `defaultLocale` ("en")
    - When `NEXT_LOCALE` is set to an unsupported value (e.g. `fr`), `getLocale()` returns `defaultLocale` (not the invalid value)
    - `localeMiddleware` is re-exported from `packages/modules/auth/src/index.ts` so `apps/api` can import it via `@baseworks/module-auth`
    - `apps/api/src/index.ts` mounts `localeMiddleware` as the third `.use()` in the outer chain: after `requestTraceMiddleware`, before `cors`
    - The `@internal` email suppression branch in auth.ts stays untouched
    - Existing Elysia chain order is otherwise preserved (errorMiddleware → requestTrace → localeMiddleware → cors → swagger → health → authRoutes → tenantMiddleware → ...)
  </behavior>
  <action>
    Three coordinated file changes. They must land together because step 2 and step 3 import symbols that step 1 creates.

    **Step 1 — create packages/modules/auth/src/locale-context.ts (new file, full contents below)**

    ```typescript
    import { AsyncLocalStorage } from "node:async_hooks";
    import { Elysia } from "elysia";
    import { defaultLocale, locales, type Locale } from "@baseworks/i18n";

    /**
     * Request-scoped locale store.
     *
     * Per Phase 12 D-02: better-auth's plugin config is intentionally left
     * untouched. Instead, an Elysia middleware captures the request locale
     * into AsyncLocalStorage so `sendInvitationEmail` — which runs inside
     * better-auth's mounted handler — can read it via `getLocale()` without
     * any prop-drilling or plugin surgery.
     *
     * Resolution order:
     *   1. NEXT_LOCALE cookie (set by next-intl middleware in apps/web)
     *   2. defaultLocale from @baseworks/i18n (currently "en")
     *
     * Full RFC 9110 Accept-Language q-value parsing is deferred per
     * CONTEXT.md Deferred Ideas.
     */
    interface LocaleStore {
      locale: Locale;
    }

    const localeStorage = new AsyncLocalStorage<LocaleStore>();

    /**
     * Read the current request's locale from AsyncLocalStorage.
     *
     * Returns `defaultLocale` if called outside any request — e.g. from a
     * BullMQ worker process, a migration script, or any other non-HTTP
     * entry point. This matches Phase 12 D-03 fallback behavior.
     */
    export function getLocale(): Locale {
      return localeStorage.getStore()?.locale ?? defaultLocale;
    }

    /**
     * Parse the NEXT_LOCALE cookie from a raw Cookie header value.
     * Returns null if the cookie is absent or holds an unsupported locale.
     */
    function parseNextLocaleCookie(cookieHeader: string | null): Locale | null {
      if (!cookieHeader) return null;
      const match = cookieHeader.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
      if (!match) return null;
      const value = decodeURIComponent(match[1]);
      return (locales as readonly string[]).includes(value)
        ? (value as Locale)
        : null;
    }

    /**
     * Elysia middleware that captures the request locale into AsyncLocalStorage.
     *
     * Uses `.onRequest` + `enterWith` so downstream handlers (including
     * better-auth's mounted handler via `.mount(auth.handler)` in
     * packages/modules/auth/src/routes.ts:41) see the locale transparently.
     *
     * Mount this plugin on the OUTERMOST Elysia layer in apps/api/src/index.ts
     * before `.use(authRoutes)`. See Phase 12 plan 03 Task 3 for wiring.
     */
    export const localeMiddleware = new Elysia({ name: "locale-context" }).onRequest(
      ({ request }) => {
        const cookieHeader = request.headers.get("cookie");
        const locale = parseNextLocaleCookie(cookieHeader) ?? defaultLocale;
        localeStorage.enterWith({ locale });
      },
    );
    ```

    Invariants:
    - Import path `node:async_hooks` is correct for Bun (Bun aliases Node stdlib under the `node:` prefix).
    - `enterWith` is used deliberately instead of `run(store, callback)` — Elysia middleware does not provide a wrap-downstream pattern, and `enterWith` is designed exactly for this "set store for the rest of the async chain" use case.
    - `getLocale()` uses `?? defaultLocale` so `undefined` → `"en"` fallback is centralized.
    - Cookie regex `/(?:^|;\s*)NEXT_LOCALE=([^;]+)/` matches both the leading cookie (start of header) and non-leading cookies (after `; `). Do not simplify to `/NEXT_LOCALE=([^;]+)/` — that would false-match on a cookie like `FOO_NEXT_LOCALE=bar`.
    - Unsupported locale values fall through to `defaultLocale` — this is the security property for Threat T-12-06 below (locale header injection).
    - No exports beyond `getLocale`, `localeMiddleware`. Do not export `localeStorage` directly — encapsulation matters here because callers could bypass the validation by setting the store with an untrusted value.

    **Step 2 — packages/modules/auth/src/index.ts (re-export the new symbols)**

    Current file has `export { auth } from "./auth";` at line 18 and `export { betterAuthPlugin, requireRole } from "./middleware";` at line 19. Add a third export line AFTER line 19:

    ```typescript
    export { auth } from "./auth";
    export { betterAuthPlugin, requireRole } from "./middleware";
    export { localeMiddleware, getLocale } from "./locale-context";
    ```

    Do NOT touch the default export (the `ModuleDefinition` satisfies block at lines 35-68). The default export is consumed by `ModuleRegistry` in `apps/api/src/core/registry.ts`, not by `apps/api/src/index.ts` directly.

    **Step 3 — apps/api/src/index.ts (mount localeMiddleware in the outer chain)**

    Current chain (lines 43-53):
    ```typescript
    const app = new Elysia()
      // Global error handling -- registered first
      .use(errorMiddleware)
      // Request tracing -- generates requestId, logs method/path/status/duration
      .use(requestTraceMiddleware)
      .use(
        cors({
          credentials: true,
          origin: [env.WEB_URL, env.ADMIN_URL].filter(Boolean),
        }),
      )
      .use(swagger())
    ```

    Add a named import at the top of the file — find the existing `import { requireRole } from "@baseworks/module-auth";` line (line 8) and update it to:
    ```typescript
    import { requireRole, localeMiddleware } from "@baseworks/module-auth";
    ```

    Insert a `.use(localeMiddleware)` call BETWEEN `.use(requestTraceMiddleware)` and `.use(cors({...}))`. The new chain becomes:
    ```typescript
    const app = new Elysia()
      // Global error handling -- registered first
      .use(errorMiddleware)
      // Request tracing -- generates requestId, logs method/path/status/duration
      .use(requestTraceMiddleware)
      // Locale capture (Phase 12 D-02) -- reads NEXT_LOCALE cookie into AsyncLocalStorage
      // so sendInvitationEmail and other auth callbacks can resolve the request locale
      // without touching better-auth's plugin config.
      .use(localeMiddleware)
      .use(
        cors({
          credentials: true,
          origin: [env.WEB_URL, env.ADMIN_URL].filter(Boolean),
        }),
      )
      .use(swagger())
    ```

    Do NOT:
    - Move `errorMiddleware` or `requestTraceMiddleware` — the error/trace order matters for existing Phase 3 tests.
    - Place `localeMiddleware` after `.use(authRoutes)` — that would be too late; better-auth's mounted handler runs inside `authRoutes` and its sendInvitationEmail callback needs to read the locale.
    - Touch the tenantMiddleware / billingApiRoutes / adminRoutes / `/health` route / any other existing call.

    **Step 4 — verify type resolution**

    Run `bun run -F @baseworks/api typecheck` — must exit 0. If it fails because `@baseworks/module-auth` doesn't export `localeMiddleware`, Step 2 was skipped or the export name is wrong.
  </action>
  <verify>
    <automated>bun run -F @baseworks/api typecheck 2>&amp;1 | tail -30; grep -c "localeMiddleware" apps/api/src/index.ts; grep -c "localeMiddleware" packages/modules/auth/src/index.ts; grep -c "AsyncLocalStorage" packages/modules/auth/src/locale-context.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -cE "AsyncLocalStorage|asyncLocalStorage" packages/modules/auth/src/locale-context.ts` returns `>= 1` (from CONTEXT.md task_breakdown_guidance)
    - `grep -c "enterWith" packages/modules/auth/src/locale-context.ts` returns `>= 1` (ALS write path uses enterWith, not run(store, fn))
    - `grep -c "export function getLocale" packages/modules/auth/src/locale-context.ts` returns `1`
    - `grep -c "export const localeMiddleware" packages/modules/auth/src/locale-context.ts` returns `1`
    - `grep -c "NEXT_LOCALE" packages/modules/auth/src/locale-context.ts` returns `>= 1` (cookie name referenced)
    - `grep -c "from \"@baseworks/i18n\"" packages/modules/auth/src/locale-context.ts` returns `1` (defaultLocale + locales imported)
    - `grep -c 'new Elysia({ name: "locale-context" })' packages/modules/auth/src/locale-context.ts` returns `1`
    - `grep -c "\.onRequest" packages/modules/auth/src/locale-context.ts` returns `>= 1` (lifecycle hook used, not .derive)
    - `grep -c "localeMiddleware" packages/modules/auth/src/index.ts` returns `>= 1` (re-export added)
    - `grep -c "getLocale" packages/modules/auth/src/index.ts` returns `>= 1` (re-export added)
    - `grep -c "localeMiddleware" apps/api/src/index.ts` returns `>= 2` (named import + .use call)
    - `grep -c "\.use(localeMiddleware)" apps/api/src/index.ts` returns `1` (mount call present)
    - `awk '/\.use\(requestTraceMiddleware\)/{trace=NR} /\.use\(localeMiddleware\)/{loc=NR} /\.use\(authRoutes/{if(!auth)auth=NR} END{if(!(trace && loc && auth && trace<loc && loc<auth))exit 1}' apps/api/src/index.ts` exits 0 (localeMiddleware is mounted AFTER requestTraceMiddleware and BEFORE authRoutes)
    - `bun run -F @baseworks/api typecheck` exits 0 (type resolution of `@baseworks/module-auth` re-export succeeds)
    - `grep -c "errorMiddleware" apps/api/src/index.ts` returns `>= 1` (existing chain entry still present)
    - `grep -c "tenantMiddleware" apps/api/src/index.ts` returns `>= 1` (existing chain entry still present)
    - No other middleware order changes: `grep -n "\.use(" apps/api/src/index.ts | head -10` shows errorMiddleware BEFORE requestTraceMiddleware BEFORE localeMiddleware BEFORE cors
  </acceptance_criteria>
  <done>
    - New file `packages/modules/auth/src/locale-context.ts` exists with ALS store, getLocale(), cookie parser, localeMiddleware
    - `getLocale` and `localeMiddleware` re-exported from `packages/modules/auth/src/index.ts`
    - `apps/api/src/index.ts` imports `localeMiddleware` from `@baseworks/module-auth` and mounts it between `requestTraceMiddleware` and `cors`
    - `@baseworks/api` typecheck green
    - All acceptance grep checks pass
    - Existing chain order unchanged except for the new insertion point
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 4: Refactor TeamInviteEmail to pure presentation + update sendInvitationEmail callback</name>
  <files>
    packages/modules/billing/src/templates/team-invite.tsx,
    packages/modules/auth/src/auth.ts
  </files>
  <read_first>
    - packages/modules/billing/src/templates/team-invite.tsx (current 41 lines — hardcoded English at lines 21-35, interpolation at lines 22/25 uses {organizationName}/{role}/{inviterName})
    - packages/modules/billing/src/templates/password-reset.tsx (reference React Email pattern — DO NOT MODIFY; confirms the `Html > Head > Body > Container > Text/Button/Hr` structure and that templates are pure functional components with no hooks)
    - packages/modules/auth/src/auth.ts (full 169 lines — focus on lines 89-114 sendInvitationEmail callback, lines 93-96 @internal suppression, lines 101-109 queue.add payload, line 110-113 console.log fallback)
    - packages/modules/auth/src/locale-context.ts (newly created in Task 3 — must already exist in the working tree)
    - .planning/phases/12-i18n-string-cleanup/12-CONTEXT.md (D-04, D-06 for prop shape, D-15 for grep assertions)
    - packages/i18n/src/locales/en/invite.json (confirm Task 1 added email subtree)
  </read_first>
  <behavior>
    - `TeamInviteEmailProps` interface no longer contains `organizationName`, `inviterName`, or `role`
    - `TeamInviteEmailProps` interface contains: `inviteLink`, `heading`, `body`, `ctaLabel`, `footer`
    - Template file has zero imports from `@baseworks/i18n` (template is pure presentation per D-06)
    - Template renders `{heading}` in the H1-styled Text, `{body}` in the body Text, `{ctaLabel}` inside the Button, `{footer}` inside the footer Text
    - Visual styling (fontFamily, backgroundColor, maxWidth, padding, Button color, Hr, Text color) is byte-identical to current file — only the text content substitutions change
    - Hardcoded English strings "You're invited to", "Accept Invitation", "If you were not expecting" are completely gone from team-invite.tsx
    - `sendInvitationEmail` callback in auth.ts imports `getLocale` from `./locale-context` and calls it before building the job payload
    - Resolved locale is added to the job payload `data` object as `locale: <Locale>`
    - `@internal` suppression branch at lines 93-96 is preserved unchanged (tested by grep on the exact string)
    - `console.log` fallback branch at line 112 still fires when no queue — keep the existing debug output as-is
    - The resolved locale must ALSO be included in the console.log fallback payload so local dev still receives correct behavior information
  </behavior>
  <action>
    Two coordinated file changes. Land them in the same commit because auth.ts imports the new getLocale helper from locale-context.ts (created in Task 3) and the template prop shape change means auth.ts no longer fully drives the template — send-email.ts (Task 5) takes over interpolation.

    **Step 1 — packages/modules/billing/src/templates/team-invite.tsx (full file replacement)**

    Replace the entire file contents with:
    ```tsx
    import { Html, Head, Body, Container, Text, Button, Hr } from "@react-email/components";

    /**
     * Pure presentation component for the team-invite email.
     *
     * Per Phase 12 D-06: all strings arrive as pre-resolved, pre-interpolated
     * props from the email worker (packages/modules/billing/src/jobs/send-email.ts).
     * This component has no knowledge of @baseworks/i18n and no hooks.
     *
     * Visual layout (fontFamily, colors, spacing, Button styling) is byte-identical
     * to the pre-Phase-12 version — only the text content is now upstream-provided.
     */
    interface TeamInviteEmailProps {
      inviteLink: string;
      heading: string;
      body: string;
      ctaLabel: string;
      footer: string;
    }

    export function TeamInviteEmail({
      inviteLink,
      heading,
      body,
      ctaLabel,
      footer,
    }: TeamInviteEmailProps) {
      return (
        <Html>
          <Head />
          <Body style={{ fontFamily: "Arial, sans-serif", backgroundColor: "#f4f4f5" }}>
            <Container style={{ maxWidth: "480px", margin: "0 auto", padding: "20px", backgroundColor: "#ffffff" }}>
              <Text style={{ fontSize: "24px", fontWeight: "bold" }}>
                {heading}
              </Text>
              <Text>
                {body}
              </Text>
              <Button
                href={inviteLink}
                style={{ backgroundColor: "#18181b", color: "#ffffff", padding: "12px 20px", borderRadius: "6px", textDecoration: "none" }}
              >
                {ctaLabel}
              </Button>
              <Hr />
              <Text style={{ color: "#71717a", fontSize: "14px" }}>
                {footer}
              </Text>
            </Container>
          </Body>
        </Html>
      );
    }
    ```

    Invariants:
    - Import line matches current file exactly (same order, same symbols from `@react-email/components`). Do NOT add new imports.
    - Style objects are byte-identical — every key (fontFamily, backgroundColor, maxWidth, margin, padding, fontSize, fontWeight, color, borderRadius, textDecoration) and every value (`"Arial, sans-serif"`, `"#f4f4f5"`, `"480px"`, `"0 auto"`, `"20px"`, `"#ffffff"`, `"24px"`, `"bold"`, `"#18181b"`, `"12px 20px"`, `"6px"`, `"none"`, `"#71717a"`, `"14px"`) matches the original. This is the visual-parity guarantee CONTEXT.md demands.
    - Three Text elements + one Button + one Hr, same JSX structure, same style bindings.
    - NO imports from `@baseworks/i18n`, NO imports from `packages/i18n`, NO hooks, NO async, NO useState.
    - Export shape stays as a named export `export function TeamInviteEmail`. Do not add a default export.

    **Step 2 — packages/modules/auth/src/auth.ts (modify sendInvitationEmail callback at lines 89-114)**

    The rest of the file (imports, db init, socialProviders, betterAuth config, databaseHooks, magicLink plugin) stays untouched.

    Add a new import near the top of the file, colocated with the other workspace imports. Find the existing import block around lines 1-7:
    ```typescript
    import { betterAuth } from "better-auth";
    import { organization, magicLink } from "better-auth/plugins";
    import { drizzleAdapter } from "better-auth/adapters/drizzle";
    import { createDb } from "@baseworks/db";
    import { env } from "@baseworks/config";
    import { createQueue } from "@baseworks/queue";
    import type { Queue } from "bullmq";
    ```

    Add a new import after the `import type { Queue }` line:
    ```typescript
    import { getLocale } from "./locale-context";
    ```

    Now modify the `sendInvitationEmail` callback at lines 89-114. The current body:
    ```typescript
    sendInvitationEmail: async (data) => {
      // Email suppression for shareable link mode:
      // Plan 02 creates link invitations with placeholder email `link-invite-{nanoid}@internal`
      // When we detect the @internal suffix, skip email enqueueing entirely.
      if (data.email.endsWith("@internal")) {
        console.log(`[AUTH] Link-mode invite (no email): ${data.email}`);
        return;
      }

      const queue = getEmailQueue();
      const inviteLink = `${env.WEB_URL}/invite/${data.id}`;
      if (queue) {
        await queue.add("team-invite", {
          to: data.email,
          template: "team-invite",
          data: {
            inviteLink,
            organizationName: data.organization.name,
            inviterName: data.inviter.user.name || data.inviter.user.email,
            role: data.role,
          },
        });
      } else {
        console.log(`[AUTH] Team invite for ${data.email}: ${inviteLink}`);
      }
    },
    ```

    Replace with:
    ```typescript
    sendInvitationEmail: async (data) => {
      // Email suppression for shareable link mode:
      // Plan 02 creates link invitations with placeholder email `link-invite-{nanoid}@internal`
      // When we detect the @internal suffix, skip email enqueueing entirely.
      if (data.email.endsWith("@internal")) {
        console.log(`[AUTH] Link-mode invite (no email): ${data.email}`);
        return;
      }

      // Phase 12 D-02/D-03: resolve recipient locale from the inviter's active
      // request locale via AsyncLocalStorage. Falls back to defaultLocale ("en")
      // if called outside a request context.
      const locale = getLocale();

      const queue = getEmailQueue();
      const inviteLink = `${env.WEB_URL}/invite/${data.id}`;
      if (queue) {
        await queue.add("team-invite", {
          to: data.email,
          template: "team-invite",
          data: {
            inviteLink,
            organizationName: data.organization.name,
            inviterName: data.inviter.user.name || data.inviter.user.email,
            role: data.role,
            locale,
          },
        });
      } else {
        console.log(
          `[AUTH] Team invite for ${data.email} (locale=${locale}): ${inviteLink}`,
        );
      }
    },
    ```

    Invariants:
    - The `if (data.email.endsWith("@internal"))` branch is preserved exactly — do NOT alter its condition, its body, or its early return. This is the Phase 9 D-11 contract and is tested elsewhere.
    - The `organizationName`, `inviterName`, `role` fields are KEPT on the payload even though the template no longer uses them directly — the worker (Task 5) uses them as interpolation variables. Removing them would break the pre-resolution step.
    - The NEW field `locale` is added as the LAST key in the `data` object (minimizes diff noise).
    - The console.log fallback includes `(locale=${locale})` so dev-mode output is informative, matching the existing debug-friendly style of this file.
    - Do NOT touch the `magicLink` plugin below (lines 116-130). The contrast between "team-invite is localized, magic-link is not" is intentional per D-10.
    - Do NOT touch `getEmailQueue`, `emailQueue`, the `socialProviders` block, `databaseHooks`, or `session` config.

    **Verification sweep before declaring done:**
    - `grep "You're invited to\|Accept Invitation\|If you were not expecting" packages/modules/billing/src/templates/team-invite.tsx` returns no hits
    - `grep "getLocale" packages/modules/auth/src/auth.ts` returns a hit
    - `grep "locale" packages/modules/auth/src/auth.ts` returns at least 4 hits (import, comment, const, payload)
    - `grep "@internal" packages/modules/auth/src/auth.ts` returns the 2 existing hits (`endsWith` check + comment) — suppression branch preserved
    - Typecheck of `@baseworks/module-auth` and `@baseworks/module-billing` both green (NB: `@baseworks/module-billing` typecheck will still fail at this point because send-email.ts hasn't been updated for the new template prop shape — that's Task 5. So at the end of Task 4 expect a TYPE ERROR in send-email.ts that Task 5 resolves. Document this in the SUMMARY so the executor does not panic.)
  </action>
  <verify>
    <automated>grep -c "You're invited to" packages/modules/billing/src/templates/team-invite.tsx; grep -c "Accept Invitation" packages/modules/billing/src/templates/team-invite.tsx; grep -c "If you were not expecting" packages/modules/billing/src/templates/team-invite.tsx; grep -c "getLocale" packages/modules/auth/src/auth.ts; grep -c "locale" packages/modules/auth/src/auth.ts; bun run -F @baseworks/module-auth typecheck 2>&1 | tail -10</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "You're invited to" packages/modules/billing/src/templates/team-invite.tsx` returns `0` (from CONTEXT.md D-15)
    - `grep -c "Accept Invitation" packages/modules/billing/src/templates/team-invite.tsx` returns `0` (from CONTEXT.md D-15)
    - `grep -c "If you were not expecting" packages/modules/billing/src/templates/team-invite.tsx` returns `0` (from CONTEXT.md D-15)
    - `grep -c "organizationName" packages/modules/billing/src/templates/team-invite.tsx` returns `0` (prop removed from template — interpolation happens upstream)
    - `grep -c "inviterName" packages/modules/billing/src/templates/team-invite.tsx` returns `0`
    - `grep -c "heading" packages/modules/billing/src/templates/team-invite.tsx` returns `>= 2` (prop declaration + JSX usage)
    - `grep -c "ctaLabel" packages/modules/billing/src/templates/team-invite.tsx` returns `>= 2`
    - `grep -c "footer" packages/modules/billing/src/templates/team-invite.tsx` returns `>= 2`
    - `grep -c "@baseworks/i18n" packages/modules/billing/src/templates/team-invite.tsx` returns `0` (pure presentation — no i18n import per D-06)
    - `grep -c "useTranslat\|useIntl\|getMessages\|interpolate" packages/modules/billing/src/templates/team-invite.tsx` returns `0`
    - `grep -c "\"Arial, sans-serif\"" packages/modules/billing/src/templates/team-invite.tsx` returns `1` (fontFamily preserved)
    - `grep -c "\"#18181b\"" packages/modules/billing/src/templates/team-invite.tsx` returns `1` (Button color preserved)
    - `grep -c "\"#f4f4f5\"" packages/modules/billing/src/templates/team-invite.tsx` returns `1` (body background preserved)
    - `grep -c "\"480px\"" packages/modules/billing/src/templates/team-invite.tsx` returns `1` (container max-width preserved)
    - `grep -c "\"#71717a\"" packages/modules/billing/src/templates/team-invite.tsx` returns `1` (footer color preserved)
    - `grep -c "getLocale" packages/modules/auth/src/auth.ts` returns `>= 2` (import + call site)
    - `grep -c "from \"./locale-context\"" packages/modules/auth/src/auth.ts` returns `1`
    - `grep -c "locale" packages/modules/auth/src/auth.ts` returns `>= 4` (import, comment, const, payload field)
    - `grep -c "endsWith(\"@internal\")" packages/modules/auth/src/auth.ts` returns `1` (@internal suppression branch preserved)
    - `grep -c "Link-mode invite (no email)" packages/modules/auth/src/auth.ts` returns `1` (early-return message preserved)
    - `grep -c "sendMagicLink" packages/modules/auth/src/auth.ts` returns `>= 1` (magicLink plugin untouched)
    - `bun run -F @baseworks/module-auth typecheck` exits 0 (auth module compiles — NB: `@baseworks/module-billing` typecheck may still fail here until Task 5 updates send-email.ts)
  </acceptance_criteria>
  <done>
    - Template is a pure presentation component with {inviteLink, heading, body, ctaLabel, footer} props
    - Zero i18n imports in the template
    - Visual styling byte-identical (all style object keys/values preserved)
    - sendInvitationEmail reads locale from ALS and passes it on the job payload
    - @internal suppression branch preserved verbatim
    - @baseworks/module-auth typecheck green
    - All acceptance grep checks pass
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 5: Add i18n dependency + pre-resolve invite translations in send-email.ts worker</name>
  <files>
    packages/modules/billing/package.json,
    packages/modules/billing/src/jobs/send-email.ts
  </files>
  <read_first>
    - packages/modules/billing/package.json (current 24 lines — dependencies block; confirm `@baseworks/i18n` is NOT already listed)
    - packages/modules/billing/src/jobs/send-email.ts (current 58 lines — templates map lines 9-15, subjects map lines 17-23, sendEmail handler lines 33-58)
    - packages/modules/billing/src/templates/team-invite.tsx (AFTER Task 4 — confirm new prop shape `{ inviteLink, heading, body, ctaLabel, footer }`)
    - packages/i18n/src/locales/en/invite.json (AFTER Task 1 — confirm new `email` subtree with heading/body/cta/footer/subject keys AND confirm the `roles` subtree with owner/admin/member labels already exists at lines 39-43)
    - packages/i18n/src/locales/pt-BR/invite.json (AFTER Task 1 — same confirmation)
    - packages/i18n/src/index.ts (AFTER Task 2 — confirm `interpolate` and `getMessages` are both exported, AND verify the return type of `getMessages` reads `Promise<Record<string, Record<string, unknown>>>`. Task 2 must land this widening before Task 5 — otherwise the `as Record<"heading"|"body"|"cta"|"footer"|"subject", string> | undefined` cast in `resolveTeamInvite` will fail with TS2352 because `messages.invite?.email` would still be typed as `string | undefined` instead of `unknown`)
    - .planning/phases/12-i18n-string-cleanup/12-CONTEXT.md (D-05 for pre-resolution, D-09/D-10 for subject localization scope, §code_context Integration Points for the circular-dependency check)
    - apps/admin/src/lib/i18n.ts (lines 45-46 — interpolation delimiters reference)
  </read_first>
  <behavior>
    - `packages/modules/billing/package.json` gains a new dependency entry `"@baseworks/i18n": "workspace:*"` alphabetically sorted within the existing `@baseworks/*` block
    - `bun install` (or the monorepo's equivalent) succeeds with no circular dependency warning
    - `send-email.ts` imports `getMessages`, `interpolate`, and `defaultLocale` from `@baseworks/i18n`
    - When a `team-invite` job arrives with `data.locale = "pt-BR"`:
      - `getMessages("pt-BR")` is called once
      - `messages.invite.email.heading` is interpolated with `{ orgName: data.organizationName }`
      - `messages.invite.email.body` is interpolated with `{ inviterName, orgName, roleLabel }` where `roleLabel = messages.invite.roles[data.role]`
      - `messages.invite.email.cta` is used as-is (no interpolation)
      - `messages.invite.email.footer` is used as-is
      - `messages.invite.email.subject` is used as the email subject (overrides the static subjects map entry)
      - `TeamInviteEmail({ inviteLink, heading, body, ctaLabel, footer })` is called with the pre-resolved strings
    - When a `team-invite` job arrives with `data.locale = "en"` or undefined, defaults to English copy via the same code path
    - When a job for any other template ("welcome", "password-reset", "magic-link", "billing-notification") arrives, the code path stays exactly as it was: fetches `templates[template]`, calls `render()`, uses `subjects[template]` for the subject. No locale resolution, no getMessages call.
    - `console.log` fallback for missing RESEND_API_KEY still works (early return preserved)
    - Unknown template error still thrown at line 48
  </behavior>
  <action>
    Two file changes, same commit.

    **Step 1 — packages/modules/billing/package.json (add @baseworks/i18n dependency)**

    Current dependencies block (lines 8-22):
    ```json
      "dependencies": {
        "@baseworks/config": "workspace:*",
        "@baseworks/db": "workspace:*",
        "@baseworks/shared": "workspace:*",
        "@pagarme/sdk": "5.8.1",
        "@react-email/components": "1.0.11",
        "@sinclair/typebox": "0.34.49",
        "bullmq": "^5.0.0",
        "drizzle-orm": "^0.45.0",
        "elysia": "^1.4.0",
        "pino": "^9.0.0",
        "react": "19.2.4",
        "resend": "6.10.0",
        "stripe": "^17.0.0"
      }
    ```

    Add `"@baseworks/i18n": "workspace:*"` after `"@baseworks/db"` (alphabetical within `@baseworks/*` scope):
    ```json
      "dependencies": {
        "@baseworks/config": "workspace:*",
        "@baseworks/db": "workspace:*",
        "@baseworks/i18n": "workspace:*",
        "@baseworks/shared": "workspace:*",
        "@pagarme/sdk": "5.8.1",
        "@react-email/components": "1.0.11",
        "@sinclair/typebox": "0.34.49",
        "bullmq": "^5.0.0",
        "drizzle-orm": "^0.45.0",
        "elysia": "^1.4.0",
        "pino": "^9.0.0",
        "react": "19.2.4",
        "resend": "6.10.0",
        "stripe": "^17.0.0"
      }
    ```

    After editing, run `bun install` from the repo root to update `bun.lock`. This is a non-destructive workspace-resolution update — no new external packages download because `@baseworks/i18n` is already a workspace member.

    **Circular dependency check:** `@baseworks/i18n` has ZERO workspace dependencies (see `packages/i18n/package.json` — no `dependencies` block at all). Therefore `billing -> i18n` is a safe one-way edge with no cycle risk. If `bun install` prints any cycle warning, STOP and report the finding in the SUMMARY; otherwise continue.

    **Step 2 — packages/modules/billing/src/jobs/send-email.ts (refactor to pre-resolve invite translations)**

    Replace the full file contents with:
    ```typescript
    import { Resend } from "resend";
    import { render } from "@react-email/components";
    import { env } from "@baseworks/config";
    import {
      getMessages,
      interpolate,
      defaultLocale,
      type Locale,
    } from "@baseworks/i18n";
    import { WelcomeEmail } from "../templates/welcome";
    import { PasswordResetEmail } from "../templates/password-reset";
    import { BillingNotificationEmail } from "../templates/billing-notification";
    import { TeamInviteEmail } from "../templates/team-invite";

    const templates: Record<string, (data: any) => JSX.Element> = {
      "welcome": (data) => WelcomeEmail(data),
      "password-reset": (data) => PasswordResetEmail(data),
      "magic-link": (data) => PasswordResetEmail({ ...data, userName: data.email }),
      "billing-notification": (data) => BillingNotificationEmail(data),
      // Phase 12 D-06: team-invite is rendered via pre-resolved strings built in
      // resolveTeamInvite() below — this map entry is only used for the fallback
      // case where the dispatcher routes to it with already-prepared props.
      "team-invite": (data) => TeamInviteEmail(data),
    };

    const subjects: Record<string, string> = {
      "welcome": "Welcome to Baseworks!",
      "password-reset": "Reset Your Password",
      "magic-link": "Your Sign-in Link",
      "billing-notification": "Billing Update",
      // Phase 12 D-09/D-10: team-invite subject is localized per-request in
      // sendEmail() below. This fallback value is only used if message loading
      // somehow fails (defensive default).
      "team-invite": "You're Invited to Join a Team",
    };

    /**
     * Role label lookup from translated messages.
     * Falls back to the raw role key if an unknown role arrives (defensive —
     * better-auth's organization plugin only emits owner/admin/member today).
     */
    function resolveRoleLabel(
      messages: Record<string, Record<string, any>>,
      role: string,
    ): string {
      const roles = messages.invite?.roles as Record<string, string> | undefined;
      return roles?.[role] ?? role;
    }

    /**
     * Pre-resolve all translated strings for the team-invite template, including
     * subject line. Per Phase 12 D-05/D-06, the worker owns interpolation so the
     * React Email template can stay a pure presentation component.
     */
    async function resolveTeamInvite(data: {
      inviteLink: string;
      organizationName: string;
      inviterName: string;
      role: string;
      locale?: Locale;
    }): Promise<{
      props: {
        inviteLink: string;
        heading: string;
        body: string;
        ctaLabel: string;
        footer: string;
      };
      subject: string;
    }> {
      const locale: Locale = data.locale ?? defaultLocale;
      const messages = await getMessages(locale);
      const email = messages.invite?.email as
        | Record<"heading" | "body" | "cta" | "footer" | "subject", string>
        | undefined;

      // Defensive fallback: if the invite.email subtree is somehow missing for
      // this locale, fall back to English so we still send a working email.
      const fallback = locale === defaultLocale
        ? email
        : ((await getMessages(defaultLocale)).invite?.email as typeof email);
      const resolved = email ?? fallback;
      if (!resolved) {
        throw new Error(
          `Missing invite.email messages for locale=${locale} (and fallback ${defaultLocale})`,
        );
      }

      const roleLabel = resolveRoleLabel(messages, data.role);
      const vars = {
        orgName: data.organizationName,
        inviterName: data.inviterName,
        roleLabel,
      };

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

    /**
     * Email job handler using Resend + React Email.
     *
     * Per D-19/D-21: Processes email:send queue jobs.
     * Per T-03-17: Graceful degradation when RESEND_API_KEY is not set
     * (logs instead of crashing) so dev/test environments work without email config.
     * Per T-03-14: Templates receive minimal data (userName, url) -- no secrets.
     * Per Phase 12 D-05/D-09/D-10: team-invite is the only template that resolves
     * translations at send time; other templates keep their current hardcoded
     * English subject and content until a future transactional email i18n sweep.
     */
    export async function sendEmail(data: unknown): Promise<void> {
      const { to, template, data: templateData } = data as {
        to: string;
        template: string;
        data: Record<string, unknown>;
      };

      if (!env.RESEND_API_KEY) {
        console.log(`[EMAIL] Skipping send (no RESEND_API_KEY): template=${template}, to=${to}`);
        return;
      }

      const resend = new Resend(env.RESEND_API_KEY);

      let html: string;
      let subject: string;

      if (template === "team-invite") {
        // Phase 12: pre-resolve translations and subject for team-invite only.
        const { props, subject: resolvedSubject } = await resolveTeamInvite(
          templateData as Parameters<typeof resolveTeamInvite>[0],
        );
        html = await render(TeamInviteEmail(props));
        subject = resolvedSubject;
      } else {
        const Component = templates[template];
        if (!Component) {
          throw new Error(`Unknown email template: ${template}`);
        }
        html = await render(Component(templateData));
        subject = subjects[template] ?? "Notification";
      }

      await resend.emails.send({
        from: "Baseworks <noreply@baseworks.dev>",
        to,
        subject,
        html,
      });
    }
    ```

    Invariants:
    - `resolveTeamInvite` is a module-local helper (no export) — keeps the worker's public surface unchanged. `sendEmail` is still the only export.
    - The `templates` map keeps the `team-invite` entry because: (a) it documents that the template exists, (b) it preserves the `templates[template]` lookup semantics for future code that introspects the map. The entry is unused by the new `if (template === "team-invite")` branch but removing it would be a surprising API change.
    - The `subjects` map keeps its `team-invite` entry as a defensive default (comment explains why). Per D-10 the other four entries are UNCHANGED.
    - English-only control flow (welcome, password-reset, magic-link, billing-notification) is byte-identical to the current code path — same templates map lookup, same subjects map lookup, same `render(Component(templateData))` call. This is the "scope localized to team-invite branch only" guarantee from D-10.
    - `defaultLocale` fallback happens if `data.locale` is undefined — this protects against old queue messages created before Task 4 landed (they have no locale field). Such messages will render English, which matches the pre-Phase-12 behavior.
    - The defensive nested fallback (`locale !== defaultLocale -> try English messages`) is a belt-and-suspenders guard against missing JSON keys for a newly-added locale. It's cheap (one extra `getMessages` call only in the error path) and matches Phase 8's "fallback to defaultLocale" pattern.
    - `resolveRoleLabel` returns the raw role key as final fallback so an unknown role ("viewer", "guest", etc.) doesn't crash the render.
    - Interpolation variable names MUST match the keys used in invite.json (Task 1): `{orgName}`, `{inviterName}`, `{roleLabel}`. If Task 1 used different names, this code breaks — grep-check the JSON file during verification.
    - Do NOT touch `WelcomeEmail`, `PasswordResetEmail`, `BillingNotificationEmail` — they are pure presentation already and out of scope per D-10.
    - Do NOT add locale handling to the other template branches in this plan — that's tracked as deferred tech debt per CONTEXT.md Deferred Ideas.

    **Step 3 — re-run typecheck for billing module and api app**

    ```bash
    bun install                                # resolves the new @baseworks/i18n workspace edge
    bun run -F @baseworks/module-billing typecheck  # must be green after Task 4 + Task 5 combined
    bun run -F @baseworks/api typecheck             # must be green (no downstream breakage)
    ```

    If the billing typecheck fails with "Cannot find module '@baseworks/i18n'", Step 1 wasn't saved or `bun install` wasn't re-run. If it fails on a TypeScript error in `TeamInviteEmail` prop shape, Task 4 wasn't completed or the prop names drifted between Task 4 and this task.
  </action>
  <verify>
    <automated>bun install 2>&1 | tail -15; bun run -F @baseworks/module-billing typecheck 2>&1 | tail -20; grep -c "getMessages" packages/modules/billing/src/jobs/send-email.ts; grep -c "interpolate" packages/modules/billing/src/jobs/send-email.ts; grep -c "@baseworks/i18n" packages/modules/billing/package.json</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "@baseworks/i18n" packages/modules/billing/package.json` returns `>= 1` (workspace dep added)
    - `grep -c "workspace:\*" packages/modules/billing/package.json` returns `>= 4` (the new entry uses workspace protocol like the others)
    - `grep -c "getMessages" packages/modules/billing/src/jobs/send-email.ts` returns `>= 1` (from CONTEXT.md task_breakdown_guidance and D-15)
    - `grep -c "interpolate" packages/modules/billing/src/jobs/send-email.ts` returns `>= 2` (import + at least one call site, realistically >= 3)
    - `grep -c "invite.email" packages/modules/billing/src/jobs/send-email.ts` returns `>= 4` (heading/body/cta/footer access patterns — from CONTEXT.md task_breakdown_guidance and D-15)
    - `grep -c "locale" packages/modules/billing/src/jobs/send-email.ts` returns `>= 1` (worker reads locale from job payload — from CONTEXT.md task_breakdown_guidance)
    - `grep -c "from \"@baseworks/i18n\"" packages/modules/billing/src/jobs/send-email.ts` returns `1`
    - `grep -c "template === \"team-invite\"" packages/modules/billing/src/jobs/send-email.ts` returns `>= 1` (D-10 localized branch)
    - `grep -c "resolveTeamInvite" packages/modules/billing/src/jobs/send-email.ts` returns `>= 2` (definition + call site)
    - `grep -c "Welcome to Baseworks!" packages/modules/billing/src/jobs/send-email.ts` returns `1` (welcome subject unchanged per D-10)
    - `grep -c "Reset Your Password" packages/modules/billing/src/jobs/send-email.ts` returns `1` (password-reset subject unchanged per D-10)
    - `grep -c "Your Sign-in Link" packages/modules/billing/src/jobs/send-email.ts` returns `1` (magic-link subject unchanged per D-10)
    - `grep -c "Billing Update" packages/modules/billing/src/jobs/send-email.ts` returns `1` (billing-notification subject unchanged per D-10)
    - `grep -c "WelcomeEmail\|PasswordResetEmail\|BillingNotificationEmail" packages/modules/billing/src/jobs/send-email.ts` returns `>= 3` (other template imports preserved)
    - `bun install` exits 0 with no cycle warning
    - `bun run -F @baseworks/module-billing typecheck` exits 0
    - `bun run -F @baseworks/api typecheck` exits 0
    - `bun test -F @baseworks/i18n` exits 0 (no regression in i18n package — if package has no tests, `bun test` exits 0 trivially)
  </acceptance_criteria>
  <done>
    - `@baseworks/i18n` added as workspace dep in billing module package.json
    - `bun install` resolves cleanly, no circular dependency
    - `send-email.ts` pre-resolves invite.email subtree via `getMessages(locale)` and `interpolate`
    - `team-invite` branch uses localized subject from `invite.email.subject`
    - Other 4 templates keep their hardcoded English subjects and control flow
    - `@internal` suppression branch still preserved (Task 4 didn't touch it; Task 5 doesn't touch auth.ts)
    - Both `@baseworks/module-billing` and `@baseworks/api` typecheck green
    - All acceptance grep checks pass
  </done>
</task>

</tasks>

<threat_model>

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| HTTP client -> Elysia outer layer | Attacker-controlled Cookie header reaches the locale middleware. `NEXT_LOCALE` cookie value is untrusted input. |
| Elysia request chain -> AsyncLocalStorage | Locale value is written to process-wide ALS before better-auth's mounted handler runs. Any code inside the request chain can read it via `getLocale()`. |
| better-auth organization plugin -> BullMQ queue | `sendInvitationEmail` callback serializes the invite payload (including the resolved locale) into a Redis-backed job. Queue is trusted infrastructure but payload contents are persisted in Redis. |
| BullMQ worker -> getMessages + Resend SDK | Worker reads `data.locale` from the job payload, calls `getMessages(locale)`, interpolates variables from `data.organizationName` / `data.inviterName` into translated templates, and sends the rendered HTML via Resend. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-12-06 | Tampering / Elevation | `parseNextLocaleCookie` in locale-context.ts | mitigate | Allowlist the parsed value against `locales as readonly string[]`. Unknown values (including shell/path tokens, script injection, `../../../etc/passwd`) fall through to `defaultLocale`. This prevents any attacker-controlled locale string from flowing into `getMessages(locale)` where it becomes part of a dynamic `await import()` path in `packages/i18n/src/index.ts:31`. |
| T-12-07 | Information Disclosure | `getMessages(locale)` dynamic import in packages/i18n/src/index.ts | mitigate | `getMessages` accepts a `Locale` type union; TypeScript narrows the parameter at the call site. Combined with T-12-06 allowlist check, there is no path for `locale` to contain `..` or `/` characters, so the dynamic import cannot escape the `./locales/{en,pt-BR}/` directory. No path-traversal surface. |
| T-12-08 | Tampering | `interpolate(template, vars)` in packages/i18n/src/index.ts | mitigate | Token substitution is purely string-level; regex only matches `\w+` so tokens cannot contain special characters. The OUTPUT is a plain string; it is passed into React Email's JSX (`{heading}` inside `<Text>`) which performs standard React escaping, so any HTML metacharacters in `data.organizationName` or `data.inviterName` are neutralized by React's default text-node escaping in the generated HTML. |
| T-12-09 | Information Disclosure | Inviter name / organization name flowing into email body | accept | `data.inviter.user.name`, `data.inviter.user.email`, `data.organization.name` all come from better-auth's authenticated session — not from untrusted input. The invitee's own email goes in the `to:` header by design. Nothing crosses a trust boundary that isn't already trusted by the invite flow itself. |
| T-12-10 | Spoofing | Locale-based email content routing | accept | Attacker setting `NEXT_LOCALE=pt-BR` on their own request causes their own invitees to receive pt-BR emails. This is the intended behavior (inviter's active locale drives recipient locale per D-01) and is not a spoofing vector — the attacker controls their own locale preference and the invitee's locale is a cosmetic/UX property, not a security boundary. |
| T-12-11 | Denial of Service | `getMessages(locale)` called per email job | accept | `getMessages` performs 6 dynamic imports once per job. Bun caches module imports, so after the first call per worker process the cost is near-zero. No rate-limit concerns for the typical invite volume (< 1 invite/sec per worker). If invite volume grows 1000x, caching the resolved messages per locale is a trivial follow-up. |
| T-12-12 | Repudiation | BullMQ job payload persistence | accept | Job payloads are Redis-backed and contain `to`, `template`, `inviteLink`, `organizationName`, `inviterName`, `role`, `locale`. `inviteLink` is the only semi-sensitive field (gives access to the accept page) and is already present in the pre-Phase-12 payload. No new sensitive fields added by this plan. |
| T-12-13 | Tampering | Email subject resolution | mitigate | Subject is read from `messages.invite.email.subject` which is a build-time JSON constant. No user-controlled input reaches the subject line. The English-only defensive fallback in `subjects[template]` is never user-provided. |
| T-12-14 | Information Disclosure | ALS store leakage across requests | mitigate | `AsyncLocalStorage.enterWith` sets the store for the current async chain only. Bun/Node guarantee isolation between concurrent request chains — one request cannot read another's store. The only cross-request surface is if a request starts without the middleware running (e.g., a raw BullMQ worker entrypoint that doesn't go through Elysia). In that case `getLocale()` returns `defaultLocale` — no leakage of any previous request's locale because the `AsyncLocalStorage` returns `undefined` when no store is set. |

**Authorization surface:** Unchanged. The plan does not touch `betterAuthPlugin`, `requireRole`, `tenantMiddleware`, or any command/query. All protected invitation CRUD still requires owner/admin role via the existing `.use(requireRole("owner", "admin"))` guard at `packages/modules/auth/src/routes.ts:63`.

**Block-on severity:** none — no high-severity STRIDE findings. All mitigations are already baked into the design (allowlist locale, React JSX escaping, private ALS encapsulation).

</threat_model>

<verification>

Run after all 5 tasks complete:

1. **JSON validity** — both locale files parse:
   ```bash
   bun -e "JSON.parse(require('fs').readFileSync('packages/i18n/src/locales/en/invite.json','utf8'))"
   bun -e "JSON.parse(require('fs').readFileSync('packages/i18n/src/locales/pt-BR/invite.json','utf8'))"
   ```

2. **Interpolate smoke test**:
   ```bash
   bun -e "import('./packages/i18n/src/index.ts').then(m => console.log(m.interpolate('hi {x}', {x:'y'})))"
   ```
   Expected output: `hi y`

3. **Typecheck sweep** — all packages must be green:
   ```bash
   bun run -F @baseworks/module-auth typecheck
   bun run -F @baseworks/module-billing typecheck
   bun run -F @baseworks/api typecheck
   ```

4. **Workspace install** — no cycle warnings:
   ```bash
   bun install 2>&1 | grep -iE "cycle|circular" | wc -l
   ```
   Must return `0`.

5. **Full test sweep** — no regressions:
   ```bash
   bun test 2>&1 | tail -40
   ```

6. **Grep sweep — template hardcoded strings gone**:
   ```bash
   grep -c "You're invited to" packages/modules/billing/src/templates/team-invite.tsx        # -> 0
   grep -c "Accept Invitation" packages/modules/billing/src/templates/team-invite.tsx        # -> 0
   grep -c "If you were not expecting" packages/modules/billing/src/templates/team-invite.tsx  # -> 0
   ```

7. **Grep sweep — worker wiring**:
   ```bash
   grep -c "invite.email" packages/modules/billing/src/jobs/send-email.ts    # -> >= 4
   grep -c "getMessages"  packages/modules/billing/src/jobs/send-email.ts    # -> >= 1
   grep -c "interpolate"  packages/modules/billing/src/jobs/send-email.ts    # -> >= 2
   grep -c "locale"       packages/modules/billing/src/jobs/send-email.ts    # -> >= 1
   ```

8. **Grep sweep — auth callback wiring**:
   ```bash
   grep -c "getLocale" packages/modules/auth/src/auth.ts      # -> >= 2
   grep -c "locale"    packages/modules/auth/src/auth.ts      # -> >= 4
   grep -cE "AsyncLocalStorage|asyncLocalStorage" packages/modules/auth/src/   # recursive -> >= 1
   ```

9. **Grep sweep — other email templates unchanged** (D-10 guarantee):
   ```bash
   grep -c "Welcome to Baseworks!"     packages/modules/billing/src/jobs/send-email.ts  # -> 1
   grep -c "Reset Your Password"       packages/modules/billing/src/jobs/send-email.ts  # -> 1
   grep -c "Your Sign-in Link"         packages/modules/billing/src/jobs/send-email.ts  # -> 1
   grep -c "Billing Update"            packages/modules/billing/src/jobs/send-email.ts  # -> 1
   ```

10. **Grep sweep — @internal suppression preserved**:
    ```bash
    grep -c "endsWith(\"@internal\")"           packages/modules/auth/src/auth.ts  # -> 1
    grep -c "Link-mode invite (no email)"       packages/modules/auth/src/auth.ts  # -> 1
    ```

11. **Elysia chain order sanity check**:
    ```bash
    awk '/\.use\(requestTraceMiddleware\)/{t=NR} /\.use\(localeMiddleware\)/{l=NR} /authRoutes/{if(!a)a=NR} END{if(!(t && l && a && t<l && l<a))exit 1; print "ok"}' apps/api/src/index.ts
    ```
    Must print `ok` and exit 0.

12. **Manual pt-BR smoke test (optional, human verification)**:
    - Start the dev stack: `bun run dev`
    - Set `NEXT_LOCALE=pt-BR` cookie in browser
    - Trigger an invite via the UI
    - Observe the email subject + body in Resend dashboard (or dev console if RESEND_API_KEY is unset)
    - Expected: subject = "Você foi convidado para uma equipe", heading = "Você foi convidado para <OrgName>", CTA = "Aceitar Convite"

</verification>

<success_criteria>

- [ ] `invite.email.{heading, body, cta, footer, subject}` subtrees exist in both `en/invite.json` and `pt-BR/invite.json`
- [ ] `interpolate(template, vars)` is exported from `@baseworks/i18n`
- [ ] `packages/modules/auth/src/locale-context.ts` exists with ALS store, `getLocale()`, `localeMiddleware`
- [ ] `apps/api/src/index.ts` mounts `localeMiddleware` between `requestTraceMiddleware` and `cors`, before `authRoutes`
- [ ] `packages/modules/auth/src/auth.ts` `sendInvitationEmail` resolves locale via `getLocale()` and puts it on the BullMQ payload
- [ ] `@internal` email suppression branch preserved byte-identically
- [ ] `packages/modules/billing/src/templates/team-invite.tsx` is a pure presentation component — zero i18n imports, byte-identical styling, new prop shape `{ inviteLink, heading, body, ctaLabel, footer }`
- [ ] No hardcoded `"You're invited to"`, `"Accept Invitation"`, `"If you were not expecting"` anywhere in the template
- [ ] `packages/modules/billing/src/jobs/send-email.ts` pre-resolves translations via `getMessages(locale)` + `interpolate` for `template === "team-invite"` only; other 4 templates keep their static subject and content paths
- [ ] `@baseworks/i18n` added to `packages/modules/billing/package.json` dependencies; `bun install` resolves without cycle warnings
- [ ] All package typechecks green (`module-auth`, `module-billing`, `api`)
- [ ] `bun test` passes with no regressions
- [ ] All STRIDE threats have documented dispositions (mitigate/accept); locale cookie value is allowlisted against supported locales before reaching dynamic import
- [ ] When `/gsd-validate-phase 8` re-runs after Phase 12 plans 01/02/03 land, I18N-01/I18N-02/I18N-03 flip from partial to satisfied and GAP-1 closes in the v1.1 audit re-run

</success_criteria>

<output>

After completion, create `.planning/phases/12-i18n-string-cleanup/12-03-SUMMARY.md` covering:
- Files created (locale-context.ts) and modified (9 files total — list them)
- Before/after diff snippets for:
  - `team-invite.tsx` prop shape and JSX
  - `auth.ts` sendInvitationEmail callback (showing new `getLocale()` call + `locale` field on payload)
  - `send-email.ts` new `resolveTeamInvite` helper + `template === "team-invite"` branch
  - `apps/api/src/index.ts` Elysia chain with new `.use(localeMiddleware)` call
  - `invite.json` new `email` subtree (en + pt-BR)
- Grep verification output for all acceptance criteria from the 5 tasks
- Typecheck results for `@baseworks/module-auth`, `@baseworks/module-billing`, `@baseworks/api`
- `bun install` output confirming no cycle warnings
- Any unexpected findings (e.g., if `@baseworks/i18n` needed to be added elsewhere, or if a Bun runtime quirk surfaced with `AsyncLocalStorage.enterWith`)
- Confirmation that @internal suppression branch and other 4 email templates are unchanged (D-10 guarantee)

</output>
