"use client";

// Phase 29 / UI-01 — backend-AGNOSTIC upload hook.
// Owns the XHR transport (real byte progress), per-item state machine,
// object-URL lifecycle, and the beforeunload navigation guard.
// It imports NOTHING from @baseworks/api-client or apps/* — every backend
// behaviour is injected via the `sign` / `complete` / `onUploaded` callbacks.

import * as React from "react";
import type { FileUploadProps } from "../components/file-upload";

/**
 * Discriminated union describing how a single file should be transported to
 * storage. The PAGE-level `sign` adapter derives `kind` from the backend
 * SignedUpload envelope — the backend itself has no `kind` field.
 */
export type UploadDescriptor =
  | {
      kind: "s3-put";
      fileId: string;
      url: string;
      headers?: Record<string, string>;
      expiresAt: string;
    }
  | {
      kind: "s3-post";
      fileId: string;
      url: string;
      fields: Record<string, string>;
      expiresAt: string;
    }
  | {
      kind: "local";
      fileId: string;
      url: string;
      headers?: Record<string, string>;
      expiresAt: string;
    };

export type UploadErrorCode =
  | "oversize" // client-side: file.size > maxByteSize (BEFORE sign)
  | "wrong_mime" // client-side: file.type ∉ accept (BEFORE sign)
  | "quota_exceeded" // sign() rejects with status 413
  | "network" // XHR error/timeout/non-2xx — RETRYABLE
  | "mime_mismatch" // complete() rejects (server magic-byte mismatch; file deleted)
  | "sign_failed" // sign() non-413 failure
  | "canceled" // user pressed Cancel (xhr.abort())
  | "unknown";

export type UploadStatus =
  | "idle"
  | "signing"
  | "uploading"
  | "completing"
  | "done"
  | "error"
  | "canceled";

export interface UploadItem {
  /** client uuid (crypto.randomUUID) for the row */
  id: string;
  file: File;
  name: string;
  /** object URL (images only); revoked on remove/unmount */
  previewUrl?: string;
  status: UploadStatus;
  /** 0–100, real bytes (xhr.upload loaded/total) */
  progress: number;
  /** set after sign() */
  fileId?: string;
  error?: UploadErrorCode;
}

export interface UseFileUpload {
  items: UploadItem[];
  /** any item in signing|uploading|completing — drives beforeunload */
  isUploading: boolean;
  addFiles: (files: FileList | File[]) => void;
  retry: (id: string) => void;
  /** xhr.abort() */
  cancel: (id: string) => void;
  /** revokes previewUrl */
  remove: (id: string) => void;
  reset: () => void;
}

/** Options accepted by the hook (the subset of FileUploadProps that drives behaviour). */
export type UseFileUploadOptions = Omit<FileUploadProps, "className" | "labels" | "aria-label">;

const ACTIVE_STATUSES: ReadonlySet<UploadStatus> = new Set<UploadStatus>([
  "signing",
  "uploading",
  "completing",
]);

const RETRYABLE_CODES: ReadonlySet<UploadErrorCode> = new Set<UploadErrorCode>([
  "network",
  "sign_failed",
  "quota_exceeded",
]);

/** A retryable item: failed with a transient code, or user-canceled. */
export function isRetryable(item: UploadItem): boolean {
  if (item.status === "canceled") return true;
  if (item.status === "error" && item.error) return RETRYABLE_CODES.has(item.error);
  return false;
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `u_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

/** Tagged error carrying an UploadErrorCode the hook can surface verbatim. */
function codeError(code: UploadErrorCode, message?: string): Error & { code: UploadErrorCode } {
  return Object.assign(new Error(message ?? code), { code });
}

function codeOf(e: unknown): UploadErrorCode | undefined {
  if (e && typeof e === "object" && "code" in e) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === "string") return c as UploadErrorCode;
  }
  return undefined;
}

function statusOf(e: unknown): number | undefined {
  if (e && typeof e === "object" && "status" in e) {
    const s = (e as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return undefined;
}

/** Map a thrown sign() error to a code (explicit code wins; 413→quota; else sign_failed). */
function mapSignError(e: unknown): UploadErrorCode {
  return codeOf(e) ?? (statusOf(e) === 413 ? "quota_exceeded" : "sign_failed");
}

/** Map a thrown complete() error (explicit code wins; 413→quota; else mime_mismatch). */
function mapCompleteError(e: unknown): UploadErrorCode {
  return codeOf(e) ?? (statusOf(e) === 413 ? "quota_exceeded" : "mime_mismatch");
}

/** Does file.type satisfy the accept allow-list (supports `type/*` wildcards)? */
function matchesAccept(file: File, accept: string[]): boolean {
  if (accept.length === 0) return true;
  const type = (file.type || "").toLowerCase();
  return accept.some((raw) => {
    const a = raw.trim().toLowerCase();
    if (!a) return false;
    if (a.endsWith("/*")) return type.startsWith(`${a.slice(0, -1)}`);
    return type === a;
  });
}

export function useFileUpload(opts: UseFileUploadOptions): UseFileUpload {
  const [items, setItemsState] = React.useState<UploadItem[]>([]);

  // Refs let the async pipeline read the latest values without re-binding.
  const itemsRef = React.useRef<UploadItem[]>([]);
  const optsRef = React.useRef(opts);
  optsRef.current = opts;
  const xhrMap = React.useRef(new Map<string, XMLHttpRequest>());
  const descriptors = React.useRef(new Map<string, UploadDescriptor>());

  const setItems = React.useCallback((updater: (prev: UploadItem[]) => UploadItem[]) => {
    setItemsState((prev) => {
      const next = updater(prev);
      itemsRef.current = next;
      return next;
    });
  }, []);

  const update = React.useCallback(
    (id: string, patch: Partial<UploadItem>) => {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    },
    [setItems],
  );

  /** Raw XHR transport with real byte progress. Resolves on 2xx, rejects with a coded error. */
  const xhrUpload = React.useCallback(
    (id: string, descriptor: UploadDescriptor, file: File): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrMap.current.set(id, xhr);
        const method = descriptor.kind === "s3-post" ? "POST" : "PUT";
        xhr.open(method, descriptor.url, true);

        xhr.upload.onprogress = (ev: ProgressEvent) => {
          if (ev.lengthComputable && ev.total > 0) {
            update(id, { progress: Math.round((ev.loaded / ev.total) * 100) });
          }
        };
        xhr.onload = () => {
          xhrMap.current.delete(id);
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else
            reject(
              codeError(xhr.status === 413 ? "quota_exceeded" : "network", `HTTP ${xhr.status}`),
            );
        };
        xhr.onerror = () => {
          xhrMap.current.delete(id);
          reject(codeError("network"));
        };
        xhr.ontimeout = () => {
          xhrMap.current.delete(id);
          reject(codeError("network"));
        };
        xhr.onabort = () => {
          xhrMap.current.delete(id);
          reject(codeError("canceled"));
        };

        if (descriptor.kind === "s3-post") {
          // S3 POST policy: every field first, `file` appended LAST.
          const form = new FormData();
          for (const [k, v] of Object.entries(descriptor.fields)) form.append(k, v);
          form.append("file", file);
          xhr.send(form); // do NOT set Content-Type — browser sets the multipart boundary
        } else {
          // s3-put / local: raw PUT of the File body with provided headers.
          for (const [k, v] of Object.entries(descriptor.headers ?? {})) {
            xhr.setRequestHeader(k, v);
          }
          xhr.send(file);
        }
      }),
    [update],
  );

  /** Drive one item through signing → uploading → completing → done. */
  const process = React.useCallback(
    async (id: string, resume: boolean) => {
      const o = optsRef.current;
      const current = itemsRef.current.find((it) => it.id === id);
      if (!current) return;
      const file = current.file;

      let descriptor = descriptors.current.get(id);

      // ---- sign (skipped on resume when we already hold a descriptor) ----
      if (!resume || !descriptor) {
        update(id, { status: "signing", error: undefined, progress: 0, fileId: undefined });
        try {
          descriptor = await o.sign({
            file,
            name: file.name,
            mimeType: file.type,
            byteSize: file.size,
          });
        } catch (e) {
          update(id, { status: "error", error: mapSignError(e) });
          return;
        }
        descriptors.current.set(id, descriptor);
        update(id, { fileId: descriptor.fileId });
      }

      // cancel()/remove() may have landed while sign() was in-flight: no XHR
      // existed yet, so cancel took the else-branch (status='canceled') and
      // remove dropped the row entirely. Re-read the latest state and bail
      // before flipping to 'uploading', otherwise we'd silently start the PUT.
      const afterSign = itemsRef.current.find((it) => it.id === id);
      if (!afterSign || afterSign.status === "canceled") return;

      // ---- upload (real XHR byte progress) ----
      update(id, {
        status: "uploading",
        error: undefined,
        progress: resume ? current.progress : 0,
      });
      try {
        await xhrUpload(id, descriptor, file);
      } catch (e) {
        const code = codeOf(e) ?? "unknown";
        update(id, { status: code === "canceled" ? "canceled" : "error", error: code });
        return;
      }

      // ---- complete (server-authoritative finalize; magic-byte check) ----
      if (o.complete) {
        update(id, { status: "completing" });
        try {
          await o.complete(descriptor.fileId);
        } catch (e) {
          update(id, { status: "error", error: mapCompleteError(e) });
          return;
        }
      }

      update(id, { status: "done", progress: 100 });
      try {
        await o.onUploaded?.({ fileId: descriptor.fileId, file });
      } catch {
        // onUploaded side-effects (attach/refetch) are the page's concern;
        // a failure there must not flip a durably-uploaded file back to error.
      }
    },
    [update, xhrUpload],
  );

  const addFiles = React.useCallback(
    (incoming: FileList | File[]) => {
      const o = optsRef.current;
      if (o.disabled) return;
      const all = Array.from(incoming);
      if (all.length === 0) return;

      const multi = o.multi ?? false;
      const preview = o.preview ?? true;
      const accept = o.accept ?? [];

      // Single mode: replace any existing item(s).
      if (!multi) {
        for (const old of itemsRef.current) {
          xhrMap.current.get(old.id)?.abort();
          if (old.previewUrl) URL.revokeObjectURL(old.previewUrl);
          descriptors.current.delete(old.id);
        }
        xhrMap.current.clear();
      }

      const selected = multi ? all : all.slice(0, 1);
      const maxFiles = o.maxFiles ?? 10;
      const existingCount = multi ? itemsRef.current.length : 0;
      const room = Math.max(0, maxFiles - existingCount);
      const capped = multi ? selected.slice(0, room) : selected;

      const created: UploadItem[] = capped.map((file) => {
        const id = newId();
        const isImage = (file.type || "").startsWith("image/");
        const previewUrl = preview && isImage ? URL.createObjectURL(file) : undefined;

        // Client-side pre-sign validation (oversize / wrong_mime are terminal).
        let error: UploadErrorCode | undefined;
        if (o.maxByteSize && file.size > o.maxByteSize) error = "oversize";
        else if (!matchesAccept(file, accept)) error = "wrong_mime";

        return {
          id,
          file,
          name: file.name,
          previewUrl,
          status: error ? "error" : "idle",
          progress: 0,
          error,
        };
      });

      setItems((prev) => (multi ? [...prev, ...created] : created));

      for (const it of created) {
        if (!it.error) void process(it.id, false);
      }
    },
    [process, setItems],
  );

  const retry = React.useCallback(
    (id: string) => {
      const it = itemsRef.current.find((x) => x.id === id);
      if (!it || !isRetryable(it)) return;
      // Resume from PUT when we already have a fileId + descriptor; else re-sign.
      const resume = Boolean(it.fileId) && descriptors.current.has(id);
      void process(id, resume);
    },
    [process],
  );

  const cancel = React.useCallback(
    (id: string) => {
      const xhr = xhrMap.current.get(id);
      if (xhr) xhr.abort();
      else {
        // Not yet sending (e.g. mid-sign): mark canceled directly.
        setItems((prev) =>
          prev.map((it) =>
            it.id === id && ACTIVE_STATUSES.has(it.status)
              ? { ...it, status: "canceled", error: "canceled" }
              : it,
          ),
        );
      }
    },
    [setItems],
  );

  const remove = React.useCallback(
    (id: string) => {
      xhrMap.current.get(id)?.abort();
      xhrMap.current.delete(id);
      descriptors.current.delete(id);
      setItems((prev) => {
        const target = prev.find((it) => it.id === id);
        if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
        return prev.filter((it) => it.id !== id);
      });
    },
    [setItems],
  );

  const reset = React.useCallback(() => {
    for (const xhr of xhrMap.current.values()) xhr.abort();
    xhrMap.current.clear();
    descriptors.current.clear();
    setItems((prev) => {
      for (const it of prev) if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
      return [];
    });
  }, [setItems]);

  const isUploading = items.some((it) => ACTIVE_STATUSES.has(it.status));

  // beforeunload guard — registered only while an upload is in-flight.
  React.useEffect(() => {
    if (!isUploading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isUploading]);

  // Unmount cleanup: abort in-flight XHRs and revoke every object URL.
  React.useEffect(() => {
    const xhrs = xhrMap.current;
    return () => {
      for (const xhr of xhrs.values()) xhr.abort();
      xhrs.clear();
      for (const it of itemsRef.current) {
        if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
      }
    };
  }, []);

  return { items, isUploading, addFiles, retry, cancel, remove, reset };
}
