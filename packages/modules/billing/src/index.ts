import type { ModuleDefinition } from "@baseworks/shared";
import { billingRoutes } from "./routes";
import { processWebhook } from "./jobs/process-webhook";

export { registerBillingHooks } from "./hooks/on-tenant-created";

/**
 * Billing module definition following the Medusa-style module pattern.
 *
 * Per D-23: Module exports routes, commands, queries, jobs, events.
 *
 * Routes: /api/billing/webhooks (Stripe webhook endpoint)
 * Jobs: billing:process-webhook (async webhook event processing)
 * Events: subscription.created, subscription.cancelled, payment.succeeded, payment.failed
 *
 * Commands and queries will be added in Plan 03 (checkout, portal, subscription management).
 */
export default {
  name: "billing",
  routes: billingRoutes,
  commands: {
    // Commands added in Plan 03
  },
  queries: {
    // Queries added in Plan 03
  },
  jobs: {
    "billing:process-webhook": {
      queue: "billing:process-webhook",
      handler: processWebhook,
    },
  },
  events: [
    "subscription.created",
    "subscription.cancelled",
    "payment.succeeded",
    "payment.failed",
  ],
} satisfies ModuleDefinition;
