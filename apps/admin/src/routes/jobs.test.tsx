/// <reference types="vitest" />
/// <reference types="@testing-library/jest-dom" />

import { act, fireEvent, render, screen } from "@testing-library/react";
import type * as React from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Stub useTranslation BEFORE importing the component so it picks up the mock.
vi.mock("react-i18next", () => ({
  useTranslation: (ns: string) => ({
    t: (key: string) => `${ns}:${key}`,
  }),
}));

// Stub @baseworks/ui to avoid pulling the entire shadcn surface in unit tests.
vi.mock("@baseworks/ui", () => ({
  Card: ({ children, ...p }: any) => (
    <div data-testid="card" {...p}>
      {children}
    </div>
  ),
  CardContent: ({ children, ...p }: any) => <div {...p}>{children}</div>,
  Button: ({ children, onClick, ...p }: any) => (
    <button onClick={onClick} {...p}>
      {children}
    </button>
  ),
  Skeleton: (p: any) => <div data-testid="skeleton" {...p} />,
}));

vi.mock("lucide-react", () => ({
  AlertTriangle: (p: any) => <svg data-testid="alert-triangle-icon" {...p} />,
}));

let Component: React.ComponentType;
beforeEach(async () => {
  const mod = await import("./jobs");
  Component = mod.Component;
});

describe("/jobs route — iframe wrapper (OPS-02 / D-06)", () => {
  test("renders iframe with src=/admin/bull-board", () => {
    render(<Component />);
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe("/admin/bull-board");
  });

  test("iframe has translated title and sandbox attributes (D-06)", () => {
    render(<Component />);
    const iframe = document.querySelector("iframe")!;
    expect(iframe.getAttribute("title")).toBe("admin:jobs.iframeTitle");
    const sandbox = iframe.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).toContain("allow-same-origin");
  });

  test("page header uses i18n title key", () => {
    render(<Component />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("admin:jobs.title");
  });

  test("loading skeleton present on initial render", () => {
    render(<Component />);
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
  });

  test("iframe.onLoad hides the skeleton", () => {
    render(<Component />);
    const iframe = document.querySelector("iframe")!;
    fireEvent.load(iframe);
    expect(screen.queryByTestId("skeleton")).toBeNull();
  });

  test("iframe.onError reveals load-error card with retry button", () => {
    render(<Component />);
    const iframe = document.querySelector("iframe")!;
    // React 19's onError for iframes is attached directly (error events don't bubble),
    // so we wrap fireEvent.error in act() to flush the state update synchronously.
    act(() => {
      fireEvent.error(iframe);
    });
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByTestId("alert-triangle-icon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "admin:jobs.retry" })).toBeInTheDocument();
  });

  test("retry button reloads the iframe", () => {
    render(<Component />);
    const iframe = document.querySelector("iframe")!;
    act(() => {
      fireEvent.error(iframe);
    });
    const btn = screen.getByRole("button", { name: "admin:jobs.retry" });
    act(() => {
      fireEvent.click(btn);
    });
    expect(document.querySelector("iframe")).not.toBeNull();
  });
});
