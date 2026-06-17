import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { FileUpload, type UploadDescriptor } from "../file-upload";

function expectNoSeriousViolations(results: Awaited<ReturnType<typeof axe>>) {
  const serious = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  expect(serious).toHaveLength(0);
}

// jsdom lacks object-URL + a progress-capable XHR; provide minimal mocks.
beforeAll(() => {
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
  globalThis.URL.revokeObjectURL = vi.fn();
});

class MockXHR {
  static instances: MockXHR[] = [];
  upload: { onprogress?: (e: ProgressEvent) => void } = {};
  status = 200;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => {
    this.onabort?.();
  });
  constructor() {
    MockXHR.instances.push(this);
  }
}

function installMockXHR() {
  MockXHR.instances = [];
  vi.stubGlobal("XMLHttpRequest", MockXHR as unknown as typeof XMLHttpRequest);
}

function makeFile(name: string, type: string, size: number): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

function selectFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
  return input;
}

const okSign = async (): Promise<UploadDescriptor> => ({
  kind: "s3-put",
  fileId: "file_1",
  url: "https://storage.example/put",
  headers: { "Content-Type": "image/png" },
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FileUpload a11y", () => {
  it("has no critical/serious violations in the default state", async () => {
    const { container } = render(<FileUpload sign={okSign} accept={["image/png"]} />);
    const results = await axe(container);
    expectNoSeriousViolations(results);
  });

  it("exposes a keyboard-focusable dropzone (role=button) and a file input", () => {
    render(<FileUpload sign={okSign} aria-label="Upload avatar" />);
    const dropzone = screen.getByRole("button", { name: "Upload avatar" });
    expect(dropzone).toHaveAttribute("tabindex", "0");
    const input = document.querySelector('input[type="file"]');
    expect(input).toBeInTheDocument();
    expect(input).not.toHaveAttribute("multiple"); // single mode → not multiple
  });

  it("opens the hidden picker on Enter/Space from the dropzone", () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    render(<FileUpload sign={okSign} aria-label="Upload" />);
    const dropzone = screen.getByRole("button", { name: "Upload" });
    fireEvent.keyDown(dropzone, { key: "Enter" });
    fireEvent.keyDown(dropzone, { key: " " });
    expect(clickSpy).toHaveBeenCalledTimes(2);
    clickSpy.mockRestore();
  });

  it("renders a client-side oversize error with role=alert and stays axe-clean", async () => {
    const { container } = render(
      <FileUpload sign={okSign} accept={["image/png"]} maxByteSize={10} />,
    );
    selectFile(makeFile("huge.png", "image/png", 5_000_000));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/too large/i);
    const results = await axe(container);
    expectNoSeriousViolations(results);
  });

  it("rejects a wrong MIME type before signing", async () => {
    const sign = vi.fn(okSign);
    render(<FileUpload sign={sign} accept={["image/png"]} />);
    selectFile(makeFile("notes.txt", "text/plain", 100));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/unsupported/i);
    expect(sign).not.toHaveBeenCalled();
  });

  it("reports real byte progress via xhr.upload.onprogress", async () => {
    installMockXHR();
    render(<FileUpload sign={okSign} accept={["image/png"]} preview={false} />);
    selectFile(makeFile("a.png", "image/png", 1000));

    await waitFor(() => expect(MockXHR.instances.length).toBe(1));
    const xhr = MockXHR.instances[0];
    await waitFor(() => expect(xhr.send).toHaveBeenCalled());

    act(() => {
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: 40, total: 100 } as ProgressEvent);
    });
    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "40");
  });

  it("cancels an in-flight upload via xhr.abort()", async () => {
    installMockXHR();
    render(<FileUpload sign={okSign} accept={["image/png"]} preview={false} />);
    selectFile(makeFile("a.png", "image/png", 1000));

    await waitFor(() => expect(MockXHR.instances.length).toBe(1));
    const xhr = MockXHR.instances[0];
    await waitFor(() => expect(xhr.send).toHaveBeenCalled());

    const cancelBtn = await screen.findByRole("button", { name: /cancel/i });
    await act(async () => {
      fireEvent.click(cancelBtn);
    });
    expect(xhr.abort).toHaveBeenCalled();
    // canceled is retryable → a retry control is offered.
    await waitFor(() => expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument());
  });

  it("honors cancel while still signing (no XHR is started after sign resolves)", async () => {
    installMockXHR();
    // Deferred sign: stays pending until we resolve it, so cancel lands mid-sign
    // (no XHR exists yet → cancel takes the direct status='canceled' branch).
    let resolveSign: (d: UploadDescriptor) => void = () => {};
    const sign = vi.fn(
      () =>
        new Promise<UploadDescriptor>((res) => {
          resolveSign = res;
        }),
    );
    render(<FileUpload sign={sign} accept={["image/png"]} preview={false} />);
    selectFile(makeFile("a.png", "image/png", 1000));

    // While signing, the active row shows a cancel control.
    const cancelBtn = await screen.findByRole("button", { name: /cancel/i });
    await act(async () => {
      fireEvent.click(cancelBtn);
    });

    // Now let sign() resolve — the pipeline must bail, NOT start the upload.
    await act(async () => {
      resolveSign(await okSign());
    });

    expect(MockXHR.instances).toHaveLength(0);
    await waitFor(() => expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument());
  });
});
