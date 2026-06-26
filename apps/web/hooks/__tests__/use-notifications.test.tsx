import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/notifications-api", () => ({
  fetchNotifications: vi.fn(async () => [
    {
      id: "1",
      type: "system.test",
      category: "system",
      severity: "info",
      title: "t",
      body: "b",
      readAt: null,
      createdAt: "2026-01-01",
    },
  ]),
  fetchUnreadCount: vi.fn(async () => 1),
  markNotificationRead: vi.fn(async () => {}),
  markAllNotificationsRead: vi.fn(async () => {}),
}));

import { useNotifications } from "../use-notifications";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useNotifications", () => {
  test("exposes list + unread count and a markRead mutation", async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.unreadCount).toBe(1));
    expect(result.current.notifications).toHaveLength(1);
    await act(async () => {
      await result.current.markRead("1");
    });
    const { markNotificationRead } = await import("@/lib/notifications-api");
    expect(markNotificationRead).toHaveBeenCalledWith("1");
  });
});
