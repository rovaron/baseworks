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
