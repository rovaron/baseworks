import { describe, expect, it, mock, spyOn } from "bun:test";
import { TypedEventBus } from "../event-bus";
import { logger } from "../../lib/logger";

describe("TypedEventBus", () => {
  it("should call registered subscriber when event is emitted", () => {
    const bus = new TypedEventBus();
    const handler = mock(() => {});

    bus.on("test.event", handler);
    bus.emit("test.event", { foo: "bar" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ foo: "bar" });
  });

  it("should catch sync subscriber errors without crashing", () => {
    const bus = new TypedEventBus();
    const errorSpy = spyOn(logger, "error").mockImplementation(() => {});

    bus.on("bad.event", () => {
      throw new Error("subscriber exploded");
    });

    // Should not throw
    expect(() => bus.emit("bad.event", {})).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("should catch async subscriber errors without crashing", async () => {
    const bus = new TypedEventBus();
    const errorSpy = spyOn(logger, "error").mockImplementation(() => {});

    bus.on("async.bad", async () => {
      throw new Error("async subscriber exploded");
    });

    // Should not throw
    expect(() => bus.emit("async.bad", {})).not.toThrow();

    // Wait for async error to be caught
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("TypedEventBus edge cases", () => {
  it("delivers event to multiple subscribers of the same event type", () => {
    const bus = new TypedEventBus();
    const handler1 = mock(() => {});
    const handler2 = mock(() => {});

    bus.on("multi.event", handler1);
    bus.on("multi.event", handler2);
    bus.emit("multi.event", { data: "shared" });

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler1).toHaveBeenCalledWith({ data: "shared" });
    expect(handler2).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledWith({ data: "shared" });
  });

  it("does not error when emitting with no subscribers", () => {
    const bus = new TypedEventBus();

    // Emitting an event with zero subscribers should be a no-op
    expect(() => bus.emit("no.subscribers", { payload: "ignored" })).not.toThrow();
  });

  it("isolates subscriber errors -- second handler still executes when first throws", () => {
    const bus = new TypedEventBus();
    const errorSpy = spyOn(logger, "error").mockImplementation(() => {});
    const secondHandler = mock(() => {});

    bus.on("isolate.event", () => {
      throw new Error("first handler explodes");
    });
    bus.on("isolate.event", secondHandler);

    expect(() => bus.emit("isolate.event", {})).not.toThrow();

    // The second handler should still have been called despite the first throwing
    expect(secondHandler).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("off does not remove user-provided callback due to wrapping", () => {
    // The TypedEventBus wraps handlers in on(), so off() with the original
    // function reference will not remove the wrapped listener. This test
    // documents that behavior.
    const bus = new TypedEventBus();
    const handler = mock(() => {});

    bus.on("off.test", handler);
    bus.off("off.test", handler); // This removes by reference, but the wrapper is different

    // Handler is still called because off() cannot match the wrapped function
    bus.emit("off.test", { data: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
