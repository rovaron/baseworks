// Phase 30 / UI-02 — admin-side adapters that wire the backend-AGNOSTIC
// <FileUpload> component (packages/ui) to the cross-tenant admin files endpoints.
//
// Mirror of apps/web/lib/file-upload-adapters.ts, pointed at the gated
// /api/admin/tenants/:id/files/* routes and parameterized by the TARGET tenant id
// (the gated path param). The component never touches the API; the page injects
// these callbacks. `sign` maps the backend SignedUpload envelope
// ({ fileId, method, url, headers?, fields?, expiresAt } — NO `kind`) into the
// UI-side discriminated UploadDescriptor (POST + fields → s3-post, else s3-put).
// Errors are thrown with a `{ status }` so the hook maps them to UploadErrorCode
// (413 → quota_exceeded; non-413 sign → sign_failed; complete → mime_mismatch).

import type { FileUploadLabels, UploadDescriptor } from "@baseworks/ui";
import { api } from "@/lib/api";

/** Throwable carrying an HTTP status the hook can map to an UploadErrorCode. */
function httpError(message: string, status?: number): Error & { status?: number } {
  return Object.assign(new Error(message), { status });
}

type SignEnvelope = {
  fileId: string;
  method: string;
  url: string;
  headers?: Record<string, string> | null;
  fields?: Record<string, string> | null;
  expiresAt: string;
};

/**
 * sign() adapter for a given TARGET tenant. Calls
 * POST /api/admin/tenants/:id/files/sign-upload and converts the envelope into an
 * UploadDescriptor. The body carries NO tenantId — the tenant is the gated path
 * param only (confused-deputy closed server-side).
 */
export function makeAdminSign(tenantId: string) {
  return async (meta: {
    file: File;
    name: string;
    mimeType: string;
    byteSize: number;
  }): Promise<UploadDescriptor> => {
    const res = await (api.api.admin.tenants as any)({ id: tenantId }).files["sign-upload"].post({
      mimeType: meta.mimeType,
      byteSize: meta.byteSize,
      originalFilename: meta.name,
    });
    if (res.error || !res.data) {
      throw httpError("sign-upload failed", res.error?.status);
    }
    const env = res.data as SignEnvelope;

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

/** complete() adapter — server-authoritative finalize for the TARGET tenant. */
export function makeAdminComplete(tenantId: string) {
  return async (fileId: string): Promise<unknown> => {
    const res = await (api.api.admin.tenants as any)({ id: tenantId })
      .files({ fileId })
      .complete.post();
    if (res.error) {
      throw httpError("complete failed", res.error.status);
    }
    return res.data;
  };
}

/** Resolve a short-lived signed READ url for a file in the TARGET tenant. */
export async function adminGetReadUrl(tenantId: string, fileId: string): Promise<string | null> {
  const res = await (api.api.admin.tenants as any)({ id: tenantId })
    .files({ fileId })
    ["read-url"].get();
  if (res.error || !res.data) return null;
  return (res.data as { url: string }).url;
}

/** Soft-delete a file in the TARGET tenant. */
export async function adminDeleteFile(tenantId: string, fileId: string): Promise<void> {
  const res = await (api.api.admin.tenants as any)({ id: tenantId }).files({ fileId }).delete();
  if (res.error) {
    throw httpError("delete failed", res.error.status);
  }
}

/** A single file row from GET /api/admin/tenants/:id/files. NO storage_key/bucket. */
export type AdminFileRow = {
  fileId: string;
  ownerModule: string;
  ownerRecordType: string;
  ownerRecordId: string;
  mimeType: string;
  byteSize: number;
  status: string;
  originalFilename: string | null;
  transforms: unknown;
  variantCount: number;
  createdAt: string;
  uploadedByUserId: string | null;
};

/** List every live file in the TARGET tenant. */
export async function adminListFiles(
  tenantId: string,
): Promise<{ files: AdminFileRow[]; total: number }> {
  const res = await (api.api.admin.tenants as any)({ id: tenantId }).files.get();
  if (res.error || !res.data) {
    throw httpError("list failed", res.error?.status);
  }
  return res.data as { files: AdminFileRow[]; total: number };
}

/** Build the FileUpload labels bag from a useTranslation("files") instance. */
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

/** MIME allow-list mirrored from the admin-attachment relation (images + PDF, NO svg). */
export const ADMIN_ACCEPT = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
/** 10 MiB — mirror of the admin-attachment relation cap (client pre-check only). */
export const ADMIN_MAX_BYTES = 10 * 1024 * 1024;
