# Notification Layer — Phase 3 Implementation Plan (email channel + migrate email out of billing)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Checkbox (`- [ ]`) steps. Executed via the gated Workflow.

**Goal:** Consolidate the ad-hoc email pipeline (currently in the **billing** module) into the notifications module behind a pluggable `EmailProvider` port, add an **email channel adapter** for `notify()`, and a **`sendTransactionalEmail`** path for address-only auth/billing emails — all delivered by a single `notifications-deliver` BullMQ worker. **Behavior-preserving** for the existing auth/billing emails (password-reset, magic-link, team-invite, welcome, billing-notification).

**Architecture:** One `notifications-deliver` queue with a discriminated payload: `{kind:"transactional-email", to, template, data}` (address-only — auth/billing producers) and `{kind:"channel-delivery", deliveryId, channel}` (tenant-notification email/webhook). The worker `deliver.ts` branches: render via the moved `email-render` + send via `EmailProvider` (Resend impl). Producers enqueue to the new queue directly through `@baseworks/queue` (no cross-module import — the queue name + payload is the contract, exactly as `email-send` was). The old `email-send` job + billing templates are removed.

**⚠️ Risk:** touches live auth email flows (password reset / magic link / invites). Every change is behavior-preserving; the existing `billing.test.ts` email assertions are migrated and kept green, and an end-to-end "enqueue → worker renders+sends (mock provider)" test covers each template.

**Tech Stack:** Bun, BullMQ (`@baseworks/queue`), React-Email + Resend, `@baseworks/i18n`, TypeBox, Bun test.

**Spec:** `docs/superpowers/specs/2026-06-25-notification-layer-design.md` · **Builds on:** Phase 2 (#11), Phase 2-web (#12)

---

## File structure (Phase 3)

| File | Responsibility |
|------|----------------|
| `packages/modules/notifications/src/channels/email-provider.ts` (create) | `EmailProvider` port + `EmailMessage` |
| `packages/modules/notifications/src/channels/resend-provider.ts` (create) | Resend impl (graceful no-key skip) |
| `packages/modules/notifications/src/templates/*` (move from billing) | React-Email templates |
| `packages/modules/notifications/src/lib/email-render.ts` (create; logic moved from billing `send-email.ts`) | `renderEmail(template, data) → {html, subject}` incl. `resolveTeamInvite` i18n |
| `packages/modules/notifications/src/channels/email.ts` (create) | email `ChannelAdapter` for `notify()` |
| `packages/modules/notifications/src/commands/send-transactional-email.ts` (create) | enqueue `kind:"transactional-email"` (ctx callers) |
| `packages/modules/notifications/src/jobs/deliver.ts` (create) | `notifications-deliver` worker (branches on `kind`) |
| `packages/modules/notifications/src/index.ts` (modify) | register the `notifications-deliver` job + `send-transactional-email` command |
| `packages/modules/notifications/src/sse/runtime.ts` (modify) | register the email channel adapter |
| `packages/modules/auth/src/auth.ts` (modify) | repoint the 3 enqueue sites to `notifications-deliver` + `kind` |
| `packages/modules/billing/src/{index,routes}.ts`, `hooks/on-tenant-created.ts` (modify) | repoint producer(s); remove the `email-send` job |
| `packages/modules/billing/src/templates/*`, `jobs/send-email.ts` (delete) | moved to notifications |
| tests: migrate billing email tests → notifications; new provider/adapter/worker tests | |

> Worker context: `deliver.ts` runs in the worker process (no request ctx); it loads notification/delivery rows via the **owner** `getDb()` (cross-tenant by design — the worker is trusted; the `lint:tenant-db` guard only covers `commands/`+`queries/`).

---

## Task 1: `EmailProvider` port + Resend impl

**Files:** Create `channels/email-provider.ts`, `channels/resend-provider.ts` · Test `channels/__tests__/resend-provider.test.ts`

- [ ] **Step 1: Port**

```ts
// packages/modules/notifications/src/channels/email-provider.ts
export interface EmailMessage { to: string; subject: string; html: string; from?: string }
export interface EmailSendResult { messageId?: string; skipped?: boolean }
export interface EmailProvider {
  send(msg: EmailMessage): Promise<EmailSendResult>;
}
```

- [ ] **Step 2: Failing test** — without an API key the Resend provider skips (returns `{skipped:true}`) and never throws.

```ts
// packages/modules/notifications/src/channels/__tests__/resend-provider.test.ts
import { describe, expect, test } from "bun:test";
import { ResendEmailProvider } from "../resend-provider";

describe("ResendEmailProvider", () => {
  test("skips gracefully when no API key", async () => {
    const p = new ResendEmailProvider(undefined);
    const res = await p.send({ to: "a@b.c", subject: "s", html: "<p>h</p>" });
    expect(res.skipped).toBe(true);
  });
});
```

- [ ] **Step 3: Implement** (mirrors the existing `send-email.ts` graceful-skip behavior + Resend `from`)

```ts
// packages/modules/notifications/src/channels/resend-provider.ts
import { Resend } from "resend";
import type { EmailMessage, EmailProvider, EmailSendResult } from "./email-provider";

const DEFAULT_FROM = "Baseworks <noreply@baseworks.dev>";

export class ResendEmailProvider implements EmailProvider {
  constructor(private readonly apiKey: string | undefined) {}
  async send(msg: EmailMessage): Promise<EmailSendResult> {
    if (!this.apiKey) {
      console.log(`[EMAIL] Skipping send (no RESEND_API_KEY): to=${msg.to}`);
      return { skipped: true };
    }
    const resend = new Resend(this.apiKey);
    const { data } = await resend.emails.send({
      from: msg.from ?? DEFAULT_FROM,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
    });
    return { messageId: data?.id };
  }
}
```

- [ ] **Step 4: Run → pass.** (Add `resend` to `packages/modules/notifications/package.json` deps — same version billing uses; `bun install`.) **Step 5: Commit** `feat(notifications): EmailProvider port + Resend impl`.

## Task 2: Move templates + the render logic out of billing

**Files:** Move `packages/modules/billing/src/templates/{welcome,password-reset,team-invite,billing-notification}.tsx` → `packages/modules/notifications/src/templates/`. Create `lib/email-render.ts`. · Test `lib/__tests__/email-render.test.ts`

- [ ] **Step 1: Move the 4 template files** (`git mv`) into `notifications/src/templates/`. Add `@react-email/components` + `react` to the notifications package deps (same versions billing uses); `bun install`.

- [ ] **Step 2: Create `email-render.ts`** by lifting the template map, subjects, and `resolveTeamInvite` from billing's `send-email.ts` — but as a pure `renderEmail(template, data) → { html, subject }` (no provider/send; that's the worker's job). Keep the `team-invite` i18n resolution and the `magic-link`→PasswordReset reuse identical.

```ts
// packages/modules/notifications/src/lib/email-render.ts
import { defaultLocale, getMessages, interpolate, type Locale } from "@baseworks/i18n";
import { render } from "@react-email/components";
import type { ReactElement } from "react";
import { BillingNotificationEmail } from "../templates/billing-notification";
import { PasswordResetEmail } from "../templates/password-reset";
import { TeamInviteEmail } from "../templates/team-invite";
import { WelcomeEmail } from "../templates/welcome";

const templates: Record<string, (data: any) => ReactElement> = {
  welcome: (d) => WelcomeEmail(d),
  "password-reset": (d) => PasswordResetEmail(d),
  "magic-link": (d) => PasswordResetEmail({ ...d, userName: d.email }),
  "billing-notification": (d) => BillingNotificationEmail(d),
  "team-invite": (d) => TeamInviteEmail(d),
};
const subjects: Record<string, string> = {
  welcome: "Welcome to Baseworks!",
  "password-reset": "Reset Your Password",
  "magic-link": "Your Sign-in Link",
  "billing-notification": "Billing Update",
  "team-invite": "You're Invited to Join a Team",
};

// resolveTeamInvite(): copy VERBATIM from billing/src/jobs/send-email.ts (the i18n
// resolution for the team-invite subject/props) — same function, same behavior.
// (paste the full resolveTeamInvite + resolveRoleLabel here)

export async function renderEmail(template: string, data: Record<string, unknown>): Promise<{ html: string; subject: string }> {
  if (template === "team-invite") {
    const { props, subject } = await resolveTeamInvite(data as any);
    return { html: await render(TeamInviteEmail(props)), subject };
  }
  const Component = templates[template];
  if (!Component) throw new Error(`Unknown email template: ${template}`);
  return { html: await render(Component(data)), subject: subjects[template] ?? "Notification" };
}
```

> The plan author must paste the real `resolveTeamInvite`/`resolveRoleLabel` bodies from `packages/modules/billing/src/jobs/send-email.ts` (lines ~50–115) verbatim — they are not reproduced fully here to avoid drift; copy them as-is.

- [ ] **Step 3: Test** — `renderEmail("password-reset", {url:"u",userName:"x"})` returns non-empty html + the right subject; `renderEmail("team-invite", {...})` resolves the localized subject; unknown template throws. Run → pass.
- [ ] **Step 4: Commit** `feat(notifications): move email templates + render out of billing`.

## Task 3: `notifications-deliver` worker (transactional-email branch) + `sendTransactionalEmail`

**Files:** Create `jobs/deliver.ts`, `commands/send-transactional-email.ts` · Test `__tests__/deliver-transactional.test.ts`

- [ ] **Step 1: Worker** (Phase 3 implements the transactional-email branch + email channel-delivery branch; webhook branch is Phase 4)

```ts
// packages/modules/notifications/src/jobs/deliver.ts
import { env } from "@baseworks/config";
import { getDb, notification, notificationDelivery } from "@baseworks/db";
import { eq } from "drizzle-orm";
import { ResendEmailProvider } from "../channels/resend-provider";
import { EmailAdapter } from "../channels/email";
import { renderEmail } from "../lib/email-render";

const provider = () => new ResendEmailProvider(env.RESEND_API_KEY);

export async function deliver(payload: unknown): Promise<void> {
  const job = payload as
    | { kind: "transactional-email"; to: string; template: string; data: Record<string, unknown> }
    | { kind: "channel-delivery"; deliveryId: string; channel: string };

  if (job.kind === "transactional-email") {
    const { html, subject } = await renderEmail(job.template, job.data);
    await provider().send({ to: job.to, subject, html });
    return;
  }

  // channel-delivery (tenant notification). Owner db (worker is cross-tenant/trusted).
  const db = getDb(env.DATABASE_URL);
  const [delivery] = await db.select().from(notificationDelivery).where(eq(notificationDelivery.id, job.deliveryId)).limit(1);
  if (!delivery) return;
  const [notif] = await db.select().from(notification).where(eq(notification.id, delivery.notificationId)).limit(1);
  if (!notif) return;

  let result: { status: "sent" | "failed" | "skipped"; error?: string } = { status: "skipped" };
  try {
    if (job.channel === "email") {
      result = await new EmailAdapter(provider(), db).deliver(notif as any, delivery.id);
    }
  } catch (err) {
    result = { status: "failed", error: String(err) };
  }
  await db.update(notificationDelivery).set({ status: result.status, error: result.error ?? null }).where(eq(notificationDelivery.id, delivery.id));
}
```

- [ ] **Step 2: `sendTransactionalEmail` command** (for ctx callers; auth/billing enqueue directly — see Tasks 5/6)

```ts
// packages/modules/notifications/src/commands/send-transactional-email.ts
import { env } from "@baseworks/config";
import { createQueue } from "@baseworks/queue";
import { defineCommand, ok } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";

const Input = Type.Object({
  to: Type.String(),
  template: Type.String(),
  data: Type.Record(Type.String(), Type.Unknown()),
});

export const sendTransactionalEmail = defineCommand(Input, async (input) => {
  if (env.REDIS_URL) {
    await createQueue("notifications-deliver", env.REDIS_URL).add("transactional-email", {
      kind: "transactional-email",
      to: input.to,
      template: input.template,
      data: input.data,
    });
  } else {
    console.log(`[EMAIL] (no REDIS_URL) would send template=${input.template} to=${input.to}`);
  }
  return ok({});
});
```

- [ ] **Step 3: Test** — call `deliver({kind:"transactional-email", to, template:"password-reset", data})` with a mocked provider (inject via a seam or assert no throw + render produced); assert `renderEmail` output is passed to `send`. (Use `mock.module` on `../channels/resend-provider` to capture the `send` call, or refactor `deliver` to accept an injected provider for testability — prefer the latter: add an optional `deps` param `deliver(payload, deps = { provider: provider() })`.) Run → pass.
- [ ] **Step 4: Commit** `feat(notifications): notifications-deliver worker + sendTransactionalEmail`.

## Task 4: Email channel adapter (for `notify()`)

**Files:** Create `channels/email.ts` · Test `channels/__tests__/email-adapter.test.ts`

- [ ] **Step 1: Adapter** — renders a generic notification email (title/body + a CTA to `url`) and sends via the provider.

```ts
// packages/modules/notifications/src/channels/email.ts
import type { Channel, ChannelAdapter, DeliverableNotification, DeliveryResult } from "./channel";
import type { EmailProvider } from "./email-provider";

/** email channel for tenant notifications. Renders a generic notification email
 *  from the row (catalog-specific email templates can be added later). Needs the
 *  recipient's email — resolved via the injected db (worker, owner). */
export class EmailAdapter implements ChannelAdapter {
  readonly name: Channel = "email";
  constructor(private readonly provider: EmailProvider, private readonly db: any) {}
  async deliver(n: DeliverableNotification, _deliveryId: string): Promise<DeliveryResult> {
    const email = await resolveRecipientEmail(this.db, n.recipientUserId);
    if (!email) return { status: "skipped", reason: "no email for recipient" };
    const html = `<h2>${escapeHtml(n.title)}</h2><p>${escapeHtml(n.body)}</p>${n.url ? `<p><a href="${n.url}">View</a></p>` : ""}`;
    const res = await this.provider.send({ to: email, subject: n.title, html });
    return res.skipped ? { status: "skipped", reason: "no provider" } : { status: "sent", providerMessageId: res.messageId };
  }
}
// resolveRecipientEmail: SELECT email FROM "user" WHERE id = recipientUserId (auth table; owner db). escapeHtml: minimal &<>"' escaper.
```

- [ ] **Step 2: Test** — inject a fake provider + a fake db returning an email; assert `send` called with the user's email + the title as subject; missing email → `skipped`. Run → pass.
- [ ] **Step 3: Commit** `feat(notifications): email channel adapter`.

## Task 5: Repoint auth producers + register worker/adapter

**Files:** Modify `packages/modules/auth/src/auth.ts`, `packages/modules/notifications/src/index.ts`, `packages/modules/notifications/src/sse/runtime.ts`

- [ ] **Step 1: auth.ts** — change `createQueue("email-send", …)` → `createQueue("notifications-deliver", …)`, and each `queue.add("<name>", { to, template, data })` → `queue.add("<name>", { kind: "transactional-email", to, template, data })`. (3 sites: password-reset, team-invite, magic-link. The `template` field value is unchanged.)

- [ ] **Step 2: Register the worker job** in `notifications/src/index.ts` `ModuleDefinition`:

```ts
import { deliver } from "./jobs/deliver";
import { sendTransactionalEmail } from "./commands/send-transactional-email";
// ...in commands: add  "notifications:send-transactional-email": sendTransactionalEmail
// ...add:
jobs: { "notifications-deliver": { queue: "notifications-deliver", handler: deliver } },
```

- [ ] **Step 3: Register the email adapter** in `sse/runtime.ts` `ensureNotificationsRuntime()`:

```ts
import { ResendEmailProvider } from "../channels/resend-provider";
import { EmailAdapter } from "../channels/email";
// inside ensureNotificationsRuntime(), after the in-app adapter:
registerAdapter(new EmailAdapter(new ResendEmailProvider(env.RESEND_API_KEY), getDb(env.DATABASE_URL)));
```
(import `env` from `@baseworks/config`, `getDb` from `@baseworks/db`.) Now `notify()` with a catalog `email` default channel enqueues a `channel-delivery` email job — **add that enqueue to `notify()`**: for non-in-app effective channels with a registered adapter, instead of delivering inline, enqueue `{kind:"channel-delivery", deliveryId, channel}` to `notifications-deliver` (in-app stays inline). Update `notify.ts` accordingly.

- [ ] **Step 4: Gate** — `bun run typecheck && bun run lint` and the notifications + auth suites:
  `BASEWORKS_RLS_PASSWORD=baseworks_rls_dev DATABASE_URL_RLS=… bun test packages/modules/notifications packages/modules/auth` → all pass (auth email-enqueue tests, if any, now assert the new queue/payload — update them).
- [ ] **Step 5: Commit** `feat(notifications): repoint auth emails + register worker/adapter`.

## Task 6: Migrate billing producers + remove the old pipeline

**Files:** Modify `billing/src/index.ts`, `billing/src/routes.ts`, `billing/src/hooks/on-tenant-created.ts`; delete `billing/src/jobs/send-email.ts` + `billing/src/templates/*`; migrate `billing/src/__tests__/billing.test.ts` email assertions.

- [ ] **Step 1: Repoint billing's enqueue sites** (`routes.ts`, `on-tenant-created.ts`, and any welcome producer) from `email-send` → `notifications-deliver` with `{ kind: "transactional-email", to, template, data }` (template values unchanged: `billing-notification`, `welcome`, …).
- [ ] **Step 2: Remove the `email-send` job** from `billing/src/index.ts` `jobs` and its `import { sendEmail }`. Delete `billing/src/jobs/send-email.ts` and `billing/src/templates/*` (now in notifications).
- [ ] **Step 3: Migrate the email tests** — move the `sendEmail`/template assertions from `billing.test.ts` into a notifications test that exercises `renderEmail` + the `deliver` transactional-email branch (mock provider). Remove the now-dead billing email test cases.
- [ ] **Step 4: Full gate** — `bun run typecheck && bun run lint` (incl. `lint:cross-module` — auth/billing must NOT import `@baseworks/module-notifications`; they only enqueue to the named queue) and:
  `BASEWORKS_RLS_PASSWORD=baseworks_rls_dev DATABASE_URL_RLS=… bun test packages/modules/notifications packages/modules/billing packages/modules/auth apps/api` → all pass.
- [ ] **Step 5: Commit** `feat(notifications): migrate billing emails + remove email-send`.

---

## Self-review

- **Spec coverage (Phase 3):** `EmailProvider` port + Resend (T1) ✓; templates+render moved out of billing (T2) ✓; `notifications-deliver` worker + `sendTransactionalEmail` (T3) ✓; email channel adapter for `notify()` (T4) ✓; producers repointed — auth (T5) + billing (T6) ✓; old `email-send` job + billing templates removed (T6) ✓; behavior-preserving (template names/subjects/i18n unchanged) ✓.
- **Placeholders:** the only "paste verbatim" is `resolveTeamInvite` (T2) — an explicit copy-from-source instruction, not an invention. No other gaps.
- **Type consistency:** `EmailProvider`/`EmailMessage`/`EmailSendResult` (T1) used by `resend-provider` (T1), `email.ts` adapter (T4), and `deliver.ts` (T3); `renderEmail(template,data)→{html,subject}` (T2) consumed by `deliver.ts` transactional branch (T3); job payload discriminant `kind` consistent across `notify.ts`/`send-transactional-email.ts`/`auth.ts`/`billing` producers/`deliver.ts`.
- **Verifications (not placeholders):** the exact `resolveTeamInvite` body (T2, copy from billing); whether a `welcome` email producer exists and where (T6 — grep `"welcome"` enqueue sites and repoint); existing `billing.test.ts` email assertions (T6 — migrate, keep behavior).

## ⚠️ Risk & rollback

This rewires **live auth email flows**. Mitigations: every change is behavior-preserving (same template names, subjects, i18n, graceful no-key skip); the migrated tests cover each template end-to-end through the new worker with a mock provider; `lint:cross-module` ensures auth/billing don't import the notifications module (queue-name contract only). Rollback = revert the PR (the `email-send` → `notifications-deliver` rename is the only runtime-visible change; templates render identically).

## Next

Phase 4 (webhooks: endpoint CRUD + HMAC + the `channel-delivery` webhook branch), Phase 5 (dispatch actions), Phase 6 (preferences + page). Some real producers may also convert from `sendTransactionalEmail` to `notify()` (in-app + email) once preferences exist.
