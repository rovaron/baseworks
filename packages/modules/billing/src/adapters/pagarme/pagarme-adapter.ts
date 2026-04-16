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
} from "../../ports/types";
import { mapPagarmeEvent } from "./pagarme-webhook-mapper";

/**
 * Pagar.me adapter implementing PaymentProvider (PAY-04).
 *
 * Uses Pagar.me REST API v5 via raw fetch calls for full type safety.
 * The @pagarme/sdk package is a JS-only library without TypeScript types,
 * so raw HTTP is cleaner and avoids untyped SDK surface area.
 *
 * Per T-10-07: Webhook verification uses HMAC-SHA256 with crypto.timingSafeEqual.
 * Per T-10-08: Secret key is only held in the constructor config, never logged.
 *
 * Key differences from Stripe:
 * - createPortalSession returns null (Pagar.me has no hosted billing portal)
 * - reportUsage is not implemented (optional on interface, Pagar.me has no equivalent)
 * - Currency is BRL by default
 * - Authentication uses Basic Auth with secretKey
 */
export class PagarmeAdapter implements PaymentProvider {
  readonly name = "pagarme";
  private config: { secretKey: string; webhookSecret: string };

  constructor(config: { secretKey: string; webhookSecret: string }) {
    this.config = config;
  }

  /**
   * Make an authenticated request to the Pagar.me REST API v5.
   */
  private async request<T = any>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`https://api.pagar.me/core/v5${path}`, {
      method,
      headers: {
        Authorization: `Basic ${btoa(this.config.secretKey + ":")}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Pagar.me API error: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ""}`,
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Create a customer in Pagar.me with tenant metadata.
   *
   * @param params - Tenant ID, optional name and metadata
   * @returns Provider customer with the Pagar.me customer ID
   */
  async createCustomer(params: CreateCustomerParams): Promise<ProviderCustomer> {
    const customer = await this.request("POST", "/customers", {
      name: params.name ?? `Tenant ${params.tenantId}`,
      email: `tenant-${params.tenantId}@placeholder.local`,
      metadata: { tenantId: params.tenantId, ...params.metadata },
    });
    return { providerCustomerId: customer.id };
  }

  /**
   * Create a subscription in Pagar.me using credit card payment.
   *
   * @param params - Provider customer ID and plan ID
   * @returns Subscription details with status and period
   */
  async createSubscription(
    params: CreateSubscriptionParams,
  ): Promise<ProviderSubscription> {
    const subscription = await this.request("POST", "/subscriptions", {
      customer_id: params.providerCustomerId,
      plan_id: params.priceId,
      payment_method: "credit_card",
    });
    return {
      providerSubscriptionId: subscription.id,
      status: subscription.status,
      priceId: subscription.plan?.id,
      currentPeriodEnd: subscription.current_period_end
        ? new Date(subscription.current_period_end)
        : undefined,
    };
  }

  /**
   * Cancel a Pagar.me subscription. Pagar.me does not support
   * cancel-at-period-end; cancellation is always immediate.
   *
   * @param params - Subscription ID and cancellation timing
   */
  async cancelSubscription(params: CancelSubscriptionParams): Promise<void> {
    if (params.cancelAtPeriodEnd) {
      // WR-02: Pagar.me has no native "cancel at period end" -- this request
      // cancels the subscription immediately. Log a warning so callers who
      // relied on deferred cancellation can detect the behavioral difference.
      console.warn(
        "[PagarmeAdapter] cancelAtPeriodEnd is not supported; subscription will be canceled immediately",
      );
    }
    await this.request(
      "DELETE",
      `/subscriptions/${params.providerSubscriptionId}`,
    );
  }

  /**
   * Change a Pagar.me subscription to a different plan.
   *
   * @param params - Subscription ID and target plan ID
   * @returns Updated subscription details
   */
  async changeSubscription(
    params: ChangeSubscriptionParams,
  ): Promise<ProviderSubscription> {
    const updated = await this.request(
      "PATCH",
      `/subscriptions/${params.providerSubscriptionId}`,
      {
        plan_id: params.newPriceId,
      },
    );
    return {
      providerSubscriptionId: updated.id,
      status: updated.status,
      priceId: updated.plan?.id,
      currentPeriodEnd: updated.current_period_end
        ? new Date(updated.current_period_end)
        : undefined,
    };
  }

  /**
   * Retrieve a Pagar.me subscription by ID.
   *
   * @param providerSubscriptionId - Pagar.me subscription ID
   * @returns Subscription details, or null if not found
   */
  async getSubscription(
    providerSubscriptionId: string,
  ): Promise<ProviderSubscription | null> {
    try {
      const sub = await this.request(
        "GET",
        `/subscriptions/${providerSubscriptionId}`,
      );
      return {
        providerSubscriptionId: sub.id,
        status: sub.status,
        priceId: sub.plan?.id,
        currentPeriodEnd: sub.current_period_end
          ? new Date(sub.current_period_end)
          : undefined,
      };
    } catch {
      return null;
    }
  }

  /**
   * Create a one-time payment via Pagar.me.
   *
   * Not yet implemented -- throws an error because Pagar.me
   * requires explicit amount resolution that is not yet wired.
   *
   * @param _params - Payment parameters (unused)
   * @throws Error always -- amount resolution not implemented
   */
  async createOneTimePayment(
    _params: CreateOneTimePaymentParams,
  ): Promise<ProviderCheckoutSession> {
    // WR-01: A zero-amount order is dangerous -- fail loudly until price
    // resolution (via a Pagar.me plan lookup or an amount field on params)
    // is implemented.
    throw new Error(
      "Pagar.me adapter: amount resolution not yet implemented for one-time payments",
    );
  }

  /**
   * Create a checkout session via Pagar.me.
   *
   * Not yet implemented -- Pagar.me has no hosted checkout page
   * and amount resolution is not yet wired.
   *
   * @param _params - Checkout parameters (unused)
   * @throws Error always -- amount resolution not implemented
   */
  async createCheckoutSession(
    _params: CreateCheckoutSessionParams,
  ): Promise<ProviderCheckoutSession> {
    // WR-01: Same as createOneTimePayment -- Pagar.me has no hosted checkout
    // and the previous placeholder silently created zero-amount orders.
    // Fail loudly until a real price-resolution path is added.
    throw new Error(
      "Pagar.me adapter: amount resolution not yet implemented for checkout sessions",
    );
  }

  /**
   * Pagar.me has no customer portal equivalent.
   * Returns null per the PaymentProvider interface contract.
   * The frontend should show a "contact support" message instead.
   */
  async createPortalSession(
    _params: CreatePortalSessionParams,
  ): Promise<ProviderPortalSession | null> {
    return null;
  }

  /**
   * Verify Pagar.me webhook signature using HMAC-SHA256.
   *
   * Per T-10-07: Uses node:crypto timingSafeEqual to prevent timing attacks.
   * NEVER use simple string comparison for signature verification.
   */
  async verifyWebhookSignature(
    params: VerifyWebhookParams,
  ): Promise<RawProviderEvent> {
    const { timingSafeEqual } = await import("node:crypto");
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(this.config.webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const signatureBytes = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(params.rawBody),
    );

    const expectedSignature = Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Use node:crypto timingSafeEqual for constant-time comparison.
    // Length check first because timingSafeEqual requires equal-length buffers.
    const expectedBuf = Buffer.from(expectedSignature);
    const receivedBuf = Buffer.from(params.signature);
    if (
      expectedBuf.length !== receivedBuf.length ||
      !timingSafeEqual(expectedBuf, receivedBuf)
    ) {
      throw new Error("Invalid Pagar.me webhook signature");
    }

    const event = JSON.parse(params.rawBody);
    return {
      id: event.id ?? event.data?.id ?? crypto.randomUUID(),
      type: event.type,
      data: event.data,
    };
  }

  /**
   * Normalize a raw Pagar.me event into a domain event.
   * Delegates to mapPagarmeEvent for the actual mapping.
   *
   * @param rawEvent - Verified raw Pagar.me event
   * @returns Normalized billing domain event
   */
  normalizeEvent(rawEvent: RawProviderEvent): NormalizedEvent {
    return mapPagarmeEvent(rawEvent);
  }

  /**
   * Retrieve charge history from Pagar.me for a customer.
   * Maps Pagar.me charges to the ProviderInvoice interface.
   *
   * @param providerCustomerId - Pagar.me customer ID
   * @param limit - Maximum number of charges to return
   * @returns List of invoice-like charge records
   */
  async getInvoices(
    providerCustomerId: string,
    limit: number,
  ): Promise<ProviderInvoice[]> {
    const charges = await this.request(
      "GET",
      `/charges?customer_id=${providerCustomerId}&size=${limit}`,
    );

    const chargeList = Array.isArray(charges?.data) ? charges.data : [];
    return chargeList.map((charge: any) => ({
      id: charge.id,
      amount: charge.amount ?? 0,
      currency: charge.currency ?? "BRL",
      status: charge.status ?? null,
      created: charge.created_at
        ? Math.floor(new Date(charge.created_at).getTime() / 1000)
        : 0,
      invoiceUrl: charge.url ?? null,
      pdfUrl: null, // Pagar.me does not provide PDF invoices
    }));
  }

  // reportUsage is not implemented -- method is optional on PaymentProvider interface
  // Pagar.me does not have a usage-based billing metering equivalent
}
