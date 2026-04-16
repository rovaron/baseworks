/**
 * Shared types for the payment provider abstraction.
 *
 * These types define the contracts used by the PaymentProvider port interface
 * and are shared across all adapter implementations (Stripe, Pagar.me, etc.).
 */

/**
 * Union of normalized webhook event types shared across all
 * payment provider adapters.
 */
export type NormalizedEventType =
  | "subscription.created"
  | "subscription.updated"
  | "subscription.cancelled"
  | "payment.succeeded"
  | "payment.failed"
  | "checkout.completed";

/**
 * Provider-agnostic billing domain event produced by normalizing
 * a raw provider webhook. Contains the event type, customer
 * reference, domain-relevant data, and the original raw payload
 * for debugging.
 */
export interface NormalizedEvent {
  type: NormalizedEventType;
  providerEventId: string;
  providerCustomerId: string;
  data: {
    subscriptionId?: string;
    priceId?: string;
    status?: string;
    currentPeriodEnd?: Date;
    amount?: number;
    currency?: string;
  };
  occurredAt: Date;
  raw: unknown;
}

/**
 * Input for creating a customer record in the payment provider.
 * Contains the internal tenant ID and optional display metadata.
 */
export interface CreateCustomerParams {
  tenantId: string;
  name?: string;
  metadata?: Record<string, string>;
}

/**
 * Result of creating a customer in the payment provider.
 * Contains the provider-side customer identifier used for all
 * subsequent billing operations.
 */
export interface ProviderCustomer {
  providerCustomerId: string;
}

/**
 * Input for creating a subscription. References the provider
 * customer and the target price/plan.
 */
export interface CreateSubscriptionParams {
  providerCustomerId: string;
  priceId: string;
}

/**
 * Subscription state returned by the payment provider. Contains
 * the provider-side subscription ID, lifecycle status, active
 * price, and current billing period end date.
 */
export interface ProviderSubscription {
  providerSubscriptionId: string;
  status: string;
  priceId?: string;
  currentPeriodEnd?: Date;
}

/**
 * Input for cancelling a subscription. Supports both immediate
 * cancellation and cancel-at-period-end semantics.
 */
export interface CancelSubscriptionParams {
  providerSubscriptionId: string;
  cancelAtPeriodEnd?: boolean;
}

/**
 * Input for changing a subscription to a different plan/price.
 * Proration behavior is determined by the provider adapter.
 */
export interface ChangeSubscriptionParams {
  providerSubscriptionId: string;
  newPriceId: string;
}

/**
 * Input for creating a one-time payment checkout session.
 * Contains pricing, quantity, and redirect URLs for the
 * provider-hosted checkout page.
 */
export interface CreateOneTimePaymentParams {
  providerCustomerId: string;
  priceId: string;
  quantity?: number;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Input for creating a subscription checkout session. Contains
 * the customer reference, target price, and redirect URLs.
 */
export interface CreateCheckoutSessionParams {
  providerCustomerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Result of creating a checkout session. Contains the session
 * identifier and the redirect URL for the provider-hosted page.
 */
export interface ProviderCheckoutSession {
  sessionId: string;
  url: string;
}

/**
 * Input for creating a customer billing portal session.
 * Contains the customer reference and the URL to redirect to
 * after the portal session ends.
 */
export interface CreatePortalSessionParams {
  providerCustomerId: string;
  returnUrl: string;
}

/**
 * Result of creating a billing portal session. Contains the
 * redirect URL for the provider-hosted portal.
 */
export interface ProviderPortalSession {
  url: string;
}

/**
 * Input for verifying a webhook signature. Contains the raw
 * request body and the provider-specific signature header value.
 */
export interface VerifyWebhookParams {
  rawBody: string;
  signature: string;
}

/**
 * Raw event extracted from a verified webhook payload. Contains
 * the provider-side event ID, event type string, and untyped
 * event data for normalization.
 */
export interface RawProviderEvent {
  id: string;
  type: string;
  data: unknown;
}

/**
 * Invoice record from the payment provider. Contains amount,
 * currency, payment status, creation timestamp, and optional
 * URLs for viewing or downloading the invoice PDF.
 */
export interface ProviderInvoice {
  id: string;
  amount: number;
  currency: string;
  status: string | null;
  created: number;
  invoiceUrl: string | null;
  pdfUrl: string | null;
}

/**
 * Input for reporting metered usage to the payment provider.
 * Contains the subscription reference, usage quantity, and
 * optional timestamp for backdated reporting.
 */
export interface ReportUsageParams {
  providerSubscriptionId: string;
  quantity: number;
  timestamp?: number;
}

/**
 * Result of reporting usage to the payment provider. Contains
 * the provider-side usage record identifier for tracking.
 */
export interface ReportUsageResult {
  providerUsageRecordId: string;
}
