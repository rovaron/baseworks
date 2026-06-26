"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications-api";

const KEYS = {
  list: ["notifications", "list"] as const,
  unread: ["notifications", "unread"] as const,
};

export function useNotifications() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: KEYS.list, queryFn: () => fetchNotifications(false) });
  const unread = useQuery({ queryKey: KEYS.unread, queryFn: fetchUnreadCount });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: KEYS.list });
    qc.invalidateQueries({ queryKey: KEYS.unread });
  };

  const readMut = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: invalidate,
  });
  const readAllMut = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: invalidate,
  });

  return {
    notifications: list.data ?? [],
    unreadCount: unread.data ?? 0,
    isLoading: list.isPending,
    markRead: (id: string) => readMut.mutateAsync(id),
    markAllRead: () => readAllMut.mutateAsync(),
    invalidate,
  };
}

export const NOTIFICATION_QUERY_KEYS = KEYS;
