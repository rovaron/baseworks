import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useNotificationStream } from "../use-notification-stream";

class FakeES {
  static last: FakeES | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  closed = false;
  constructor(
    public url: string,
    public init?: { withCredentials?: boolean },
  ) {
    FakeES.last = this;
  }
  close() {
    this.closed = true;
  }
}
// @ts-expect-error inject stub
globalThis.EventSource = FakeES;
afterEach(() => {
  FakeES.last = null;
});

describe("useNotificationStream", () => {
  test("opens a credentialed stream and forwards messages; closes on unmount", () => {
    const onMessage = vi.fn();
    const { unmount } = renderHook(() => useNotificationStream(onMessage));
    expect(FakeES.last?.init?.withCredentials).toBe(true);
    FakeES.last?.onmessage?.({ data: JSON.stringify({ type: "notification.created", id: "1" }) });
    expect(onMessage).toHaveBeenCalledTimes(1);
    unmount();
    expect(FakeES.last?.closed).toBe(true);
  });
});
