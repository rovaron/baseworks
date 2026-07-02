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

const n = () => api.api.notifications;

export async function fetchNotifications(unreadOnly = false): Promise<NotificationItem[]> {
  const res = await n().get({ query: { limit: 20, unreadOnly: String(unreadOnly) } });
  if (res.error) throw res.error;
  if (!res.data.success) throw new Error(res.data.error);
  return res.data.data;
}

export async function fetchUnreadCount(): Promise<number> {
  const res = await n()["unread-count"].get();
  if (res.error) throw res.error;
  if (!res.data.success) throw new Error(res.data.error);
  return res.data.data.unread;
}

export async function markNotificationRead(id: string): Promise<void> {
  const res = await n()({ id }).read.post();
  if (res.error) throw res.error;
}

export async function markAllNotificationsRead(): Promise<void> {
  const res = await n()["read-all"].post();
  if (res.error) throw res.error;
}

export interface NotificationPreference {
  category: string;
  label: string;
  email: boolean;
  mutable: boolean;
}

export async function fetchPreferences(): Promise<NotificationPreference[]> {
  const res = await n().preferences.get();
  if (res.error) throw res.error;
  if (!res.data.success) throw new Error(res.data.error);
  return res.data.data.preferences;
}

export async function savePreferences(
  prefs: Array<{ category: string; channel: "email"; enabled: boolean }>,
): Promise<void> {
  const res = await n().preferences.put({ preferences: prefs });
  if (res.error) throw res.error;
  if (!res.data.success) throw new Error(res.data.error);
}
