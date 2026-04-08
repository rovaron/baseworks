import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft } from "lucide-react";
import {
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
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);

  const { data: result, isLoading } = useQuery({
    queryKey: ["admin", "tenants", id],
    queryFn: async () => {
      const res = await (api.api.admin.tenants as any)({ id: id! }).get();
      return res.data;
    },
    enabled: !!id,
  });

  const tenant = result as any;
  const isDeactivated = tenant?.metadata?.deactivated;

  const toggleMutation = useMutation({
    mutationFn: async () => {
      await (api.api.admin.tenants as any)({ id: id! }).patch({
        metadata: isDeactivated
          ? { deactivated: false, reactivatedAt: new Date().toISOString() }
          : { deactivated: true, deactivatedAt: new Date().toISOString() },
      });
    },
    onSuccess: () => {
      toast.success(isDeactivated ? "Tenant reactivated" : "Tenant deactivated");
      queryClient.invalidateQueries({ queryKey: ["admin", "tenants"] });
      setShowDeactivateDialog(false);
    },
    onError: () => {
      toast.error("Failed to update tenant");
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => navigate("/tenants")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to tenants
        </Button>
        <p className="text-sm text-muted-foreground">Tenant not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/tenants")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <h1 className="text-2xl font-semibold">{tenant.name}</h1>
        {isDeactivated ? (
          <Badge variant="destructive">deactivated</Badge>
        ) : (
          <Badge variant="default">active</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Tenant Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Name</p>
              <p>{tenant.name}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Slug</p>
              <p className="break-all">{tenant.slug}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Created</p>
              <p>{formatDistanceToNow(new Date(tenant.createdAt), { addSuffix: true })}</p>
            </div>
            {tenant.memberCount !== undefined && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Members</p>
                <p>{tenant.memberCount}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              variant={isDeactivated ? "default" : "destructive"}
              className="w-full"
              onClick={() => setShowDeactivateDialog(true)}
            >
              {isDeactivated ? "Reactivate tenant" : "Deactivate tenant"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={showDeactivateDialog} onOpenChange={setShowDeactivateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isDeactivated ? "Reactivate tenant" : "Deactivate tenant"}
            </DialogTitle>
            <DialogDescription>
              {isDeactivated
                ? `Reactivating ${tenant.name} will restore access for all members.`
                : `Deactivating ${tenant.name} will prevent all members from accessing the platform. This can be reversed.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowDeactivateDialog(false)}>
              {isDeactivated ? "Cancel" : "Keep tenant active"}
            </Button>
            <Button
              variant={isDeactivated ? "default" : "destructive"}
              onClick={() => toggleMutation.mutate()}
              disabled={toggleMutation.isPending}
            >
              {toggleMutation.isPending
                ? "Updating..."
                : isDeactivated
                  ? "Reactivate tenant"
                  : "Deactivate tenant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
