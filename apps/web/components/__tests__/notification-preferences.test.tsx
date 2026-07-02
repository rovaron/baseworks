import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

const setEmail = vi.fn(async () => {});
vi.mock("@/hooks/use-notification-preferences", () => ({
  useNotificationPreferences: () => ({
    preferences: [
      { category: "billing", label: "Billing", email: true, mutable: true },
      { category: "security", label: "Security", email: true, mutable: false },
    ],
    isLoading: false,
    isError: false,
    setEmail,
  }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));

import { NotificationPreferences } from "../notification-preferences";

describe("NotificationPreferences", () => {
  test("locks the non-mutable category switch", () => {
    render(<NotificationPreferences />);
    const switches = screen.getAllByRole("switch");
    expect(switches[0]).not.toBeDisabled(); // billing
    expect(switches[1]).toBeDisabled(); // security
  });

  test("toggling a mutable category calls setEmail(category, false)", () => {
    render(<NotificationPreferences />);
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(setEmail).toHaveBeenCalledWith("billing", false);
  });
});
