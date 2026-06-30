// apps/admin/src/routes/webhooks/list.test.tsx
/// <reference types="vitest" />
/// <reference types="@testing-library/jest-dom" />
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type * as React from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: (ns: string) => ({ t: (k: string) => `${ns}:${k}` }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("./deliveries-dialog", () => ({ WebhookDeliveriesDialog: () => null }));

// Surface row count without the full table surface.
vi.mock("@/components/data-table", () => ({
  DataTable: ({ data }: any) => <div data-testid="rows">{data.length}</div>,
}));

// Minimal stubs for the shadcn components the page imports.
vi.mock("@baseworks/ui", () => {
  const Pass = ({ children, ...p }: any) => <div {...p}>{children}</div>;
  const Btn = ({ children, onClick, ...p }: any) => (
    <button onClick={onClick} {...p}>
      {children}
    </button>
  );
  return {
    Badge: Pass,
    Button: Btn,
    Card: Pass,
    CardContent: Pass,
    Dialog: ({ children, open }: any) => (open ? <div>{children}</div> : null),
    DialogContent: Pass,
    DialogDescription: Pass,
    DialogFooter: Pass,
    DialogHeader: Pass,
    DialogTitle: Pass,
    DropdownMenu: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuItem: Btn,
    DropdownMenuTrigger: Pass,
    Input: (p: any) => <input {...p} />,
    Label: Pass,
    Select: Pass,
    SelectContent: Pass,
    SelectItem: Pass,
    SelectTrigger: Pass,
    SelectValue: Pass,
  };
});

const getMock = vi.fn(async () => ({
  data: {
    data: [
      {
        id: "w1",
        tenantId: "t1",
        tenantName: "Tenant One",
        url: "https://a/b",
        categories: ["system"],
        status: "active",
        consecutiveFailures: "0",
        lastStatus: null,
        lastDeliveryAt: null,
        disabledReason: null,
        createdAt: "2026-01-01",
      },
      {
        id: "w2",
        tenantId: "t2",
        tenantName: "Tenant Two",
        url: "https://c/d",
        categories: ["billing"],
        status: "auto_disabled",
        consecutiveFailures: "15",
        lastStatus: "failed",
        lastDeliveryAt: null,
        disabledReason: "x",
        createdAt: "2026-01-01",
      },
    ],
    total: 2,
  },
  error: null,
}));
vi.mock("@/lib/api", () => ({
  api: { api: { admin: { webhooks: { get: (...a: any[]) => getMock(...a) } } } },
}));

let Component: React.ComponentType;
beforeEach(async () => {
  vi.clearAllMocks();
  Component = (await import("./list")).Component;
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("/webhooks admin oversight route", () => {
  test("renders heading and loads cross-tenant rows", async () => {
    wrap(<Component />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("admin:webhooks.title");
    await waitFor(() => expect(screen.getByTestId("rows").textContent).toBe("2"));
    expect(getMock).toHaveBeenCalled();
  });
});
