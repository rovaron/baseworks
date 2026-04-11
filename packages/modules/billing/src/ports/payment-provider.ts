/**
 * PaymentProvider port interface (PAY-01).
 *
 * Defines the contract that all payment provider adapters must implement.
 * This is the core abstraction enabling provider-agnostic billing:
 * - StripeAdapter implements this for Stripe
 * - PagarmeAdapter implements this for Pagar.me
 *
 * Design decisions:
 * - `createPortalSession` returns `ProviderPortalSession | null` because
 *   not all providers offer a hosted billing portal (e.g., Pagar.me).
 * - `reportUsage` is optional (`?`) since not all providers support
 *   usage-based billing metering.
 * - `normalizeEvent` lives on the provider itself since each adapter
 *   knows its own webhook event format.
 */

import type {
  CreateCustomerParams,
  ProviderCustomer,
  CreateSubscriptionParams,
  ProviderSubscription,
  CancelSubscriptionParams,
  ChangeSubscriptionParams,
  CreateOneTimePaymentParams,
  ProviderCheckoutSession,
  CreateCheckoutSessionParams,
  CreatePortalSessionParams,
  ProviderPortalSession,
  VerifyWebhookParams,
  RawProviderEvent,
  NormalizedEvent,
  ProviderInvoice,
  ReportUsageParams,
  ReportUsageResult,
} from "./types";

export interface PaymentProvider {
  readonly name: string;

  // Customer management
  createCustomer(params: CreateCustomerParams): Promise<ProviderCustomer>;

  // Subscriptions
  createSubscription(
    params: CreateSubscriptionParams,
  ): Promise<ProviderSubscription>;
  cancelSubscription(params: CancelSubscriptionParams): Promise<void>;
  changeSubscription(
    params: ChangeSubscriptionParams,
  ): Promise<ProviderSubscription>;
  getSubscription(
    providerSubscriptionId: string,
  ): Promise<ProviderSubscription | null>;

  // One-time payments
  createOneTimePayment(
    params: CreateOneTimePaymentParams,
  ): Promise<ProviderCheckoutSession>;

  // Checkout & portal sessions
  createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<ProviderCheckoutSession>;
  createPortalSession(
    params: CreatePortalSessionParams,
  ): Promise<ProviderPortalSession | null>;

  // Webhooks
  verifyWebhookSignature(
    params: VerifyWebhookParams,
  ): Promise<RawProviderEvent>;
  normalizeEvent(rawEvent: RawProviderEvent): NormalizedEvent;

  // Invoices / billing history
  getInvoices(
    providerCustomerId: string,
    limit: number,
  ): Promise<ProviderInvoice[]>;

  // Usage-based billing (optional -- not all providers support this)
  reportUsage?(params: ReportUsageParams): Promise<ReportUsageResult>;
}

// Re-export types for convenience
export type {
  CreateCustomerParams,
  ProviderCustomer,
  CreateSubscriptionParams,
  ProviderSubscription,
  CancelSubscriptionParams,
  ChangeSubscriptionParams,
  CreateOneTimePaymentParams,
  ProviderCheckoutSession,
  CreateCheckoutSessionParams,
  CreatePortalSessionParams,
  ProviderPortalSession,
  VerifyWebhookParams,
  RawProviderEvent,
  NormalizedEvent,
  ProviderInvoice,
  ReportUsageParams,
  ReportUsageResult,
} from "./types";
