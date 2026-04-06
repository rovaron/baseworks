import type { ModuleDefinition } from "@baseworks/shared";
import { billingRoutes } from "./routes";
import { processWebhook } from "./jobs/process-webhook";
import { syncUsage } from "./jobs/sync-usage";
import { sendEmail } from "./jobs/send-email";
import { createCheckoutSession } from "./commands/create-checkout-session";
import { cancelSubscription } from "./commands/cancel-subscription";
import { changeSubscription } from "./commands/change-subscription";
import { createOneTimePayment } from "./commands/create-one-time-payment";
import { createPortalSession } from "./commands/create-portal-session";
import { recordUsage } from "./commands/record-usage";
import { getSubscriptionStatus } from "./queries/get-subscription-status";
import { getBillingHistory } from "./queries/get-billing-history";

export { registerBillingHooks } from "./hooks/on-tenant-created";

/**
 * Billing module definition following the Medusa-style module pattern.
 *
 * Per D-23: Module exports routes, commands, queries, jobs, events.
 *
 * Routes: /api/billing/webhooks (Stripe webhook endpoint)
 * Commands: checkout, cancel, change, one-time payment, portal session
 * Queries: subscription status, billing history
 * Jobs: billing:process-webhook (async webhook event processing)
 * Events: subscription.created, subscription.cancelled, payment.succeeded, payment.failed
 */
export default {
  name: "billing",
  routes: billingRoutes,
  commands: {
    "billing:create-checkout-session": createCheckoutSession,
    "billing:cancel-subscription": cancelSubscription,
    "billing:change-subscription": changeSubscription,
    "billing:create-one-time-payment": createOneTimePayment,
    "billing:create-portal-session": createPortalSession,
    "billing:record-usage": recordUsage,
  },
  queries: {
    "billing:get-subscription-status": getSubscriptionStatus,
    "billing:get-billing-history": getBillingHistory,
  },
  jobs: {
    "billing:process-webhook": {
      queue: "billing:process-webhook",
      handler: processWebhook,
    },
    "billing:sync-usage": {
      queue: "billing:sync-usage",
      handler: syncUsage,
    },
    "email:send": {
      queue: "email:send",
      handler: sendEmail,
    },
  },
  events: [
    "subscription.created",
    "subscription.cancelled",
    "payment.succeeded",
    "payment.failed",
  ],
} satisfies ModuleDefinition;
