/** Minimal subset of ioredis used by the bridge (a DEDICATED subscriber connection). */
export interface Subscriber {
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  on(event: "message", handler: (channel: string, message: string) => void): unknown;
}

type Emit = (message: string) => void;

/**
 * One shared ioredis subscriber per process, multiplexed across users via a
 * refcounted per-channel emitter set. The SSE route registers an emitter for
 * `notif:{tenantId}:{userId}`; the in-app adapter's publish (any instance)
 * arrives here and is fanned out to that user's open streams. Pass a DEDICATED
 * connection (ioredis enters subscriber mode): `getRedisConnection(url).duplicate()`.
 */
export class SseBridge {
  private readonly channels = new Map<string, Set<Emit>>();
  private wired = false;
  constructor(private readonly sub: Subscriber) {}

  private wire() {
    if (this.wired) return;
    this.sub.on("message", (channel, message) => {
      for (const emit of this.channels.get(channel) ?? []) emit(message);
    });
    this.wired = true;
  }

  /** Register an emitter for a channel; returns an unsubscribe fn. */
  async subscribe(channel: string, emit: Emit): Promise<() => Promise<void>> {
    this.wire();
    let set = this.channels.get(channel);
    if (!set) {
      set = new Set();
      this.channels.set(channel, set);
      await this.sub.subscribe(channel);
    }
    set.add(emit);
    return async () => {
      const s = this.channels.get(channel);
      if (!s) return;
      s.delete(emit);
      if (s.size === 0) {
        this.channels.delete(channel);
        await this.sub.unsubscribe(channel);
      }
    };
  }
}
