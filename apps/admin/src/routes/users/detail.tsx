import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft } from "lucide-react";
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
      toast.success(isBanned ? "User unbanned" : "User banned");
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setShowBanDialog(false);
    },
    onError: () => {
      toast.error("Failed to update user");
    },
  });

  const impersonateMutation = useMutation({
    mutationFn: async () => {
      const res = await (api.api.admin.users as any)({ id: id! }).impersonate.post({});
      return res.data;
    },
    onSuccess: () => {
      toast.success("Impersonation started. Check the new session.");
      setShowImpersonateDialog(false);
    },
    onError: () => {
      toast.error("Failed to start impersonation");
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
          Back to users
        </Button>
        <p className="text-sm text-muted-foreground">User not found.</p>
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
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/users")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <h1 className="text-2xl font-semibold">{user.name || user.email}</h1>
        {isBanned ? (
          <Badge variant="destructive">banned</Badge>
        ) : (
          <Badge variant="default">active</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>User Information</CardTitle>
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
              <p className="text-sm font-medium text-muted-foreground">Created</p>
              <p>{formatDistanceToNow(new Date(user.createdAt), { addSuffix: true })}</p>
            </div>
            {isBanned && user.banReason && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Ban reason</p>
                <p>{user.banReason}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {user.memberships && user.memberships.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Organization Memberships</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {user.memberships.map((m: any) => (
                    <div key={m.id} className="flex items-center justify-between">
                      <span>{m.organizationName || m.organizationId}</span>
                      <Badge variant="secondary">{m.role}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                variant={isBanned ? "default" : "destructive"}
                className="w-full"
                onClick={() => setShowBanDialog(true)}
              >
                {isBanned ? "Unban user" : "Ban user"}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowImpersonateDialog(true)}
              >
                Impersonate
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Ban/Unban Dialog */}
      <Dialog open={showBanDialog} onOpenChange={setShowBanDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isBanned ? "Unban user" : "Ban user"}</DialogTitle>
            <DialogDescription>
              {isBanned
                ? `Unbanning ${user.email} will restore their access to the platform.`
                : `Banning ${user.email} will immediately end their session and prevent login. This can be reversed.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowBanDialog(false)}>
              {isBanned ? "Cancel" : "Keep user active"}
            </Button>
            <Button
              variant={isBanned ? "default" : "destructive"}
              onClick={() => banMutation.mutate()}
              disabled={banMutation.isPending}
            >
              {banMutation.isPending
                ? "Updating..."
                : isBanned
                  ? "Unban user"
                  : "Ban user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Impersonate Dialog */}
      <Dialog open={showImpersonateDialog} onOpenChange={setShowImpersonateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Impersonate user</DialogTitle>
            <DialogDescription>
              You are about to impersonate {user.email}. All actions will be logged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowImpersonateDialog(false)}>
              Return to admin
            </Button>
            <Button
              onClick={() => impersonateMutation.mutate()}
              disabled={impersonateMutation.isPending}
            >
              {impersonateMutation.isPending ? "Starting..." : "Start impersonation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
