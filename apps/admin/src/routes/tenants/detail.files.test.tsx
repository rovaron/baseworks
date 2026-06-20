/// <reference types="vitest" />
/// <reference types="@testing-library/jest-dom" />

// Phase 30 / UI-02 — apps/admin tenant-files browser tests. Mirrors the
// jobs.test.tsx / health-detailed.test.tsx pattern: stub react-i18next +
// @baseworks/ui so no shadcn/tailwind transform is needed, and mock the
// admin file-upload adapters so the component never touches the live API.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Interpolating t so {name}/{count} placeholders resolve to checkable strings.
vi.mock("react-i18next", () => ({
  useTranslation: (_ns: string) => ({
    // Mock can't resolve a key to its template, so it appends interpolated
    // option values to the key (e.g. "...view:logo.png", "...variants:1").
    t: (key: string, opts?: Record<string, unknown>) => {
      if (!opts) return key;
      const vals = Object.entries(opts)
        .filter(([k]) => k !== "defaultValue")
        .map(([, v]) => String(v));
      return vals.length ? `${key}:${vals.join(",")}` : key;
    },
  }),
}));

// Stub @baseworks/ui — Table primitives map to semantic HTML so getByRole works;
// Dialog renders children only when open; FileUpload is a labelled placeholder.
vi.mock("@baseworks/ui", () => ({
  Card: ({ children, ...p }: any) => <div {...p}>{children}</div>,
  CardHeader: ({ children, ...p }: any) => <div {...p}>{children}</div>,
  CardTitle: ({ children, ...p }: any) => <div {...p}>{children}</div>,
  CardContent: ({ children, ...p }: any) => <div {...p}>{children}</div>,
  Badge: ({ children, variant, ...p }: any) => (
    <span data-variant={variant} {...p}>
      {children}
    </span>
  ),
  Button: ({ children, onClick, ...p }: any) => (
    <button type="button" onClick={onClick} {...p}>
      {children}
    </button>
  ),
  Skeleton: (p: any) => <div data-testid="skeleton" {...p} />,
  Table: ({ children, ...p }: any) => <table {...p}>{children}</table>,
  TableHeader: ({ children, ...p }: any) => <thead {...p}>{children}</thead>,
  TableBody: ({ children, ...p }: any) => <tbody {...p}>{children}</tbody>,
  TableRow: ({ children, ...p }: any) => <tr {...p}>{children}</tr>,
  TableHead: ({ children, ...p }: any) => <th {...p}>{children}</th>,
  TableCell: ({ children, ...p }: any) => <td {...p}>{children}</td>,
  Dialog: ({ children, open }: any) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children, ...p }: any) => <div {...p}>{children}</div>,
  DialogHeader: ({ children, ...p }: any) => <div {...p}>{children}</div>,
  DialogTitle: ({ children, ...p }: any) => <h2 {...p}>{children}</h2>,
  DialogDescription: ({ children, ...p }: any) => <p {...p}>{children}</p>,
  DialogFooter: ({ children, ...p }: any) => <div {...p}>{children}</div>,
  FileUpload: (p: any) => (
    // biome-ignore lint/a11y/useSemanticElements: test stub mirrors the real FileUpload's labelled group role
    <div data-testid="file-upload" role="group" aria-label={p["aria-label"]} />
  ),
}));

vi.mock("lucide-react", () => ({
  ArrowLeft: (p: any) => <svg {...p} />,
  Eye: (p: any) => <svg data-testid="eye-icon" {...p} />,
  Trash2: (p: any) => <svg data-testid="trash-icon" {...p} />,
}));

vi.mock("date-fns", () => ({
  formatDistanceToNow: () => "2 hours ago",
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Mock the adapters so the component never hits the eden client / live API.
const adminListFiles = vi.fn();
const adminDeleteFile = vi.fn(async (_tenantId: string, _fileId: string) => undefined);
const adminGetReadUrl = vi.fn(
  async (_tenantId: string, _fileId: string) => "https://signed.example/read",
);
vi.mock("@/lib/file-upload-adapters", () => ({
  adminListFiles: (tenantId: string) => adminListFiles(tenantId),
  adminDeleteFile: (tenantId: string, fileId: string) => adminDeleteFile(tenantId, fileId),
  adminGetReadUrl: (tenantId: string, fileId: string) => adminGetReadUrl(tenantId, fileId),
  makeAdminSign: () => vi.fn(),
  makeAdminComplete: () => vi.fn(),
  buildFileUploadLabels: () => ({}),
  ADMIN_ACCEPT: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  ADMIN_MAX_BYTES: 10 * 1024 * 1024,
}));

function makeFile(over: Record<string, unknown> = {}) {
  return {
    fileId: "f1",
    ownerModule: "files",
    ownerRecordType: "tenant",
    ownerRecordId: "t1",
    mimeType: "image/png",
    byteSize: 2048,
    status: "ready",
    originalFilename: "logo.png",
    transforms: [{ name: "thumb-256" }],
    variantCount: 1,
    createdAt: new Date().toISOString(),
    uploadedByUserId: null,
    ...over,
  };
}

// Imported AFTER the vi.mock calls above (vi.mock is hoisted, so the i18next /
// @baseworks/ui / adapter stubs are installed before this module evaluates).
import { TenantFilesCard } from "./detail";

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TenantFilesCard tenantId="t1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  adminListFiles.mockReset();
  adminDeleteFile.mockClear();
  adminGetReadUrl.mockClear();
  (window.open as any) = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TenantFilesCard — admin tenant files browser (UI-02)", () => {
  test("uploader renders accessibly with an aria-label", async () => {
    adminListFiles.mockResolvedValue({ files: [], total: 0 });
    renderCard();
    const uploader = screen.getByTestId("file-upload");
    expect(uploader).toBeInTheDocument();
    expect(uploader.getAttribute("aria-label")).toBe("tenants.detail.files.uploadTitle");
  });

  test("shows empty state when the tenant has no files", async () => {
    adminListFiles.mockResolvedValue({ files: [], total: 0 });
    renderCard();
    await waitFor(() => expect(screen.getByText("tenants.detail.files.empty")).toBeInTheDocument());
  });

  test("renders a row per file with name, type and status + variant count", async () => {
    adminListFiles.mockResolvedValue({ files: [makeFile()], total: 1 });
    renderCard();
    await waitFor(() => expect(screen.getByText("logo.png")).toBeInTheDocument());
    expect(screen.getByText("image/png")).toBeInTheDocument();
    expect(screen.getByText("tenants.detail.files.status.ready")).toBeInTheDocument();
    // variantCount surfaced via the {count}-interpolated label.
    expect(screen.getByText("tenants.detail.files.variants:1")).toBeInTheDocument();
  });

  test("view action opens the signed read-url in a new tab", async () => {
    adminListFiles.mockResolvedValue({ files: [makeFile()], total: 1 });
    renderCard();
    await waitFor(() => expect(screen.getByText("logo.png")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "tenants.detail.files.view:logo.png" }));
    await waitFor(() => expect(adminGetReadUrl).toHaveBeenCalledWith("t1", "f1"));
    await waitFor(() =>
      expect(window.open).toHaveBeenCalledWith(
        "https://signed.example/read",
        "_blank",
        "noopener,noreferrer",
      ),
    );
  });

  test("view action is disabled while a file is pending", async () => {
    adminListFiles.mockResolvedValue({
      files: [makeFile({ status: "pending", originalFilename: "wip.png" })],
      total: 1,
    });
    renderCard();
    await waitFor(() => expect(screen.getByText("wip.png")).toBeInTheDocument());
    const viewBtn = screen.getByRole("button", { name: "tenants.detail.files.view:wip.png" });
    expect(viewBtn).toBeDisabled();
  });

  test("delete confirm dialog calls adminDeleteFile then closes", async () => {
    adminListFiles.mockResolvedValue({ files: [makeFile()], total: 1 });
    renderCard();
    await waitFor(() => expect(screen.getByText("logo.png")).toBeInTheDocument());

    // No dialog initially.
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "tenants.detail.files.delete:logo.png" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("tenants.detail.files.deleteDialog.title")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "tenants.detail.files.deleteDialog.confirm" }),
    );
    await waitFor(() => expect(adminDeleteFile).toHaveBeenCalledWith("t1", "f1"));
  });

  test("load error renders the i18n load-error message", async () => {
    adminListFiles.mockRejectedValue(new Error("boom"));
    renderCard();
    await waitFor(() =>
      expect(screen.getByText("tenants.detail.files.toast.loadError")).toBeInTheDocument(),
    );
  });
});
