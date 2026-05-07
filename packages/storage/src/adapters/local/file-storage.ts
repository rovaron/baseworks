/**
 * LocalFileStorage adapter scaffold (Phase 24 / FILE-01 / D-15).
 *
 * Phase 24 ships throwing-NotImplemented scaffolds so the factory contract
 * surface is verifiable end-to-end before Phase 25 fills the bodies. The
 * adapter is BANNED in production by validateStorageEnv() (D-14 / Pitfall 14)
 * even when its body lands.
 *
 * Design rule: factory.getFileStorage() returns a real instance — never null —
 * so the contract surface is verifiable in Phase 24. Every method throws with
 * the EXACT verbatim D-15 message so accidental invocation produces actionable
 * guidance.
 *
 * Message format (D-15 verbatim — CONTEXT line 50):
 *   `FileStorage.{method}: not yet implemented in Phase 24; arriving in Phase 25`
 * NO parenthetical adapter discriminator; adapter identity is preserved via
 * the stack-trace class name (this class) when the error is thrown.
 */
import type { FileStorage, ObjectStat, SignedRead, SignedUpload } from "../../ports/file-storage";

export class LocalFileStorage implements FileStorage {
  readonly name = "local";

  async signUpload(_args: {
    bucket: string;
    key: string;
    mimeType: string;
    maxByteSize: number;
    expiresInSec: number;
  }): Promise<SignedUpload> {
    throw new Error(
      "FileStorage.signUpload: not yet implemented in Phase 24; arriving in Phase 25",
    );
  }
  async signRead(_args: {
    bucket: string;
    key: string;
    expiresInSec: number;
    responseContentDisposition?: string;
  }): Promise<SignedRead> {
    throw new Error("FileStorage.signRead: not yet implemented in Phase 24; arriving in Phase 25");
  }
  async stat(_args: { bucket: string; key: string }): Promise<ObjectStat | null> {
    throw new Error("FileStorage.stat: not yet implemented in Phase 24; arriving in Phase 25");
  }
  async delete(_args: { bucket: string; key: string }): Promise<void> {
    throw new Error("FileStorage.delete: not yet implemented in Phase 24; arriving in Phase 25");
  }
  async getObject(_args: { bucket: string; key: string }): Promise<Uint8Array> {
    throw new Error("FileStorage.getObject: not yet implemented in Phase 24; arriving in Phase 25");
  }
  async putObject(_args: {
    bucket: string;
    key: string;
    body: Uint8Array;
    mimeType: string;
  }): Promise<void> {
    throw new Error("FileStorage.putObject: not yet implemented in Phase 24; arriving in Phase 25");
  }
}
