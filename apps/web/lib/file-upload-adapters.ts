// Phase 29 / IDA-01, IDA-02 — page-side adapters that wire the backend-AGNOSTIC
// <FileUpload> component (packages/ui) to the Eden files endpoints.
//
// The component never touches the API; the page injects these callbacks. The
// `sign` adapter maps the backend SignedUpload envelope
// ({ fileId, method, url, headers?, fields?, expiresAt } — NO `kind`) into the
// UI-side discriminated UploadDescriptor (POST + fields → s3-post, else s3-put).
// Errors are thrown with a `{ status }` so the hook maps them to UploadErrorCode
// (413 → quota_exceeded / oversize; non-413 sign → sign_failed; complete →
// mime_mismatch).

import type { FileUploadLabels, UploadDescriptor } from "@baseworks/ui";
import { api } from "@/lib/api";

/** auth relation kinds that own an identity asset. */
export type IdentityKind = "user" | "organization";

/** Throwable carrying an HTTP status the hook can map to an UploadErrorCode. */
function httpError(message: string, status?: number): Error & { status?: number } {
  return Object.assign(new Error(message), { status });
}

/**
 * sign() adapter for a given relation kind. Calls POST /api/files/sign-upload
 * and converts the envelope into an UploadDescriptor.
 */
export function makeSign(kind: IdentityKind) {
  return async (meta: {
    file: File;
    name: string;
    mimeType: string;
    byteSize: number;
  }): Promise<UploadDescriptor> => {
    const res = await api.api.files["sign-upload"].post({
      ownerModule: "auth",
      kind,
      mimeType: meta.mimeType,
      byteSize: meta.byteSize,
    });
    if (res.error || !res.data) {
      throw httpError("sign-upload failed", res.error?.status);
    }
    const env = res.data as {
      fileId: string;
      method: string;
      url: string;
      headers?: Record<string, string> | null;
      fields?: Record<string, string> | null;
      expiresAt: string;
    };

    if (env.method === "POST" && env.fields) {
      return {
        kind: "s3-post",
        fileId: env.fileId,
        url: env.url,
        fields: env.fields,
        expiresAt: env.expiresAt,
      };
    }
    return {
      kind: "s3-put",
      fileId: env.fileId,
      url: env.url,
      headers: env.headers ?? undefined,
      expiresAt: env.expiresAt,
    };
  };
}

/** complete() adapter — server-authoritative finalize (magic-byte check). */
export async function completeUpload(fileId: string): Promise<unknown> {
  const res = await api.api.files({ fileId }).complete.post();
  if (res.error) {
    throw httpError("complete failed", res.error.status);
  }
  return res.data;
}

/** Link a finalized file to its owner record (triggers cascade-on-replace). */
export async function attachFile(input: {
  fileId: string;
  ownerRecordType: IdentityKind;
  ownerRecordId: string;
}): Promise<void> {
  const res = await api.api.files.attach.post({
    fileId: input.fileId,
    ownerModule: "auth",
    ownerRecordType: input.ownerRecordType,
    ownerRecordId: input.ownerRecordId,
  });
  if (res.error) {
    throw httpError("attach failed", res.error.status);
  }
}

/**
 * Resolve the latest signed READ url for an owner record via
 * list-for-record → newest uploaded/ready → get-read-url. Used by the org-logo
 * page (the avatar page reads `avatarUrl` straight off GET /api/profile).
 */
export async function resolveLatestReadUrl(
  ownerRecordType: IdentityKind,
  recordId: string,
): Promise<string | null> {
  const listed = await api.api.files["list-for-record"].get({
    query: { ownerModule: "auth", ownerRecordType, recordId },
  });
  if (listed.error || !listed.data) return null;
  const files = (listed.data as { files: Array<{ fileId: string; status: string }> }).files.filter(
    (f) => f.status === "uploaded" || f.status === "ready",
  );
  const latest = files[files.length - 1];
  if (!latest) return null;
  const read = await api.api.files({ fileId: latest.fileId })["read-url"].get();
  if (read.error || !read.data) return null;
  return (read.data as { url: string }).url;
}

/** Build the FileUpload labels bag from a useTranslations("files") instance. */
export function buildFileUploadLabels(t: (key: string) => string): Partial<FileUploadLabels> {
  return {
    dropzone: t("dropzone"),
    browse: t("browse"),
    uploading: t("uploading"),
    processing: t("processing"),
    done: t("done"),
    cancel: t("cancel"),
    retry: t("retry"),
    remove: t("remove"),
    beforeUnload: t("beforeUnload"),
    errors: {
      oversize: t("errors.oversize"),
      wrong_mime: t("errors.wrong_mime"),
      quota_exceeded: t("errors.quota_exceeded"),
      network: t("errors.network"),
      mime_mismatch: t("errors.mime_mismatch"),
      sign_failed: t("errors.sign_failed"),
      canceled: t("errors.canceled"),
      unknown: t("errors.unknown"),
    },
  };
}

/** MIME allow-list mirrored from the auth relations (SVG excluded). */
export const IMAGE_ACCEPT = ["image/jpeg", "image/png", "image/webp"];
/** 5 MiB — mirror of AVATAR_MAX_BYTES / LOGO_MAX_BYTES. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
