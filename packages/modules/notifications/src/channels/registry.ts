// packages/modules/notifications/src/channels/registry.ts
import type { Channel, ChannelAdapter } from "./channel";

const adapters = new Map<Channel, ChannelAdapter>();
export function registerAdapter(a: ChannelAdapter): void {
  adapters.set(a.name, a);
}
export function getAdapter(channel: Channel): ChannelAdapter | undefined {
  return adapters.get(channel);
}
export function registeredChannels(): Channel[] {
  return [...adapters.keys()];
}
