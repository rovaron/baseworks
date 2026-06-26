import { describe, expect, test } from "bun:test";
import { SseBridge } from "../bridge";

// Fake ioredis subscriber: records subscribe/unsubscribe, lets the test emit messages.
function fakeSub() {
  const handlers: Array<(ch: string, msg: string) => void> = [];
  const subscribed = new Set<string>();
  return {
    sub: {
      subscribe: async (ch: string) => {
        subscribed.add(ch);
      },
      unsubscribe: async (ch: string) => {
        subscribed.delete(ch);
      },
      on: (_e: string, h: (ch: string, msg: string) => void) => handlers.push(h),
    },
    emit: (ch: string, msg: string) => {
      if (subscribed.has(ch))
        for (const h of handlers) {
          h(ch, msg);
        }
    },
    subscribed,
  };
}

describe("SseBridge", () => {
  test("routes published messages to the channel's emitters; refcounted", async () => {
    const f = fakeSub();
    const bridge = new SseBridge(f.sub as any);
    const got: string[] = [];
    const unsub = await bridge.subscribe("notif:t:u", (m) => got.push(m));
    expect(f.subscribed.has("notif:t:u")).toBe(true);
    f.emit("notif:t:u", "hello");
    expect(got).toEqual(["hello"]);
    await unsub();
    expect(f.subscribed.has("notif:t:u")).toBe(false); // last subscriber gone
  });
});
