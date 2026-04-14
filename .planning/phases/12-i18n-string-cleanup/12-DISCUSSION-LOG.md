# Phase 12: i18n Hardcoded String Cleanup - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-14
**Phase:** 12-i18n-string-cleanup
**Areas discussed:** Locale resolution strategy, Template translation plumbing, Email subject line localization, SkipToContent API + admin registration

---

## Locale resolution strategy

### Q1: How should the invite email resolve the recipient's locale?

| Option | Description | Selected |
|--------|-------------|----------|
| Inviter's request locale | Capture NEXT_LOCALE cookie / Accept-Language from inviter's HTTP request at sendInvitationEmail time, thread into render pipeline. Zero schema changes. | ✓ |
| Default locale only (en) | Always use defaultLocale; template still accepts locale param. Fails success criterion 5. | |
| Add user.locale column | Drizzle migration on user table; write on signup; read in sendInvitationEmail. Completes the locale picture but crosses into I18N-05 territory. | |
| Store locale on invitation | Extend better-auth invitation table with locale column. Schema extension awkward because better-auth owns the table. | |

**User's choice:** Inviter's request locale
**Notes:** The inviter is already sitting in their localized UI — statistically most likely to invite people in the same language. Zero schema changes is the deciding factor given I18N-05 is explicitly deferred.

### Q2: How should the inviter's locale be plumbed into sendInvitationEmail?

| Option | Description | Selected |
|--------|-------------|----------|
| AsyncLocalStorage in Elysia | Small middleware reads NEXT_LOCALE cookie / Accept-Language header, stashes on ALS. Callback reads from ALS. One new file, future-proof for other callbacks. | ✓ |
| Read from better-auth ctx | Depends on whether better-auth 1.2+ exposes ctx.headers to plugin callbacks. Version-dependent. | |
| Explicit locale header + custom route | Wrap auth.api.createInvitation in a custom Elysia route that reads x-user-locale. More surface area. | |
| Schema extension on invitation | additionalFields: { locale } on better-auth org plugin config. Requires migration + client change. | |

**User's choice:** AsyncLocalStorage in Elysia
**Notes:** Isolated infrastructure pattern; inviter flow unchanged; no better-auth plugin extension.

### Q3: Fallback when ALS has no locale?

| Option | Description | Selected |
|--------|-------------|----------|
| Default locale (en) | Fall back to defaultLocale from @baseworks/i18n. Matches existing apps/web/lib/i18n.ts fallback. | ✓ |
| Accept-Language header | Parse Accept-Language and best-match against supportedLngs. More accurate but adds parsing logic. | |
| Inviter user's created locale | Requires a new column — out of scope. | |

**User's choice:** Default locale (en)
**Notes:** Predictable, matches existing fallback pattern, parsing Accept-Language q-values is deferred as enhancement.

---

## Template translation plumbing

### Q4: How should translated strings reach TeamInviteEmail?

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-resolve dict in send-email.ts | send-email.ts calls getMessages(locale), extracts/interpolates strings, passes flat props. Template is pure presentation. | ✓ |
| Template loads messages itself | TeamInviteEmail becomes async component, calls await getMessages(locale) internally. Couples template to @baseworks/i18n. | |
| Inject t() function | send-email.ts builds t(key) closure bound to messages, template calls t('email.heading'). Adds type-unsafe indirection. | |

**User's choice:** Pre-resolve dict in send-email.ts
**Notes:** Template stays decoupled from packages/i18n and testable with raw props; async getMessages stays at the worker boundary where awaiting is natural.

### Q5: Where should the new email-template keys live?

| Option | Description | Selected |
|--------|-------------|----------|
| invite.email.* subtree | Add email: { heading, body, cta, footer } under existing invite namespace. Colocated with rest of feature. | ✓ |
| New 'email' namespace | Create packages/i18n/src/locales/{locale}/email.json as 7th namespace. Forward-looking but noisy for one template. | |
| Flat keys at invite root | invite.emailHeading, invite.emailBody, etc. Less hierarchy but mixed concerns at root. | |

**User's choice:** invite.email.* subtree
**Notes:** invite.json already registered in both apps; keys belong to the same feature domain; hierarchy aids discovery.

---

## Email subject line localization

### Q6: Should the invite email subject line also be localized?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — team-invite only | Add invite.email.subject keys; resolve in send-email.ts for team-invite branch only. Fully closes GAP-1. | ✓ |
| No — leave subjects as-is | Strictly, success criteria only mention heading/body/CTA/footer. Pt-BR recipients see English inbox subject. | |
| Yes — all templates | Refactor subjects map to be locale-aware across all 5 templates. Scope creep into welcome/password-reset/etc. | |

**User's choice:** Yes — team-invite only
**Notes:** Closes GAP-1 fully (audit language: "template not localized" — subject is part of the email) without expanding scope to templates Phase 12 is not touching.

---

## SkipToContent API + new keys

### Q7: What's the SkipToContent label prop contract?

| Option | Description | Selected |
|--------|-------------|----------|
| Required label prop | `label: string` required. TypeScript enforces all 3 call sites pass translated strings. No English default. | ✓ |
| Optional with en default | `label?: string = "Skip to content"`. Backwards compatible but defeats the fix by re-introducing the default. | |
| Optional, default undefined | `label?: string` with no default. Render nothing if omitted? Confusing for an a11y primitive. | |

**User's choice:** Required label prop
**Notes:** Success criterion 1 requires both app layouts pass a translated string; required prop makes this compile-time guaranteed and is the structural mechanism that prevents GAP-2 from recurring.

### Q8: Which translation key should the 3 skip link call sites use?

| Option | Description | Selected |
|--------|-------------|----------|
| common.skipToContent | Already exists in en/pt-BR common.json. Zero new keys, works for both apps via their respective hooks. | ✓ |
| New dedicated a11y namespace | packages/i18n/src/locales/{locale}/a11y.json. Cleaner grouping but new namespace for one key. | |

**User's choice:** common.skipToContent
**Notes:** Key already exists ("Skip to content" / "Pular para o conteúdo"); zero migration; used from next-intl's useTranslations in apps/web and react-i18next's useTranslation in apps/admin.

---

## Claude's Discretion

- AsyncLocalStorage module shape (class vs helpers vs runWithLocale wrapper)
- Exact location of the Elysia middleware file
- Whether to extract the `{variable}` interpolation helper into `@baseworks/i18n` or keep inline in `send-email.ts`
- Whether `(auth)/layout.tsx` becomes a client component or uses `getTranslations()` server helper
- Exact en/pt-BR copy for new `invite.email.*` keys
- Whether the `subjects` map in `send-email.ts` gets restructured or branched with a targeted if-check

## Deferred Ideas

- User-facing locale switcher + persisted `user.locale` column (I18N-05, v1.2)
- Moving `team-invite.tsx` out of the `billing` module (refactor, not cleanup)
- Localizing welcome / password-reset / magic-link / billing-notification templates (transactional email i18n sweep)
- Full RFC 9110 Accept-Language q-value parsing
- Phase 8 VERIFICATION.md regeneration / Nyquist compliance
- InviteDialog client-side locale passing via additionalFields
