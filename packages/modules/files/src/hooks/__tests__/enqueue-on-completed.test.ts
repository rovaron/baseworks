/**
 * Phase 28 / IMG-01 — file.completed → image-transform enqueue subscriber tests.
 *
 * Verifies the two enqueue GATES in registerFilesHooks: (1) image MIME only,
 * (2) the relation must declare generateVariants.
 *
 * Mocking mirrors the proven billing on-tenant-created.test pattern: mock
 * `@baseworks/queue` with a `createQueue` spy so the REAL queue module (which
 * imports `wrapQueue` from `@baseworks/observability`) never evaluates — this
 * sidesteps the partial-observability-mock leak from sibling tests AND needs no
 * Redis. `@baseworks/db` is faked (the subscriber reads owner_module /
 * owner_record_type via raw SQL → the fake `execute` answers it); config +
 * observability are stubbed (getErrorTracker only used on the catch path).
 *
 * Cases:
 *   - non-image MIME               ⇒ no enqueue (GATE 1)
 *   - image, relation w/o variants ⇒ no enqueue (GATE 2)
 *   - image + relation w/ variants ⇒ enqueue("files:transform-image", {fileId,tenantId})
 *   - missing row                  ⇒ no enqueue (defensive)
 */

import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

// Spy for the lazily-created image-transform queue's add().
const queueAdd = mock(async () => ({ id: "job-1" }));
const createQueueSpy = mock(() => ({ add: queueAdd }));
const captureExceptionSpy = mock(() => {});

// Fake DB — enqueueTransform reads mime_type / owner_module / owner_record_type
// via raw SQL (the MIME gate is now driven by the authoritative row, not the
// event payload — see enqueueTransform in on-tenant-created.ts).
const state: {
  row: { mime_type: string; owner_module: string; owner_record_type: string } | null;
} = { row: null };
const fakeDb: any = {
  async execute() {
    return state.row ? [{ ...state.row }] : [];
  },
};

mock.module("@baseworks/config", () => ({
  env: { DATABASE_URL: "postgres://fake", REDIS_URL: "redis://localhost:6379" },
}));
mock.module("@baseworks/queue", () => ({ createQueue: createQueueSpy }));
mock.module("@baseworks/observability", () => ({
  getErrorTracker: () => ({ captureException: captureExceptionSpy }),
}));
mock.module("@baseworks/db", () => ({ getDb: () => fakeDb, files: {}, tenantStorageUsage: {} }));

const { registerFilesHooks } = await import("../on-tenant-created");
const { fileRelationsRegistry } = await import("@baseworks/storage");

// Two relations: one WITH variants, one WITHOUT.
fileRelationsRegistry.register("enq-img", "avatar", {
  recordType: "enq_avatar",
  allowedMimeTypes: ["image/png"],
  maxByteSize: 5_000_000,
  generateVariants: [{ name: "thumb", width: 50, format: "webp" }],
});
fileRelationsRegistry.register("enq-doc", "doc", {
  recordType: "enq_doc",
  allowedMimeTypes: ["image/png"],
  maxByteSize: 5_000_000,
  // no generateVariants
});

/** Capture the file.completed handler registerFilesHooks attaches. */
function getHandler(): (data: unknown) => Promise<void> {
  let captured: ((data: unknown) => Promise<void>) | undefined;
  registerFilesHooks({
    on: (event, handler) => {
      if (event === "file.completed") captured = handler;
    },
  });
  if (!captured) throw new Error("file.completed handler was not registered");
  return captured;
}

function seedRow(
  ownerModule: string,
  recordType: string,
  mimeType: string,
): { fileId: string; tenantId: string } {
  state.row = { mime_type: mimeType, owner_module: ownerModule, owner_record_type: recordType };
  return { fileId: crypto.randomUUID(), tenantId: `enq28_${crypto.randomUUID().slice(0, 8)}` };
}

let handler: (data: unknown) => Promise<void>;
beforeAll(() => {
  handler = getHandler();
});
afterEach(() => {
  queueAdd.mockClear();
  createQueueSpy.mockClear();
  captureExceptionSpy.mockClear();
  state.row = null;
});

describe("file.completed enqueue subscriber", () => {
  test("GATE 1: non-image MIME does not enqueue", async () => {
    const { fileId, tenantId } = seedRow("enq-img", "enq_avatar", "application/pdf");
    await handler({ fileId, tenantId, byteSize: 4, mimeType: "application/pdf" });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  test("GATE 2: image whose relation declares no variants does not enqueue", async () => {
    const { fileId, tenantId } = seedRow("enq-doc", "enq_doc", "image/png");
    await handler({ fileId, tenantId, byteSize: 4, mimeType: "image/png" });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  test("image + relation with variants enqueues files:transform-image", async () => {
    const { fileId, tenantId } = seedRow("enq-img", "enq_avatar", "image/png");
    await handler({ fileId, tenantId, byteSize: 4, mimeType: "image/png" });
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(queueAdd).toHaveBeenCalledWith("files:transform-image", { fileId, tenantId });
  });

  test("missing row does not enqueue (defensive)", async () => {
    state.row = null;
    await handler({
      fileId: crypto.randomUUID(),
      tenantId: "enq28_nope",
      byteSize: 4,
      mimeType: "image/png",
    });
    expect(queueAdd).not.toHaveBeenCalled();
  });
});
