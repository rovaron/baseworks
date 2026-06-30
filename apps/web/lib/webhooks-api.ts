// apps/web/lib/webhooks-api.ts
import { api } from "@/lib/api";

export interface WebhookEndpoint {
  id: string;
  url: string;
  categories: string[] | null;
  description: string | null;
  status: "active" | "disabled" | "auto_disabled" | "admin_disabled";
  consecutiveFailures: string;
  lastDeliveryAt: string | null;
  lastStatus: string | null;
  disabledReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventType: string;
  category: string;
  status: string;
  httpStatus: string | null;
  attempts: string;
  lastError: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface CreateWebhookInput {
  url: string;
  categories: string[];
  description?: string;
}
export interface UpdateWebhookInput {
  url?: string;
  categories?: string[];
  description?: string;
  status?: "active" | "disabled";
}

// The notifications module mounts routes under /api/notifications; Eden envelope
// types aren't exposed, so use the same `any` accessor as lib/notifications-api.ts.
const w = () => (api.api as any).notifications.webhooks;

// Backend handlers return a { success, data } / { success, error } Result at HTTP 200.
function unwrap<T>(res: { data: any; error: any }): T {
  if (res.error)
    throw new Error(String(res.error?.value ?? res.error?.message ?? "Request failed"));
  const env = res.data;
  if (env && typeof env === "object" && "success" in env) {
    if (!env.success) throw new Error(env.error ?? "Request failed");
    return env.data as T;
  }
  return env as T;
}

export async function listWebhooks(): Promise<WebhookEndpoint[]> {
  return unwrap<WebhookEndpoint[]>(await w().get());
}

export async function createWebhook(
  input: CreateWebhookInput,
): Promise<WebhookEndpoint & { secret: string }> {
  return unwrap<WebhookEndpoint & { secret: string }>(await w().post(input));
}

export async function updateWebhook(
  id: string,
  input: UpdateWebhookInput,
): Promise<WebhookEndpoint> {
  return unwrap<WebhookEndpoint>(await w()({ id }).patch(input));
}

export async function deleteWebhook(id: string): Promise<void> {
  unwrap<{ id: string }>(await w()({ id }).delete());
}

export async function rotateWebhookSecret(id: string): Promise<{ id: string; secret: string }> {
  return unwrap<{ id: string; secret: string }>(await w()({ id })["rotate-secret"].post());
}

export async function listWebhookDeliveries(
  webhookId: string,
  opts: { status?: string; limit?: number; offset?: number } = {},
): Promise<WebhookDelivery[]> {
  const query: Record<string, string> = {};
  if (opts.status) query.status = opts.status;
  if (opts.limit != null) query.limit = String(opts.limit);
  if (opts.offset != null) query.offset = String(opts.offset);
  return unwrap<WebhookDelivery[]>(await w()({ id: webhookId }).deliveries.get({ query }));
}

export async function redeliverWebhook(deliveryId: string): Promise<{ deliveryId: string }> {
  return unwrap<{ deliveryId: string }>(await w().deliveries({ deliveryId }).redeliver.post());
}
