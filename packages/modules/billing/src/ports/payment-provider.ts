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
  /** Provider identifier (e.g., "stripe", "pagarme"). */
  readonly name: string;

  /**
   * Create a customer record in the payment provider.
   *
   * @param params - Tenant ID, optional name and metadata
   * @returns Provider customer with the external customer ID
   */
  createCustomer(params: CreateCustomerParams): Promise<ProviderCustomer>;

  /**
   * Create a new subscription for a customer.
   *
   * @param params - Provider customer ID and price/plan ID
   * @returns Subscription details including status and period
   */
  createSubscription(
    params: CreateSubscriptionParams,
  ): Promise<ProviderSubscription>;

  /**
   * Cancel an existing subscription.
   *
   * @param params - Subscription ID and whether to cancel at
   *   period end or immediately
   */
  cancelSubscription(params: CancelSubscriptionParams): Promise<void>;

  /**
   * Change a subscription to a different plan/price.
   *
   * @param params - Subscription ID and target price ID
   * @returns Updated subscription details after the change
   */
  changeSubscription(
    params: ChangeSubscriptionParams,
  ): Promise<ProviderSubscription>;

  /**
   * Retrieve a subscription by its provider-side ID.
   *
   * @param providerSubscriptionId - External subscription ID
   * @returns Subscription details, or null if not found
   */
  getSubscription(
    providerSubscriptionId: string,
  ): Promise<ProviderSubscription | null>;

  /**
   * Create a checkout session for a one-time payment.
   *
   * @param params - Customer ID, price, quantity, and redirect
   *   URLs
   * @returns Checkout session with redirect URL
   */
  createOneTimePayment(
    params: CreateOneTimePaymentParams,
  ): Promise<ProviderCheckoutSession>;

  /**
   * Create a checkout session for subscription signup.
   *
   * @param params - Customer ID, price ID, and redirect URLs
   * @returns Checkout session with redirect URL
   */
  createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<ProviderCheckoutSession>;

  /**
   * Create a customer portal session for self-service billing.
   *
   * @param params - Customer ID and return URL
   * @returns Portal session with URL, or null if the provider
   *   does not support hosted portals
   */
  createPortalSession(
    params: CreatePortalSessionParams,
  ): Promise<ProviderPortalSession | null>;

  /**
   * Verify a webhook signature and extract the raw event.
   *
   * @param params - Raw request body and signature header
   * @returns Verified raw provider event
   */
  verifyWebhookSignature(
    params: VerifyWebhookParams,
  ): Promise<RawProviderEvent>;

  /**
   * Normalize a raw provider event into a domain event.
   *
   * @param rawEvent - Verified raw event from the provider
   * @returns Normalized billing domain event
   */
  normalizeEvent(rawEvent: RawProviderEvent): NormalizedEvent;

  /**
   * Retrieve invoice history for a customer.
   *
   * @param providerCustomerId - External customer ID
   * @param limit - Maximum number of invoices to return
   * @returns List of invoice records
   */
  getInvoices(
    providerCustomerId: string,
    limit: number,
  ): Promise<ProviderInvoice[]>;

  /**
   * Report metered usage for a subscription item.
   *
   * Optional -- not all providers support usage-based billing.
   *
   * @param params - Subscription ID, quantity, and timestamp
   * @returns Usage record ID from the provider
   */
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
