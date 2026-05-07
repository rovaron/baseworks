// @baseworks/storage — Phase 24 ports + scaffold adapters + env-selected factory.
// Barrel populated incrementally by Phase 24 plans:
//   - Plan 24-01: port types (this plan)
//   - Plan 24-04: factory + env validator + adapter scaffolds
//   - Plan 24-05: fileRelations registry + collector

// Ports — FileStorage (Phase 24 / FILE-01 / Plan 24-01).
export type {
  FileStorage,
  SignedUpload,
  SignedRead,
  ObjectStat,
  StorageBucket,
  StorageKey,
} from "./ports/file-storage";

// Ports — ImageTransform (Phase 24 / FILE-01 / Plan 24-01).
// ImageVariantSpec is re-exported here for ergonomics; the canonical declaration
// lives in @baseworks/shared (Plan 24-03 / declared in 24-01 per the soft-dep
// resolution).
export type {
  ImageTransform,
  ImageMetadata,
  ImageVariantSpec,
} from "./ports/image-transform";
