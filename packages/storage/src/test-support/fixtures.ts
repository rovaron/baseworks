/**
 * Phase 25 / FILE-02 / FILE-03 — committed test-fixture loader (SC#5 / D-25-06).
 *
 * `FIXTURES` is the metadata map (bytes / sha256 / optional dimensions) for every
 * deterministic artifact under `packages/storage/__test-fixtures__/`, mirroring
 * the committed `manifest.json` reproducibility oracle. `loadFixture(name)` reads
 * the committed bytes as a `Uint8Array`.
 *
 * Consumed by the shared conformance suite (round-trip body = `baseline-100x100.png`)
 * and by Phase 28 transform tests (all five artifacts). The fixtures themselves are
 * produced by `scripts/generate-fixtures.ts` (no `Math.random`); `fixtures.test.ts`
 * re-hashes the committed files against this map / the manifest.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Absolute path to the committed fixture directory (repo: packages/storage/__test-fixtures__). */
const FIXTURE_DIR = join(import.meta.dir, "..", "..", "__test-fixtures__");

/** Metadata for a single committed fixture (reproducibility oracle). */
export interface FixtureMeta {
  /** Byte length on disk. */
  bytes: number;
  /** Lowercase hex sha256 of the committed bytes. */
  sha256: string;
  /** Declared image width (PNG fixtures only). */
  width?: number;
  /** Declared image height (PNG fixtures only). */
  height?: number;
}

/**
 * Metadata map for every committed fixture, keyed by filename. Values mirror
 * `packages/storage/__test-fixtures__/manifest.json` (the generator's oracle).
 */
export const FIXTURES = {
  "baseline-100x100.png": {
    bytes: 218,
    sha256: "710459d9848cb67831373725378bead8b9f1fc8914bf92bf95c3c6e384ef6a49",
    width: 100,
    height: 100,
  },
  "bomb-50000x50000.png": {
    bytes: 225,
    sha256: "486a7f27f1b51749b45ec18d2c7041db4f10617c079755b5fd24a55dd4112354",
    width: 50_000,
    height: 50_000,
  },
  "photo-5000x5000.png": {
    bytes: 2_213_010,
    sha256: "1f6ea0a8f702de23b67701bea455b85da83d2b4b887484c3579434259f132f59",
    width: 5_000,
    height: 5_000,
  },
  "svg-with-script.svg": {
    bytes: 148,
    sha256: "92c0b521d0e6f55bf3ce1b1447d1de92ff2163eb11a3d0d4727ac583c9a588e2",
  },
  // Phase 28 / IMG-03 — 80x60 JPEG carrying real GPS + camera (Make/Model) EXIF.
  // Generated with sharp `.withExif()` (NOT the dependency-light PNG generator);
  // committed so the EXIF-strip conformance gate has a metadata-BEARING input on
  // every host, independent of sharp being loadable. Both adapters decode JPEG.
  "exif-bearing.jpg": {
    bytes: 564,
    sha256: "a627ef2502de79e01f2f3f4425f8f91752f39f15b0eec62fcaa8fb555c890aeb",
    width: 80,
    height: 60,
  },
  "truncated.png": {
    bytes: 87,
    sha256: "4ee660124ba190377f499365949de3df8818f239e5f64f69f65f10c0399f4c1c",
  },
} as const satisfies Record<string, FixtureMeta>;

/** Name of a committed fixture (keys of {@link FIXTURES}). */
export type FixtureName = keyof typeof FIXTURES;

/** Read a committed fixture's bytes as a `Uint8Array`. */
export function loadFixture(name: FixtureName): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURE_DIR, name)));
}
