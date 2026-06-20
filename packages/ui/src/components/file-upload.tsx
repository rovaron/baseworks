"use client";

// Phase 29 / UI-01 — reusable <FileUpload> (absorbed Phase 30 component).
// Backend-AGNOSTIC: no import of @baseworks/api-client or apps/*; the page
// injects sign/complete/onUploaded. i18n is injected via `labels` (English
// defaults baked in) so packages/ui stays framework-agnostic.

import { RotateCcw, Upload, X } from "lucide-react";
import * as React from "react";
import {
  isRetryable,
  type UploadDescriptor,
  type UploadErrorCode,
  type UploadItem,
  useFileUpload,
} from "../hooks/use-file-upload";
import { cn } from "../lib/utils";

export type { UseFileUpload, UseFileUploadOptions } from "../hooks/use-file-upload";
export type { UploadDescriptor, UploadErrorCode, UploadItem };

/** All optional → English defaults. Pages map these from useTranslations("files"). */
export interface FileUploadLabels {
  dropzone: string;
  browse: string;
  /** "Uploading… {percent}%" — {percent} interpolated by the component */
  uploading: string;
  processing: string;
  done: string;
  cancel: string;
  retry: string;
  remove: string;
  errors: Record<UploadErrorCode, string>;
  /** returnValue text for the navigation guard */
  beforeUnload: string;
}

export interface FileUploadProps {
  sign: (meta: {
    file: File;
    name: string;
    mimeType: string;
    byteSize: number;
  }) => Promise<UploadDescriptor>;
  /** server-authoritative finalize (POST /:fileId/complete) */
  complete?: (fileId: string) => Promise<unknown>;
  /** after complete OK (page attaches + refetches) */
  onUploaded?: (result: { fileId: string; file: File }) => void | Promise<void>;
  /** MIME allow-list mirrored client-side (default: any) */
  accept?: string[];
  /** client-side oversize pre-check (mirror of relation cap) */
  maxByteSize?: number;
  /** false (default) = single; true = multi */
  multi?: boolean;
  /** cap when multi (default 10) */
  maxFiles?: number;
  /** image preview via URL.createObjectURL (default true) */
  preview?: boolean;
  disabled?: boolean;
  labels?: Partial<FileUploadLabels>;
  className?: string;
  /** dropzone label override */
  "aria-label"?: string;
}

export const DEFAULT_FILE_UPLOAD_LABELS: FileUploadLabels = {
  dropzone: "Drag an image here, or click to choose",
  browse: "Choose file",
  uploading: "Uploading… {percent}%",
  processing: "Processing…",
  done: "Uploaded",
  cancel: "Cancel",
  retry: "Retry",
  remove: "Remove",
  beforeUnload: "An upload is still in progress. Leave anyway?",
  errors: {
    oversize: "File is too large.",
    wrong_mime: "Unsupported file type.",
    quota_exceeded: "Storage quota exceeded.",
    network: "Upload failed — check your connection and retry.",
    mime_mismatch: "File content did not match its type and was rejected.",
    sign_failed: "Could not start the upload. Try again.",
    canceled: "Upload canceled.",
    unknown: "Something went wrong.",
  },
};

function mergeLabels(partial?: Partial<FileUploadLabels>): FileUploadLabels {
  if (!partial) return DEFAULT_FILE_UPLOAD_LABELS;
  return {
    ...DEFAULT_FILE_UPLOAD_LABELS,
    ...partial,
    errors: { ...DEFAULT_FILE_UPLOAD_LABELS.errors, ...partial.errors },
  };
}

const ACTIVE = new Set<UploadItem["status"]>(["signing", "uploading", "completing"]);

function ItemRow({
  item,
  labels,
  onCancel,
  onRetry,
  onRemove,
}: {
  item: UploadItem;
  labels: FileUploadLabels;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const active = ACTIVE.has(item.status);
  const statusText =
    item.status === "completing"
      ? labels.processing
      : item.status === "signing" || item.status === "uploading"
        ? labels.uploading.replace("{percent}", String(item.progress))
        : item.status === "done"
          ? labels.done
          : "";
  const errorText = item.error ? labels.errors[item.error] : undefined;
  const showError = item.status === "error" && Boolean(errorText);

  return (
    <li
      className="flex items-center gap-3 rounded-md border border-input p-2"
      data-status={item.status}
    >
      {item.previewUrl ? (
        <img
          src={item.previewUrl}
          alt={item.name}
          className="h-12 w-12 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-muted">
          <Upload className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={item.name}>
          {item.name}
        </p>

        {active ? (
          <div
            role="progressbar"
            aria-valuenow={item.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${item.name} ${labels.uploading.replace("{percent}", String(item.progress))}`}
            className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${item.progress}%` }}
            />
          </div>
        ) : null}

        {/* Non-error status is announced politely. */}
        <p className="mt-0.5 text-xs text-muted-foreground" aria-live="polite">
          {statusText}
        </p>

        {/* Errors are assertive alerts. */}
        {showError ? (
          <p className="mt-0.5 text-xs text-destructive" role="alert">
            {errorText}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {active ? (
          <button
            type="button"
            onClick={() => onCancel(item.id)}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`${labels.cancel} ${item.name}`}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <>
            {isRetryable(item) ? (
              <button
                type="button"
                onClick={() => onRetry(item.id)}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${labels.retry} ${item.name}`}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`${labels.remove} ${item.name}`}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export function FileUpload(props: FileUploadProps) {
  const {
    accept,
    maxByteSize,
    multi = false,
    maxFiles = 10,
    preview = true,
    disabled = false,
    labels: labelsProp,
    className,
    sign,
    complete,
    onUploaded,
  } = props;
  const ariaLabelProp = props["aria-label"];

  const labels = React.useMemo(() => mergeLabels(labelsProp), [labelsProp]);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);

  const { items, addFiles, retry, cancel, remove } = useFileUpload({
    sign,
    complete,
    onUploaded,
    accept,
    maxByteSize,
    multi,
    maxFiles,
    preview,
    disabled,
  });

  const openPicker = React.useCallback(() => {
    if (disabled) return;
    inputRef.current?.click();
  }, [disabled]);

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        openPicker();
      }
    },
    [openPicker],
  );

  const onDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
    },
    [addFiles, disabled],
  );

  const onChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) addFiles(e.target.files);
      // Reset so re-picking the same file fires `change` again.
      e.target.value = "";
    },
    [addFiles],
  );

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* biome-ignore lint/a11y/useSemanticElements: a native <button> cannot host a
          block drag-and-drop region with nested content; role=button + keyboard
          handlers give equivalent semantics (axe-clean, see file-upload.a11y.test). */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabelProp ?? labels.dropzone}
        aria-disabled={disabled || undefined}
        data-dragging={dragging || undefined}
        onClick={openPicker}
        onKeyDown={onKeyDown}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input p-6 text-center transition-colors",
          disabled
            ? "cursor-not-allowed opacity-50"
            : "cursor-pointer hover:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          dragging && "border-ring bg-accent",
        )}
      >
        <Upload className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">{labels.dropzone}</p>
        <span className="text-xs font-medium text-foreground">{labels.browse}</span>
      </div>

      {/* Picker lives OUTSIDE the role=button dropzone to avoid nested-interactive;
          it is reachable by keyboard (Enter/Space on the dropzone opens it) and by
          assistive tech via its own label. */}
      <input
        ref={inputRef}
        type="file"
        accept={accept?.join(",")}
        multiple={multi}
        disabled={disabled}
        onChange={onChange}
        className="sr-only"
        aria-label={labels.browse}
      />

      {items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              labels={labels}
              onCancel={cancel}
              onRetry={retry}
              onRemove={remove}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

FileUpload.displayName = "FileUpload";
