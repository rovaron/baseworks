import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

const markRead = vi.fn(async () => {});
vi.mock("@/hooks/use-notifications", () => ({
  useNotifications: () => ({
    notifications: [
      {
        id: "1",
        type: "system.test",
        category: "system",
        severity: "info",
        title: "Hello",
        body: "World",
        url: "/dashboard",
        readAt: null,
        createdAt: "2026-01-01",
      },
    ],
    unreadCount: 1,
    isLoading: false,
    markRead,
    markAllRead: vi.fn(),
    invalidate: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-notification-stream", () => ({ useNotificationStream: () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next-intl", () => ({
  useTranslations: () => (k: string, v?: any) => (v?.count != null ? `${v.count} unread` : k),
}));

import { NotificationBell } from "../notification-bell";

describe("NotificationBell", () => {
  test("shows the unread badge", () => {
    render(<NotificationBell />);
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
