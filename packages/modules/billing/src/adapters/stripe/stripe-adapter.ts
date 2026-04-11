import Stripe from "stripe";
import type { PaymentProvider } from "../../ports/payment-provider";
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
} from "../../ports/types";
import { mapStripeEvent } from "./stripe-webhook-mapper";

/**
 * Stripe adapter implementing PaymentProvider (PAY-02).
 *
 * Wraps all Stripe SDK calls behind the provider-agnostic interface.
 * This is the only file (along with stripe-webhook-mapper.ts) that
 * imports the Stripe SDK directly. All other billing module files
 * interact with Stripe through this adapter via getPaymentProvider().
 *
 * Per D-09: Uses crypto.randomUUID() as idempotency key on mutation calls.
 * Per T-10-02: Webhook signature verification uses stripe.webhooks.constructEvent().
 * Per T-10-05: Secret keys are only held in the constructor, never logged.
 */
export class StripeAdapter implements PaymentProvider {
  readonly name = "stripe";
  private stripe: Stripe;
  private webhookSecret: string;

  constructor(config: { secretKey: string; webhookSecret: string }) {
    this.stripe = new Stripe(config.secretKey, { typescript: true });
    this.webhookSecret = config.webhookSecret;
  }

  async createCustomer(params: CreateCustomerParams): Promise<ProviderCustomer> {
    const customer = await this.stripe.customers.create(
      {
        metadata: { tenantId: params.tenantId },
        name: params.name ?? `Tenant ${params.tenantId}`,
      },
      { idempotencyKey: crypto.randomUUID() },
    );
    return { providerCustomerId: customer.id };
  }

  async createSubscription(params: CreateSubscriptionParams): Promise<ProviderSubscription> {
    const subscription = await this.stripe.subscriptions.create(
      {
        customer: params.providerCustomerId,
        items: [{ price: params.priceId }],
      },
      { idempotencyKey: crypto.randomUUID() },
    );
    return {
      providerSubscriptionId: subscription.id,
      status: subscription.status,
      priceId: subscription.items.data[0]?.price?.id,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    };
  }

  async cancelSubscription(params: CancelSubscriptionParams): Promise<void> {
    await this.stripe.subscriptions.update(
      params.providerSubscriptionId,
      { cancel_at_period_end: params.cancelAtPeriodEnd ?? true },
      { idempotencyKey: crypto.randomUUID() },
    );
  }

  async changeSubscription(params: ChangeSubscriptionParams): Promise<ProviderSubscription> {
    const sub = await this.stripe.subscriptions.retrieve(params.providerSubscriptionId);
    const updated = await this.stripe.subscriptions.update(
      params.providerSubscriptionId,
      {
        items: [{ id: sub.items.data[0].id, price: params.newPriceId }],
      },
      { idempotencyKey: crypto.randomUUID() },
    );
    return {
      providerSubscriptionId: updated.id,
      status: updated.status,
      priceId: updated.items.data[0]?.price?.id,
      currentPeriodEnd: new Date(updated.current_period_end * 1000),
    };
  }

  async getSubscription(providerSubscriptionId: string): Promise<ProviderSubscription | null> {
    try {
      const sub = await this.stripe.subscriptions.retrieve(providerSubscriptionId);
      return {
        providerSubscriptionId: sub.id,
        status: sub.status,
        priceId: sub.items.data[0]?.price?.id,
        currentPeriodEnd: new Date(sub.current_period_end * 1000),
      };
    } catch {
      return null;
    }
  }

  async createOneTimePayment(params: CreateOneTimePaymentParams): Promise<ProviderCheckoutSession> {
    const session = await this.stripe.checkout.sessions.create(
      {
        customer: params.providerCustomerId,
        mode: "payment",
        line_items: [{ price: params.priceId, quantity: params.quantity ?? 1 }],
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
      },
      { idempotencyKey: crypto.randomUUID() },
    );
    return { sessionId: session.id, url: session.url! };
  }

  async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<ProviderCheckoutSession> {
    const session = await this.stripe.checkout.sessions.create(
      {
        customer: params.providerCustomerId,
        mode: "subscription",
        line_items: [{ price: params.priceId, quantity: 1 }],
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
      },
      { idempotencyKey: crypto.randomUUID() },
    );
    return { sessionId: session.id, url: session.url! };
  }

  async createPortalSession(params: CreatePortalSessionParams): Promise<ProviderPortalSession | null> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: params.providerCustomerId,
      return_url: params.returnUrl,
    });
    return { url: session.url };
  }

  async verifyWebhookSignature(params: VerifyWebhookParams): Promise<RawProviderEvent> {
    const event = this.stripe.webhooks.constructEvent(
      params.rawBody,
      params.signature,
      this.webhookSecret,
    );
    return {
      id: event.id,
      type: event.type,
      data: event.data,
    };
  }

  normalizeEvent(rawEvent: RawProviderEvent): NormalizedEvent {
    return mapStripeEvent(rawEvent);
  }

  async getInvoices(providerCustomerId: string, limit: number): Promise<ProviderInvoice[]> {
    const invoiceList = await this.stripe.invoices.list({
      customer: providerCustomerId,
      limit,
    });
    return invoiceList.data.map((inv) => ({
      id: inv.id,
      amount: inv.amount_due,
      currency: inv.currency,
      status: inv.status,
      created: inv.created,
      invoiceUrl: inv.hosted_invoice_url ?? null,
      pdfUrl: inv.invoice_pdf ?? null,
    }));
  }

  async reportUsage(params: ReportUsageParams): Promise<ReportUsageResult> {
    // Retrieve subscription to get the subscription item ID
    const subscription = await this.stripe.subscriptions.retrieve(
      params.providerSubscriptionId,
    );

    if (!subscription.items.data.length) {
      throw new Error(
        `Subscription ${params.providerSubscriptionId} has no items`,
      );
    }

    const subscriptionItemId = subscription.items.data[0].id;
    const usageRecord = await this.stripe.subscriptionItems.createUsageRecord(
      subscriptionItemId,
      {
        quantity: params.quantity,
        timestamp: params.timestamp ?? Math.floor(Date.now() / 1000),
        action: "increment",
      },
      { idempotencyKey: crypto.randomUUID() },
    );

    return { providerUsageRecordId: usageRecord.id };
  }
}
