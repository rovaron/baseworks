/**
 * Phase 24 / FILE-01 — shared bucket/key types used by the FileStorage port.
 *
 * Phase 24 ships type-only contract. Phase 25 fills adapter bodies; Phase 26
 * consumes via the @baseworks/module-files commands.
 */

/** A logical storage bucket — translates to S3 bucket name OR local FS root segment. */
export type StorageBucket = string;

/** A storage key (object path within bucket). Built only by `buildStorageKey()` (Phase 26). */
export type StorageKey = string;
