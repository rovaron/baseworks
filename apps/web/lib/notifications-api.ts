import { api } from "@/lib/api";

export interface NotificationItem {
  id: string;
  type: string;
  category: string;
  severity: "info" | "success" | "warning" | "error";
  title: string;
  body: string;
  url?: string | null;
  readAt?: string | null;
  createdAt: string;
}

const n = () => (api.api as any).notifications;

export async function fetchNotifications(unreadOnly = false): Promise<NotificationItem[]> {
  const res = await n().get({ query: { limit: 20, unreadOnly: String(unreadOnly) } });
  if (res.error) throw res.error;
  return (res.data?.data ?? res.data ?? []) as NotificationItem[];
}

export async function fetchUnreadCount(): Promise<number> {
  const res = await n()["unread-count"].get();
  if (res.error) throw res.error;
  return (res.data?.data?.unread ?? res.data?.unread ?? 0) as number;
}

export async function markNotificationRead(id: string): Promise<void> {
  const res = await n()({ id }).read.post();
  if (res.error) throw res.error;
}

export async function markAllNotificationsRead(): Promise<void> {
  const res = await n()["read-all"].post();
  if (res.error) throw res.error;
}
