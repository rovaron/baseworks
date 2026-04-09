import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from "@baseworks/ui";
import { toast } from "sonner";
import { api } from "@/lib/api";

export function Component() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showBanDialog, setShowBanDialog] = useState(false);
  const [showImpersonateDialog, setShowImpersonateDialog] = useState(false);
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");

  const { data: result, isLoading } = useQuery({
    queryKey: ["admin", "users", id],
    queryFn: async () => {
      const res = await (api.api.admin.users as any)({ id: id! }).get();
      return res.data;
    },
    enabled: !!id,
  });

  const user = result as any;
  const isBanned = user?.banned;

  const banMutation = useMutation({
    mutationFn: async () => {
      const newBanned = !isBanned;
      await (api.api.admin.users as any)({ id: id! }).patch({
        banned: newBanned,
        ...(newBanned ? { banReason: "Banned by admin" } : {}),
      });
    },
    onSuccess: () => {
      toast.success(isBanned ? t("users.toast.unbanned") : t("users.toast.banned"));
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setShowBanDialog(false);
    },
    onError: () => {
      toast.error(t("users.toast.updateFailed"));
    },
  });

  const impersonateMutation = useMutation({
    mutationFn: async () => {
      const res = await (api.api.admin.users as any)({ id: id! }).impersonate.post({});
      return res.data;
    },
    onSuccess: () => {
      toast.success(t("users.toast.impersonationStarted"));
      setShowImpersonateDialog(false);
    },
    onError: () => {
      toast.error(t("users.toast.impersonationFailed"));
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => navigate("/users")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("users.detail.backToUsers")}
        </Button>
        <p className="text-sm text-muted-foreground">{t("users.detail.notFound")}</p>
      </div>
    );
  }

  const initials = (user.name || user.email || "U")
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/users")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {tc("back")}
        </Button>
        <h1 className="min-w-0 truncate text-2xl font-semibold">{user.name || user.email}</h1>
        {isBanned ? (
          <Badge variant="destructive">{t("users.status.banned")}</Badge>
        ) : (
          <Badge variant="default">{t("users.status.active")}</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("users.detail.userInfo")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                {user.image && <AvatarImage src={user.image} alt={user.name} />}
                <AvatarFallback className="text-lg">{initials}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium">{user.name}</p>
                <p className="text-sm text-muted-foreground">{user.email}</p>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">{t("users.detail.created")}</p>
              <p>{(() => {
                const d = user.createdAt ? new Date(user.createdAt) : null;
                return d && !isNaN(d.getTime())
                  ? formatDistanceToNow(d, { addSuffix: true })
                  : "\u2014";
              })()}</p>
            </div>
            {isBanned && user.banReason && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t("users.detail.banReason")}</p>
                <p>{user.banReason}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {user.memberships && user.memberships.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t("users.detail.memberships")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {user.memberships.map((m: any) => (
                    <div key={m.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">{m.organizationName || m.organizationId}</span>
                      <Badge variant="secondary" className="shrink-0">{m.role}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t("users.detail.actions")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                variant={isBanned ? "default" : "destructive"}
                className="w-full"
                onClick={() => setShowBanDialog(true)}
              >
                {isBanned ? t("users.actions.unbanUser") : t("users.actions.banUser")}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowImpersonateDialog(true)}
              >
                {t("users.actions.impersonate")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Ban/Unban Dialog */}
      <Dialog open={showBanDialog} onOpenChange={setShowBanDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isBanned ? t("users.banDialog.unbanTitle") : t("users.banDialog.banTitle")}</DialogTitle>
            <DialogDescription>
              {isBanned
                ? t("users.banDialog.unbanDescription", { email: user.email })
                : t("users.banDialog.banDescription", { email: user.email })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowBanDialog(false)}>
              {isBanned ? tc("cancel") : t("users.banDialog.keepActive")}
            </Button>
            <Button
              variant={isBanned ? "default" : "destructive"}
              onClick={() => banMutation.mutate()}
              disabled={banMutation.isPending}
            >
              {banMutation.isPending
                ? t("users.banDialog.updating")
                : isBanned
                  ? t("users.actions.unbanUser")
                  : t("users.actions.banUser")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Impersonate Dialog */}
      <Dialog open={showImpersonateDialog} onOpenChange={setShowImpersonateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("users.impersonateDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("users.impersonateDialog.description", { email: user.email })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowImpersonateDialog(false)}>
              {t("users.impersonateDialog.returnToAdmin")}
            </Button>
            <Button
              onClick={() => impersonateMutation.mutate()}
              disabled={impersonateMutation.isPending}
            >
              {impersonateMutation.isPending ? t("users.impersonateDialog.starting") : t("users.impersonateDialog.startImpersonation")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
