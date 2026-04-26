import { describe, test, expect, beforeEach, mock } from "bun:test";

// Mock ioredis before importing our modules
const mockQuit = mock(() => Promise.resolve("OK"));

class MockIORedis {
  options: any;
  url: string;
  quit = mockQuit;
  status = "ready";
  constructor(url: string, opts: any) {
    this.url = url;
    this.options = opts;
  }
}

mock.module("ioredis", () => ({
  default: MockIORedis,
}));

// Mock bullmq Queue and Worker
const mockQueueInstances: any[] = [];
const mockWorkerInstances: any[] = [];

mock.module("bullmq", () => ({
  Queue: class MockQueue {
    name: string;
    opts: any;
    constructor(name: string, opts: any) {
      this.name = name;
      this.opts = opts;
      mockQueueInstances.push(this);
    }
    // Phase 20: createQueue now wraps via wrapQueue which binds queue.add /
    // queue.addBulk. Stub them on the mock so wrapQueue's `.bind(queue)` calls
    // resolve. The unit tests in this file only check Queue config (name + opts),
    // not enqueue behavior — so simple no-op async stubs suffice.
    async add(_name: string, _data: any, _opts?: any) {
      return { id: "mock-job", name: _name, data: _data };
    }
    async addBulk(_jobs: Array<{ name: string; data: any; opts?: any }>) {
      return _jobs.map((j, i) => ({ id: `mock-bulk-${i}`, name: j.name, data: j.data }));
    }
  },
  Worker: class MockWorker {
    name: string;
    processor: any;
    opts: any;
    private handlers = new Map<string, Function>();
    constructor(name: string, processor: any, opts: any) {
      this.name = name;
      this.processor = processor;
      this.opts = opts;
      mockWorkerInstances.push(this);
    }
    on(event: string, handler: Function) {
      this.handlers.set(event, handler);
    }
    async close() {}
  },
}));

// Import after mocking
const { getRedisConnection, closeConnection, createQueue, createWorker } = await import("../index");

describe("Queue Infrastructure", () => {
  beforeEach(() => {
    mockQueueInstances.length = 0;
    mockWorkerInstances.length = 0;
    mockQuit.mockClear();
  });

  describe("getRedisConnection", () => {
    test("returns an IORedis instance with maxRetriesPerRequest null", async () => {
      // Reset connection state
      await closeConnection();

      const conn = getRedisConnection("redis://localhost:6379");
      expect(conn).toBeDefined();
      expect(conn.options).toBeDefined();
      expect(conn.options.maxRetriesPerRequest).toBeNull();
    });

    test("returns same instance for same URL (singleton)", async () => {
      await closeConnection();

      const conn1 = getRedisConnection("redis://localhost:6379");
      const conn2 = getRedisConnection("redis://localhost:6379");
      expect(conn1).toBe(conn2);
    });

    test("creates new instance for different URL", async () => {
      await closeConnection();

      const conn1 = getRedisConnection("redis://localhost:6379");
      const conn2 = getRedisConnection("redis://localhost:6380");
      expect(conn1).not.toBe(conn2);
    });
  });

  describe("closeConnection", () => {
    test("calls quit on the connection", async () => {
      await closeConnection();
      mockQuit.mockClear();

      getRedisConnection("redis://localhost:6379");
      await closeConnection();
      expect(mockQuit).toHaveBeenCalledTimes(1);
    });

    test("after close, next getRedisConnection creates a new instance", async () => {
      await closeConnection();

      const conn1 = getRedisConnection("redis://localhost:6379");
      await closeConnection();
      const conn2 = getRedisConnection("redis://localhost:6379");
      expect(conn1).not.toBe(conn2);
    });
  });

  describe("createQueue", () => {
    test("returns a Queue instance with correct name", async () => {
      await closeConnection();

      const queue = createQueue("test-queue", "redis://localhost:6379");
      expect(queue.name).toBe("test-queue");
    });

    test("sets defaultJobOptions with attempts 3", async () => {
      await closeConnection();

      const queue = createQueue("test-queue", "redis://localhost:6379");
      expect(queue.opts.defaultJobOptions.attempts).toBe(3);
    });

    test("sets removeOnComplete age to 3 days (259200s)", async () => {
      await closeConnection();

      const queue = createQueue("test-queue", "redis://localhost:6379");
      expect(queue.opts.defaultJobOptions.removeOnComplete.age).toBe(259200);
    });

    test("sets removeOnFail age to 7 days (604800s)", async () => {
      await closeConnection();

      const queue = createQueue("test-queue", "redis://localhost:6379");
      expect(queue.opts.defaultJobOptions.removeOnFail.age).toBe(604800);
    });

    test("sets exponential backoff with 1000ms delay", async () => {
      await closeConnection();

      const queue = createQueue("test-queue", "redis://localhost:6379");
      expect(queue.opts.defaultJobOptions.backoff).toEqual({
        type: "exponential",
        delay: 1000,
      });
    });
  });

  describe("createWorker", () => {
    test("returns a Worker instance with correct name", async () => {
      await closeConnection();

      const processor = async () => {};
      const worker = createWorker("test-queue", processor, "redis://localhost:6379");
      expect(worker.name).toBe("test-queue");
    });

    test("defaults concurrency to 5 when not specified", async () => {
      await closeConnection();

      const processor = async () => {};
      const worker = createWorker("test-queue", processor, "redis://localhost:6379");
      expect(worker.opts.concurrency).toBe(5);
    });

    test("applies custom concurrency when specified", async () => {
      await closeConnection();

      const processor = async () => {};
      const worker = createWorker("test-queue", processor, "redis://localhost:6379", {
        concurrency: 10,
      });
      expect(worker.opts.concurrency).toBe(10);
    });

    test("does not use worker threads (inline processor only)", async () => {
      await closeConnection();

      const processor = async () => {};
      const worker = createWorker("test-queue", processor, "redis://localhost:6379");
      expect(worker.opts.useWorkerThreads).toBeUndefined();
    });
  });
});
