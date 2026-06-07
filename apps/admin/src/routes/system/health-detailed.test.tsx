/// <reference types="vitest" />
/// <reference types="@testing-library/jest-dom" />

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: (ns: string) => ({
    t: (key: string, opts?: any) => {
      if (opts?.count !== undefined) return `${ns}:${key}(${opts.count})`;
      if (opts?.time !== undefined) return `${ns}:${key}(${opts.time})`;
      return `${ns}:${key}`;
    },
  }),
}));

vi.mock("@baseworks/ui", () => ({
  Card: ({ children, ...p }: any) => (
    <div data-testid="card" {...p}>
      {children}
    </div>
  ),
  CardHeader: ({ children, ...p }: any) => <div {...p}>{children}</div>,
  CardTitle: ({ children, ...p }: any) => <div {...p}>{children}</div>,
  CardContent: ({ children, ...p }: any) => <div {...p}>{children}</div>,
  Badge: ({ children, variant, ...p }: any) => (
    <span data-variant={variant} {...p}>
      {children}
    </span>
  ),
  Button: ({ children, onClick, ...p }: any) => (
    <button onClick={onClick} {...p}>
      {children}
    </button>
  ),
  Skeleton: (p: any) => <div data-testid="skeleton" {...p} />,
  cn: (...a: any[]) => a.filter(Boolean).join(" "),
}));

vi.mock("lucide-react", () => ({
  RefreshCw: (p: any) => <svg data-testid="refresh-icon" {...p} />,
  Layers: (p: any) => <svg {...p} />,
  Cpu: (p: any) => <svg {...p} />,
  Database: (p: any) => <svg {...p} />,
  AlertTriangle: (p: any) => <svg data-testid="alert-icon" {...p} />,
  Boxes: (p: any) => <svg {...p} />,
}));

vi.mock("date-fns", () => ({
  formatDistanceToNow: () => "12 seconds ago",
  formatDuration: () => "1 hour",
  intervalToDuration: () => ({}),
}));

function makeEnvelope(over: Partial<any> = {}) {
  return {
    data: {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: 3600,
      queues: [
        {
          name: "email-send",
          waiting: 5,
          active: 0,
          delayed: 0,
          completed: 100,
          failed: 0,
          status: "healthy",
          thresholds: { warn: 100, critical: 1000 },
        },
        {
          name: "billing-sync",
          waiting: 150,
          active: 1,
          delayed: 0,
          completed: 50,
          failed: 2,
          status: "warning",
          thresholds: { warn: 100, critical: 1000 },
        },
      ],
      workers: [
        {
          instanceId: "host-a",
          queues: ["email-send"],
          lastHeartbeat: new Date().toISOString(),
          ageSec: 5,
          status: "healthy",
        },
      ],
      db: { connected: true, lagMs: 23, status: "healthy" },
      recentErrors: [],
      modules: [
        { name: "auth", loaded: true, status: "healthy" },
        { name: "billing", loaded: true, status: "healthy" },
      ],
      ...over,
    },
  };
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

let Component: React.ComponentType;
beforeEach(async () => {
  const mod = await import("./health");
  Component = mod.Component;
  // Stub global fetch per test (override per test for failure cases).
  (globalThis as any).fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => makeEnvelope(),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/system route — /health/detailed consumer (OPS-03)", () => {
  test("renders title heading", async () => {
    renderWithClient(<Component />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "admin:systemHealth.title",
      ),
    );
  });

  test("loading skeleton shown initially", () => {
    renderWithClient(<Component />);
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  test("renders 2 queue cards from envelope", async () => {
    renderWithClient(<Component />);
    await waitFor(() => expect(screen.getAllByTestId("queue-card").length).toBe(2));
  });

  test('queue with waiting=150 shows status "warning"', async () => {
    renderWithClient(<Component />);
    await waitFor(() => {
      const cards = screen.getAllByTestId("queue-card");
      const billing = cards.find((c) => c.textContent?.includes("billing-sync"));
      expect(billing?.textContent).toContain("warning");
    });
  });

  test("worker card with healthy status renders status badge", async () => {
    renderWithClient(<Component />);
    await waitFor(() => {
      const w = screen.getByTestId("worker-card");
      expect(w.textContent).toContain("host-a");
      expect(w.textContent).toContain("admin:systemHealth.workers.status.healthy");
    });
  });

  test("workers empty state shows empty copy", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => makeEnvelope({ workers: [] }),
    }));
    renderWithClient(<Component />);
    await waitFor(() =>
      expect(screen.queryByText("admin:systemHealth.workers.empty")).toBeInTheDocument(),
    );
  });

  test("db section renders lagMs value", async () => {
    renderWithClient(<Component />);
    await waitFor(() => {
      const db = screen.getByTestId("db-card");
      expect(db.textContent).toContain("23 ms");
    });
  });

  test("db section with lagMs=null shows lagUnavailable", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () =>
        makeEnvelope({ db: { connected: false, lagMs: null, status: "unhealthy" } }),
    }));
    renderWithClient(<Component />);
    await waitFor(() =>
      expect(screen.getByTestId("db-card").textContent).toContain(
        "admin:systemHealth.db.lagUnavailable",
      ),
    );
  });

  test("recentErrors empty shows empty copy", async () => {
    renderWithClient(<Component />);
    await waitFor(() =>
      expect(screen.getByTestId("errors-card").textContent).toContain(
        "admin:systemHealth.recentErrors.empty",
      ),
    );
  });

  test("recentErrors with 2 entries renders 2 list items + dedup count", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () =>
        makeEnvelope({
          recentErrors: [
            { timestamp: new Date().toISOString(), message: "Boom", source: "cqrs", count: 3 },
            { timestamp: new Date().toISOString(), message: "Splat", source: "http", count: 1 },
          ],
        }),
    }));
    renderWithClient(<Component />);
    await waitFor(() => {
      const errs = screen.getByTestId("errors-card");
      expect(errs.textContent).toContain("Boom");
      expect(errs.textContent).toContain("Splat");
      expect(errs.textContent).toContain("admin:systemHealth.recentErrors.occurrences(3)");
    });
  });

  test("modules section renders 2 module cards", async () => {
    renderWithClient(<Component />);
    await waitFor(() => expect(screen.getAllByTestId("module-card").length).toBe(2));
  });

  test("fetch failure → page-level error card with retry button", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    renderWithClient(<Component />);
    await waitFor(() => expect(screen.getByTestId("alert-icon")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "common:retry" })).toBeInTheDocument();
  });

  test("403 fetch shows forbidden copy WITHOUT retry button", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
    }));
    renderWithClient(<Component />);
    await waitFor(() =>
      expect(screen.queryByText("admin:systemHealth.errors.forbidden")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "common:retry" })).toBeNull();
  });
});
