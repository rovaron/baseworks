/**
 * Phase 26 / MOD-02 — files module definition.
 * Phase 27 / UPL-02, UPL-04, ATT-01, ATT-02, MOD-03 — complete/read/delete/attach.
 *
 * The end-to-end file flow: operator-configurable per-tenant quota enforced
 * atomically at sign-time, server-authoritative completion (size + magic-byte
 * verification), signed read URLs, soft-delete with quota refund, generic
 * record attachment, and a cascade soft-delete subscriber. Follows the
 * Medusa-style module pattern (billing is the structural analog).
 *
 * Phase 28 / IMG-01, IMG-02, IMG-03 — async image-variant generation.
 *
 * Routes:   /api/files/sign-upload, /:fileId/complete, /:fileId/read-url,
 *           /attach, /list-for-record, DELETE /:fileId
 * Commands: files:sign-upload, files:complete-upload, files:attach-file,
 *           files:delete-file
 * Queries:  files:get-read-url, files:list-for-record
 * Jobs:     files:transform-image (queue: image-transform, concurrency: 2)
 * Events:   file.signed, file.completed, file.deleted, file.transformed,
 *           file.transform-failed
 */

import type { ModuleDefinition } from "@baseworks/shared";
import { attachFileCommand } from "./commands/attach-file";
import { completeUpload } from "./commands/complete-upload";
import { deleteFile } from "./commands/delete-file";
import { signUpload } from "./commands/sign-upload";
import { transformImage } from "./jobs/transform-image";
import { getReadUrl } from "./queries/get-read-url";
import { listForRecord } from "./queries/list-for-record";
import { filesRoutes } from "./routes";

// Ergonomic server-side helper (contract §5.2). Cross-module callers use
// ctx.dispatch("files:attach-file", …) instead — never this import.
export { attachFile } from "./commands/attach-file";
export { registerFilesHooks } from "./hooks/on-tenant-created";
export { transformImage } from "./jobs/transform-image";
// Phase 28 / IMG-01 — worker binds this to its registry event bus so the
// image-transform job's lifecycle events are emitted + traced.
export { setTransformEventSink } from "./lib/transform-events";

export default {
  name: "files",
  routes: filesRoutes,
  commands: {
    "files:sign-upload": signUpload,
    "files:complete-upload": completeUpload,
    "files:attach-file": attachFileCommand,
    "files:delete-file": deleteFile,
  },
  queries: {
    "files:get-read-url": getReadUrl,
    "files:list-for-record": listForRecord,
  },
  // IMG-01 — async variant generation. concurrency:2 caps worker memory (each
  // variant decodes a full image buffer); existing jobs keep the default 5.
  jobs: {
    "files:transform-image": {
      queue: "image-transform",
      handler: transformImage,
      concurrency: 2,
    },
  },
  events: [
    "file.signed",
    "file.completed",
    "file.deleted",
    "file.transformed",
    "file.transform-failed",
  ],
} satisfies ModuleDefinition;
