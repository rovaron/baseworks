# Phase 12: i18n Hardcoded String Cleanup - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Eliminate the three hardcoded-English leaks flagged by the v1.1 milestone audit so pt-BR users see a fully localized UI and I18N-01/I18N-02/I18N-03 are satisfied when Phase 8 is re-verified. Specifically:

1. **GAP-1** — `packages/modules/billing/src/templates/team-invite.tsx` hardcodes heading, body, CTA button, and footer strings. `sendInvitationEmail` callback in `packages/modules/auth/src/auth.ts:89` passes no locale to the render pipeline. Pt-BR recipients receive English invite emails.
2. **GAP-2** — `packages/ui/src/components/skip-link.tsx:13` hardcodes `"Skip to content"`. Used by three layouts (`apps/web/app/(auth)/layout.tsx`, `apps/web/app/(dashboard)/layout.tsx:19`, `apps/admin/src/layouts/admin-layout.tsx:73`). Pt-BR users tabbing into any app see an English skip link.
3. **Phase 8 tech debt** — `apps/admin/src/lib/i18n.ts` does not register the `invite` namespace even though `packages/i18n/src/index.ts:5` already exports `invite` in its `namespaces` list and `en/invite.json` + `pt-BR/invite.json` already exist. Any admin UI referencing `invite.*` keys would fail silently.

**Out of scope:**
- I18N-05 (user-facing locale switcher + persisted user.locale column) — explicitly deferred to v1.2 per `apps/web/lib/i18n.ts:10` and v1.1-MILESTONE-AUDIT.md line 210
- Moving `team-invite.tsx` out of the `billing` module into an `email` or `auth` module (audit flags the misplacement but Phase 12 is a cleanup, not a refactor)
- Localizing other email templates (welcome, password-reset, magic-link, billing-notification) — their hardcoded English is tech debt tracked separately
- Bootstrapping a vitest harness in `apps/web` — same constraint as Phase 11
- Regenerating Phase 8 VERIFICATION.md — handled by `/gsd-validate-phase 8` after this phase lands

</domain>

<decisions>
## Implementation Decisions

### Locale resolution strategy

- **D-01:** Recipient locale = inviter's active request locale captured at invite creation time. The inviter is statistically likely to invite people who speak the same language, and this requires **zero schema changes** — no `user.locale` column, no extension to better-auth's invitation table. Matches v1.1's "I18N-05 deferred" reality.
- **D-02:** Locale is plumbed from HTTP request into `sendInvitationEmail` via `AsyncLocalStorage`. A small Elysia middleware reads the `NEXT_LOCALE` cookie (set by next-intl) falling back to `Accept-Language` header, stashes it on an ALS store, and `sendInvitationEmail` reads from the store. This is an isolated piece of infrastructure (one new file in `packages/modules/auth/src/` or similar) that other worker-bound callbacks can reuse in the future. No changes to better-auth's plugin config and no changes to the `authClient` invocation in `invite-dialog.tsx`.
- **D-03:** Fallback when ALS has no locale (cookie missing, non-HTTP trigger, worker restart edge case) = `defaultLocale` from `@baseworks/i18n` (currently `"en"`). Predictable, matches how `apps/web/lib/i18n.ts:10` already falls back.
- **D-04:** The resolved locale is passed through the BullMQ job payload so the email worker (which may run on a different process than the API) receives it explicitly. Shape: `{ to, template, data: { inviteLink, organizationName, inviterName, role, locale } }`.

### Template translation plumbing

- **D-05:** `packages/modules/billing/src/jobs/send-email.ts` pre-resolves all translated strings for the invite email before calling `render()`. It calls `getMessages(locale)` from `@baseworks/i18n`, extracts the `invite.email.*` subtree and the translated role label from `invite.roles.{role}`, interpolates variables (`{orgName}`, `{inviterName}`, `{roleLabel}`), and passes **flat, pre-resolved strings** to `TeamInviteEmail` as props.
- **D-06:** `TeamInviteEmail` becomes a **pure presentation component** with no i18n imports and no knowledge of `packages/i18n`. New prop shape: `{ inviteLink: string; heading: string; body: string; ctaLabel: string; footer: string; }`. The `organizationName`, `inviterName`, and `role` props are removed from the template because those values have already been interpolated into `heading`/`body` upstream.
- **D-07:** String interpolation in `send-email.ts` uses a tiny internal helper that replaces `{variable}` tokens in message strings (matches the interpolation syntax `packages/i18n` already uses in `apps/admin/src/lib/i18n.ts:45-46` and next-intl's default). Claude's discretion on exact location — likely a small exported function in `packages/i18n/src/index.ts` (e.g., `interpolate(template, vars)`) since it's framework-agnostic and other callers may need it.
- **D-08:** Email keys live under `invite.email.*` in both `packages/i18n/src/locales/en/invite.json` and `packages/i18n/src/locales/pt-BR/invite.json`. The `invite` namespace is already registered in both apps after D-12 below, and keys are colocated with the rest of the invite feature domain.

### Email subject line localization

- **D-09:** The `team-invite` subject line in `packages/modules/billing/src/jobs/send-email.ts:18-23` is also localized. A new key `invite.email.subject` is added to en and pt-BR `invite.json`. `send-email.ts` resolves the subject from the locale-specific messages before calling `resend.emails.send()`. This fully closes GAP-1 without expanding scope to the other four templates (welcome, password-reset, magic-link, billing-notification), which remain hardcoded English as known tech debt.
- **D-10:** The subjects map refactor is **localized to the team-invite branch only**. Other templates keep their current hardcoded subject strings. The `subjects` map may be restructured or have a targeted `if (template === "team-invite")` branch at the planner's discretion.

### SkipToContent API contract

- **D-11:** `SkipToContent` takes a **required** `label: string` prop (plus the existing optional `targetId`). No default value. TypeScript enforces that all call sites pass a translated string — if a future caller forgets, compilation fails. This is the structural mechanism that prevents GAP-2 from recurring (the root cause was having an English default that let the bug exist).
- **D-12:** All three call sites pass the translation of `common.skipToContent` (already exists in both `packages/i18n/src/locales/en/common.json:12` = `"Skip to content"` and `pt-BR/common.json:12` = `"Pular para o conteúdo"` — no new translation keys needed):
  - `apps/web/app/(auth)/layout.tsx` — uses next-intl's `useTranslations('common')`; note this layout currently has no `"use client"` / no hook usage, so it will either become a client component or use next-intl's `getTranslations()` server helper. Planner decides.
  - `apps/web/app/(dashboard)/layout.tsx:19` — already a client component (`"use client"` at line 1), add `useTranslations('common')` call.
  - `apps/admin/src/layouts/admin-layout.tsx:73` — already uses react-i18next elsewhere in the admin app, add `useTranslation('common')` call.

### Admin i18n namespace registration

- **D-13:** `apps/admin/src/lib/i18n.ts` imports `enInvite` and `ptBRInvite` from `@baseworks/i18n` and registers them under the `invite` namespace key in both `en` and `pt-BR` blocks of the `resources` object (mirroring the existing `admin`, `common`, etc. pattern at lines 20-33). The `namespaces` array from `@baseworks/i18n` already lists `invite` on line 5 and is spread into `i18n.init({ ns })` on line 41, so registering the resource is the only missing piece.
- **D-14:** No admin UI currently consumes `invite.*` keys (the invite flow lives in `apps/web`), but registration must happen regardless because success criterion 2 is an explicit requirement and any future admin-side invite management view would otherwise break.

### Regression prevention

- **D-15:** Verification follows Phase 11's pattern — grep-based acceptance assertions in `PLAN.md` plus `bun test` for the shared package suites. No new vitest harness in `apps/web`. Specific grep checks expected in the plan:
  - `grep -c '"Skip to content"' packages/ui/src/components/skip-link.tsx` returns `0`
  - `grep -c "label" packages/ui/src/components/skip-link.tsx` confirms the prop exists
  - `grep -c "You're invited to" packages/modules/billing/src/templates/team-invite.tsx` returns `0`
  - `grep -c "Accept Invitation" packages/modules/billing/src/templates/team-invite.tsx` returns `0`
  - `grep -c "invite:" apps/admin/src/lib/i18n.ts` returns `>= 2` (one per locale block)
  - `grep -c "invite.email.heading" packages/i18n/src/locales/en/invite.json` returns `1`
  - `grep -c "invite.email.heading" packages/i18n/src/locales/pt-BR/invite.json` returns `1`
- **D-16:** After Phase 12 completes, `/gsd-validate-phase 8` should flip I18N-01/I18N-02/I18N-03 from partial to satisfied and GAP-1/GAP-2 should close on the v1.1 audit re-run.

### Claude's Discretion

- Exact naming of the AsyncLocalStorage module and whether it exports a class, a `getLocale()` helper, or a `runWithLocale(locale, fn)` wrapper. Planner decides the shape.
- Whether the Elysia middleware that populates ALS lives in `packages/modules/auth/src/` (alongside the better-auth mount) or in a new `packages/modules/auth/src/middleware/` subdirectory. Research should confirm best pattern from existing Elysia middleware in the codebase.
- Whether to extract the `{variable}` interpolation helper into `@baseworks/i18n` as an exported utility or inline it in `send-email.ts`. Recommended: export from `@baseworks/i18n` for reuse, but the planner may keep it local if no other caller needs it yet.
- Whether `(auth)/layout.tsx` becomes a client component or uses `getTranslations()` server helper to pass the skip link label down. Either works; planner picks based on whether the layout needs other client-side state.
- Whether to convert `packages/modules/billing/src/jobs/send-email.ts:9` `templates` map entries to accept richer prop shapes or to keep a loose `(data: any) => JSX.Element` signature. Refactoring the signature is optional — the team-invite entry can change without touching the others.
- Exact English and Portuguese copy for the new `invite.email.*` keys (heading, body, cta, footer, subject). Source of truth: the current hardcoded English in `team-invite.tsx` lines 21-35 for English, plus idiomatic pt-BR translations matching the tone of existing `invite.json` entries.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Audit & Requirements

- `.planning/v1.1-MILESTONE-AUDIT.md` §Cross-Phase Integration Gaps (lines 182-200) — authoritative GAP-1, GAP-2, GAP-3 definitions. GAP-1 row at line 183-187 and GAP-2 row at line 189-192 are the primary source of truth for Phase 12 scope.
- `.planning/v1.1-MILESTONE-AUDIT.md` lines 62-74 — YAML-structured gap records with `affected_requirements` and `evidence` fields.
- `.planning/REQUIREMENTS.md` — Requirement text for I18N-01, I18N-02, I18N-03, I18N-04, A11Y-03, INVT-02.
- `.planning/ROADMAP.md` §"Phase 12: i18n Hardcoded String Cleanup" (lines 138-149) — phase goal, depends-on, success criteria.

### Files to modify

- `packages/ui/src/components/skip-link.tsx` — add required `label: string` prop, remove hardcoded `"Skip to content"` at line 13.
- `apps/web/app/(auth)/layout.tsx` — pass translated label to `<SkipToContent>` at line 6.
- `apps/web/app/(dashboard)/layout.tsx` — pass translated label to `<SkipToContent />` at line 19 (already a client component).
- `apps/admin/src/layouts/admin-layout.tsx` — pass translated label to `<SkipToContent />` at line 73.
- `apps/admin/src/lib/i18n.ts` — import `enInvite`/`ptBRInvite` and register the `invite` namespace in the `resources` object (lines 19-34).
- `packages/modules/billing/src/templates/team-invite.tsx` — refactor to pure presentation component; remove hardcoded English; accept pre-resolved `{ inviteLink, heading, body, ctaLabel, footer }` props.
- `packages/modules/billing/src/jobs/send-email.ts` — pre-resolve translations for `team-invite` template using `getMessages(locale)`, interpolate variables, localize subject line; locale comes from job payload `data.locale`.
- `packages/modules/auth/src/auth.ts` — `sendInvitationEmail` callback at line 89: resolve locale from ALS (or default), add `locale` field to the BullMQ job payload at lines 101-109.
- `packages/i18n/src/locales/en/invite.json` — add `email: { heading, body, cta, footer, subject }` subtree.
- `packages/i18n/src/locales/pt-BR/invite.json` — add `email: { heading, body, cta, footer, subject }` subtree.
- `packages/modules/auth/src/` — new file introducing AsyncLocalStorage store + Elysia middleware for request locale capture (exact location at planner discretion).
- Optional: `packages/i18n/src/index.ts` — export `interpolate(template, vars)` helper for `{variable}` token substitution.

### Reference implementations (read to match patterns, do not modify)

- `packages/i18n/src/index.ts` — `getMessages(locale)` loader pattern at lines 28-35; `namespaces` list already includes `invite` at line 5.
- `apps/admin/src/lib/i18n.ts:36-48` — canonical react-i18next init with custom `{` / `}` interpolation delimiters. The `invite` namespace addition follows this same resource-registration pattern.
- `apps/web/lib/i18n.ts` — current next-intl request config; shows how `defaultLocale` fallback is used today (Phase 12 keeps this pattern).
- `packages/modules/billing/src/templates/password-reset.tsx` — reference React Email template (this is the pattern `team-invite.tsx` was originally copied from; leave it alone, but read it to understand the React Email render flow).
- `packages/modules/auth/src/auth.ts:89-114` — current `sendInvitationEmail` callback with `@internal` email suppression for link-mode invites (per Phase 9 D-11). The locale plumbing must preserve this suppression branch.
- `packages/modules/auth/src/auth.ts:116-130` — `sendMagicLink` callback pattern; intentionally **not** touched by Phase 12 but serves as contrast for why subject localization is scoped only to team-invite.
- `apps/web/components/invite-dialog.tsx` — client-side `authClient.organization.inviteMember()` call site; Phase 12 does NOT modify this file, confirming D-01's "zero client changes" property.

### Prior phase context (pre-answered decisions)

- `.planning/phases/08-internationalization/08-01-SUMMARY.md` — Phase 8 established `packages/i18n` with 6 namespaces, 280 keys, next-intl + react-i18next dual-library pattern, `{variable}` interpolation syntax, defaultLocale=en. All of these are locked and carried forward.
- `.planning/phases/09-team-invites/09-CONTEXT.md` §"Email Infrastructure" and §"i18n" — Phase 9 wired `sendInvitationEmail` → BullMQ email queue → `team-invite` template; translation key structure for invite-related strings was left to Claude's discretion (now locked by D-08 above).
- `.planning/phases/11-a11y-gap-closure/11-CONTEXT.md` §"Regression prevention" — establishes the precedent that grep-based acceptance assertions are acceptable for gap-closure phases and that bootstrapping `apps/web` vitest is out of scope. Phase 12 inherits this policy (D-15).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`getMessages(locale)` loader** (`packages/i18n/src/index.ts:28`) — async function that returns a flat `{ [namespace]: { [key]: value } }` dict. `send-email.ts` will call this to pre-resolve invite email strings.
- **`namespaces` constant** (`packages/i18n/src/index.ts:5`) — already includes `"invite"`; admin i18n init already spreads this array into `ns`. Only the `resources` registration is missing.
- **Existing `common.skipToContent` key** (`packages/i18n/src/locales/en/common.json:12`, `pt-BR/common.json:12`) — no new translation keys needed for the skip link fix. Values are `"Skip to content"` / `"Pular para o conteúdo"`.
- **React Email `render()` pipeline** (`packages/modules/billing/src/jobs/send-email.ts:51`) — already async (`await render(...)`), so pre-resolution of messages via `await getMessages(locale)` before render is a natural fit.
- **BullMQ job payload shape** (`packages/modules/auth/src/auth.ts:101-109`) — already passes a flexible `data: { ... }` object; adding `locale` is a non-breaking addition.
- **`@internal` email suppression** (`packages/modules/auth/src/auth.ts:93-96`) — Phase 9 D-11 contract; preserved as-is.

### Established Patterns

- **`{variable}` interpolation syntax** — consistent across both apps. next-intl defaults to `{}`, react-i18next is configured to match (`apps/admin/src/lib/i18n.ts:45-46`). Any interpolation helper introduced in Phase 12 must use the same delimiters.
- **Dual i18n library pattern** — next-intl for Next.js server components, react-i18next for Vite admin. Phase 12 does not introduce a third library and does not consolidate them.
- **Grep-based acceptance verification** (Phase 11) — no new test harness for `apps/web`. All verification is either `bun test` on shared packages or file-level grep assertions in `PLAN.md`.
- **React Email templates as pure functional components** — existing templates (`password-reset.tsx`, `welcome.tsx`, `billing-notification.tsx`) receive props and render JSX, no hooks, no context. Phase 12 preserves this constraint for `team-invite.tsx`.

### Integration Points

- **`sendInvitationEmail` callback → BullMQ queue** (`packages/modules/auth/src/auth.ts:89` → `packages/modules/billing/src/jobs/send-email.ts:33`) — locale travels as a new field on the job payload across this boundary.
- **Elysia request → better-auth handler → `sendInvitationEmail`** — AsyncLocalStorage middleware hooks into the outermost Elysia layer so the locale is in the store before better-auth's handler invokes the callback.
- **`packages/i18n` → `send-email.ts`** — new runtime dependency direction. `packages/modules/billing` already depends on `@baseworks/config`; verify `@baseworks/i18n` can be added to its `package.json` without a circular dependency.
- **Layout components → `SkipToContent`** — 3 call sites, 2 different i18n libraries (next-intl in apps/web, react-i18next in apps/admin). Both resolve `common.skipToContent` to the same English/Portuguese strings.

</code_context>

<specifics>
## Specific Ideas

**Audit-derived acceptance criteria (every one must be grep-verifiable after the phase):**

1. `grep -c '"Skip to content"' packages/ui/src/components/skip-link.tsx` returns `0` — hardcoded literal removed.
2. `grep -c "label:" packages/ui/src/components/skip-link.tsx` returns `>= 1` — prop added.
3. `grep -c "skipToContent\|Skip to content" apps/web/app/\(auth\)/layout.tsx apps/web/app/\(dashboard\)/layout.tsx apps/admin/src/layouts/admin-layout.tsx` shows translation calls, not literals — 3 call sites updated.
4. `grep -c "You're invited to\|Accept Invitation\|If you were not expecting" packages/modules/billing/src/templates/team-invite.tsx` returns `0` — all hardcoded English removed.
5. `grep -c "invite.email" packages/modules/billing/src/jobs/send-email.ts` returns `>= 4` — heading/body/cta/footer keys consumed.
6. `grep -c "enInvite\|ptBRInvite" apps/admin/src/lib/i18n.ts` returns `>= 2` — namespace registration landed.
7. `grep -c '"heading"\|"body"\|"cta"\|"footer"\|"subject"' packages/i18n/src/locales/en/invite.json` returns `>= 5` — new email subtree exists.
8. Same check against `packages/i18n/src/locales/pt-BR/invite.json` returns `>= 5`.
9. `bun test` passes with no regressions.
10. Running `/gsd-validate-phase 8` (or a manual re-read of Phase 8 VERIFICATION) flips I18N-01/I18N-02/I18N-03 from partial to satisfied.
11. Pt-BR end-to-end smoke: set `NEXT_LOCALE=pt-BR` cookie, tab into `apps/web` → skip link shows "Pular para o conteúdo"; send a team invite → received email subject, heading, body, CTA, footer are all Portuguese.

**Visual / UX constraints (nothing visible should change except language):**

- Skip link visual styling (`sr-only focus:not-sr-only ...`) stays identical.
- Email template layout, colors, font, button styling stay identical to the current English version.
- Role label in email body reads naturally in both languages (e.g., "as a member" / "como membro" — pt-BR may need Portuguese gendering; use whatever `invite.roles.member` already returns).

**Translation content guidance (new `invite.email.*` keys):**

- English values match current hardcoded copy in `team-invite.tsx` lines 21-35 so Phase 12 is functionally identical for `en` users.
- Portuguese values match the tone of existing `invite.json` entries (formal "você" form, sentence case matching the English entries).
- Subject line should be under 60 chars in both languages for email client rendering.

</specifics>

<deferred>
## Deferred Ideas

- **User-facing locale switcher + persisted `user.locale` column (I18N-05)** — explicitly deferred to v1.2 per `apps/web/lib/i18n.ts:10` comment and v1.1-MILESTONE-AUDIT.md line 210 (end-to-end flow E).
- **Moving `team-invite.tsx` out of `billing` module** — audit flags the location as misplaced but a module move is a refactor, not a cleanup. Tracked as tech debt for a future organizational pass.
- **Localizing the other 4 email templates** (welcome, password-reset, magic-link, billing-notification) — their hardcoded English strings are the same class of bug as GAP-1 but outside Phase 12's audit-anchored scope. Could become a "transactional email i18n sweep" phase in v1.2.
- **Parsing full `Accept-Language` q-value ranking** — D-03 uses simple cookie → default fallback. Full RFC 9110 q-value parsing is deferred; if `NEXT_LOCALE` cookie is unset the fallback is just `defaultLocale` (not a partial match on `Accept-Language`).
- **Phase 8 VERIFICATION.md regeneration / Nyquist compliance for Phase 8** — tracked as its own workstream via `/gsd-validate-phase 8` after Phase 12 lands.
- **InviteDialog client-side locale passing** — D-02 explicitly avoids touching the `authClient.organization.inviteMember()` call site. If a future phase ever wants the client to declare locale explicitly, it would add `additionalFields` to the better-auth plugin config, which is out of scope here.

</deferred>

---

*Phase: 12-i18n-string-cleanup*
*Context gathered: 2026-04-14*
