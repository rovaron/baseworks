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

/**
 * Enqueue an address-only transactional email onto the `notifications-deliver`
 * queue (consumed by the {@link import("../jobs/deliver").deliver} worker).
 *
 * The queue name + `{ kind: "transactional-email", ... }` payload is the
 * cross-module contract — producers never import the notifications module.
 * Falls back to a console log when `REDIS_URL` is unset (dev/test).
 */
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
