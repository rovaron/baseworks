/**
 * Billing module schema re-exports.
 *
 * Tables are defined in packages/db/src/schema/billing.ts (following the same
 * pattern as auth tables in packages/db/src/schema/auth.ts) to avoid circular
 * workspace dependencies. The billing module imports from @baseworks/db.
 */
export {
  billingCustomers,
  webhookEvents,
  usageRecords,
} from "@baseworks/db";
