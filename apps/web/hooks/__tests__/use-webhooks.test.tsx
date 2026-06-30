// apps/web/hooks/__tests__/use-webhooks.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/webhooks-api", () => ({
  listWebhooks: vi.fn(async () => [
    {
      id: "w1",
      url: "https://x/y",
      categories: ["system"],
      description: null,
      status: "active",
      consecutiveFailures: "0",
      lastDeliveryAt: null,
      lastStatus: null,
      disabledReason: null,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    },
  ]),
  createWebhook: vi.fn(async () => ({ id: "w2", secret: "whsec_x" })),
  updateWebhook: vi.fn(async () => ({ id: "w1" })),
  deleteWebhook: vi.fn(async () => {}),
  rotateWebhookSecret: vi.fn(async () => ({ id: "w1", secret: "whsec_new" })),
}));

vi.mock("@/components/tenant-provider", () => ({
  useTenant: () => ({ activeTenant: { id: "t1", name: "T", slug: "t" }, activeRole: "owner" }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));

import { useWebhooks } from "../use-webhooks";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useWebhooks", () => {
  test("loads the list and exposes mutations", async () => {
    const { result } = renderHook(() => useWebhooks(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.webhooks).toHaveLength(1));
    expect(result.current.webhooks[0].url).toBe("https://x/y");

    let created: { secret: string } | undefined;
    await act(async () => {
      created = await result.current.create({ url: "https://a/b", categories: ["system"] });
    });
    expect(created?.secret).toBe("whsec_x");

    const { createWebhook } = await import("@/lib/webhooks-api");
    expect(createWebhook).toHaveBeenCalled();
  });
});
