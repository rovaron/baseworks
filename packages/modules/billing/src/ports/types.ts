/**
 * Shared types for the payment provider abstraction.
 *
 * These types define the contracts used by the PaymentProvider port interface
 * and are shared across all adapter implementations (Stripe, Pagar.me, etc.).
 */

// Normalized webhook event types (PAY-03 foundation)
export type NormalizedEventType =
  | "subscription.created"
  | "subscription.updated"
  | "subscription.cancelled"
  | "payment.succeeded"
  | "payment.failed"
  | "checkout.completed";

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

// Parameter types (derived from actual command signatures in codebase)
export interface CreateCustomerParams {
  tenantId: string;
  name?: string;
  metadata?: Record<string, string>;
}

export interface ProviderCustomer {
  providerCustomerId: string;
}

export interface CreateSubscriptionParams {
  providerCustomerId: string;
  priceId: string;
}

export interface ProviderSubscription {
  providerSubscriptionId: string;
  status: string;
  priceId?: string;
  currentPeriodEnd?: Date;
}

export interface CancelSubscriptionParams {
  providerSubscriptionId: string;
  cancelAtPeriodEnd?: boolean;
}

export interface ChangeSubscriptionParams {
  providerSubscriptionId: string;
  newPriceId: string;
}

export interface CreateOneTimePaymentParams {
  providerCustomerId: string;
  priceId: string;
  quantity?: number;
  successUrl: string;
  cancelUrl: string;
}

export interface CreateCheckoutSessionParams {
  providerCustomerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface ProviderCheckoutSession {
  sessionId: string;
  url: string;
}

export interface CreatePortalSessionParams {
  providerCustomerId: string;
  returnUrl: string;
}

export interface ProviderPortalSession {
  url: string;
}

export interface VerifyWebhookParams {
  rawBody: string;
  signature: string;
}

export interface RawProviderEvent {
  id: string;
  type: string;
  data: unknown;
}

export interface ProviderInvoice {
  id: string;
  amount: number;
  currency: string;
  status: string | null;
  created: number;
  invoiceUrl: string | null;
  pdfUrl: string | null;
}

export interface ReportUsageParams {
  providerSubscriptionId: string;
  quantity: number;
  timestamp?: number;
}

export interface ReportUsageResult {
  providerUsageRecordId: string;
}
