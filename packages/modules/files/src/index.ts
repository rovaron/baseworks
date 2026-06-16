/**
 * Phase 26 / MOD-02 — files module definition.
 *
 * The first end-to-end file flow: operator-configurable per-tenant quota
 * enforced atomically at sign-time, with the Phase 24 fileRelations registry
 * wired to the boot path. Follows the Medusa-style module pattern (billing is
 * the structural analog).
 *
 * Routes:   /api/files/sign-upload (tenant-scoped sign-upload endpoint)
 * Commands: files:sign-upload
 * Events:   file.signed
 */

import type { ModuleDefinition } from "@baseworks/shared";
import { signUpload } from "./commands/sign-upload";
import { filesRoutes } from "./routes";

export { registerFilesHooks } from "./hooks/on-tenant-created";

export default {
  name: "files",
  routes: filesRoutes,
  commands: {
    "files:sign-upload": signUpload,
  },
  events: ["file.signed"],
} satisfies ModuleDefinition;
