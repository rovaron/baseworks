"use client";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@baseworks/ui";
import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useNotificationStream } from "@/hooks/use-notification-stream";
import { useNotifications } from "@/hooks/use-notifications";

export function NotificationBell() {
  const t = useTranslations("notifications");
  const router = useRouter();
  const { notifications, unreadCount, markRead, markAllRead, invalidate } = useNotifications();
  useNotificationStream(invalidate); // SSE → refetch list + unread

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t("bellLabel")}>
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-5 min-w-5 justify-center px-1 text-xs"
              aria-label={t("unreadLabel", { count: unreadCount })}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0">{t("title")}</DropdownMenuLabel>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-1 text-xs"
              onClick={() => markAllRead()}
            >
              {t("markAllRead")}
            </Button>
          )}
        </div>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          notifications.map((notif) => (
            <DropdownMenuItem
              key={notif.id}
              className={notif.readAt ? "opacity-60" : "font-medium"}
              onSelect={async () => {
                await markRead(notif.id);
                if (notif.url) router.push(notif.url);
              }}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm">{notif.title}</span>
                <span className="text-xs text-muted-foreground">{notif.body}</span>
              </div>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
