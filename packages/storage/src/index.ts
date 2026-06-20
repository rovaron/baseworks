// @baseworks/storage — Phase 24 ports + scaffold adapters + env-selected factory.
// Barrel populated incrementally by Phase 24 plans:
//   - Plan 24-01: port types (this plan)
//   - Plan 24-04: factory + env validator + adapter scaffolds
//   - Plan 24-05: fileRelations registry + collector

export { ImagescriptImageTransform } from "./adapters/imagescript/image-transform";
// Throwing-NotImplemented adapter scaffolds (Phase 24 / D-15 verbatim / D-16 parallel form).
// Bodies in Phase 25 (FileStorage) / Phase 28 (ImageTransform).
export { LocalFileStorage } from "./adapters/local/file-storage";
// Local-adapter HMAC signature verifier (Phase 25 / D-25-01 / contract §1.5).
// Public because the Phase 26 `/api/files/local/:bucket/:key` endpoint consumes
// it to authenticate minted upload/read URLs. The minter (`signLocalUrl`) stays
// internal — only the adapter mints; callers verify.
export type {
  VerifyLocalSignatureArgs,
  VerifyLocalSignatureResult,
} from "./adapters/local/signing";
export { verifyLocalSignature } from "./adapters/local/signing";
export { S3FileStorage } from "./adapters/s3/file-storage";
export { S3CompatFileStorage } from "./adapters/s3-compat/file-storage";
export { SharpImageTransform } from "./adapters/sharp/image-transform";
// Env validator (Phase 17 pattern; called from apps/api boot — Plan 24-06).
export { validateStorageEnv } from "./env";
// Env-selected singleton factories (Phase 24 / Plan 24-04 / D-10 / D-12 / D-15 / D-16).
export {
  getFileStorage,
  getImageTransform,
  resetFileStorage,
  resetImageTransform,
  setFileStorage,
  setImageTransform,
} from "./factory";
// Ports — FileStorage (Phase 24 / FILE-01 / Plan 24-01).
export type {
  FileStorage,
  ObjectStat,
  SignedRead,
  SignedUpload,
  StorageBucket,
  StorageKey,
} from "./ports/file-storage";
// Ports — ImageTransform (Phase 24 / FILE-01 / Plan 24-01).
// ImageVariantSpec is re-exported here for ergonomics; the canonical declaration
// lives in @baseworks/shared (Plan 24-03 / declared in 24-01 per the soft-dep
// resolution).
export type {
  ImageMetadata,
  ImageTransform,
  ImageVariantSpec,
} from "./ports/image-transform";
// FileRelations registry + collector (Phase 24 / D-06..D-09).
export { collectFileRelations, fileRelationsRegistry } from "./registry";
