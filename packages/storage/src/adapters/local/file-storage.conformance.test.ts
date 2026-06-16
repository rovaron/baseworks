/**
 * Phase 25 / FILE-02 / FILE-03 — LocalFileStorage conformance run (D-25-04).
 *
 * Runs the shared `runFileStorageConformance` suite UNCONDITIONALLY against the
 * Local adapter (the filesystem backend is always available, so all 9 behaviors
 * — including the live-backend round-trip / stat / delete tests — execute here).
 *
 * Each suite instance is rooted in a fresh `os.tmpdir()` directory via
 * `STORAGE_LOCAL_PATH` so it never touches the repo's `./storage`, and the temp
 * tree is removed in `afterAll`. `STORAGE_PROVIDER` is forced to `local` for the
 * file's lifetime and restored afterward (env hygiene for the shared suite).
 */
import { afterAll, beforeAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFileStorageConformance } from "../__tests__/conformance";
import { LocalFileStorage } from "./file-storage";

let tempRoot: string;
const prevStoragePath = process.env.STORAGE_LOCAL_PATH;

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "baseworks-local-storage-"));
  process.env.STORAGE_LOCAL_PATH = tempRoot;
});

afterAll(() => {
  if (prevStoragePath === undefined) {
    delete process.env.STORAGE_LOCAL_PATH;
  } else {
    process.env.STORAGE_LOCAL_PATH = prevStoragePath;
  }
  rmSync(tempRoot, { recursive: true, force: true });
});

runFileStorageConformance("local", () => new LocalFileStorage());
