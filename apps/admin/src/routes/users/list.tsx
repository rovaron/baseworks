import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { formatDistanceToNow } from "date-fns";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@baseworks/ui";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { DataTable } from "@/components/data-table";

interface User {
  id: string;
  name: string;
  email: string;
  image: string | null;
  createdAt: string;
  banned?: boolean;
  banReason?: string | null;
}

const PAGE_SIZE = 20;

export function Component() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [banTarget, setBanTarget] = useState<User | null>(null);
  const [impersonateTarget, setImpersonateTarget] = useState<User | null>(null);
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");

  const { data: result, isLoading } = useQuery({
    queryKey: ["admin", "users", page, search],
    queryFn: async () => {
      const res = await api.api.admin.users.get({
        query: { limit: PAGE_SIZE, offset: page * PAGE_SIZE, search },
      });
      return res.data;
    },
  });

  const banMutation = useMutation({
    mutationFn: async (user: User) => {
      const newBanned = !user.banned;
      await (api.api.admin.users as any)({ id: user.id }).patch({
        banned: newBanned,
        ...(newBanned ? { banReason: "Banned by admin" } : {}),
      });
    },
    onSuccess: (_, user) => {
      toast.success(user.banned ? t("users.toast.unbanned") : t("users.toast.banned"));
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setBanTarget(null);
    },
    onError: () => {
      toast.error(t("users.toast.updateFailed"));
    },
  });

  const impersonateMutation = useMutation({
    mutationFn: async (user: User) => {
      const res = await (api.api.admin.users as any)({ id: user.id }).impersonate.post({});
      return res.data;
    },
    onSuccess: () => {
      toast.success(t("users.toast.impersonationStarted"));
      setImpersonateTarget(null);
    },
    onError: () => {
      toast.error(t("users.toast.impersonationFailed"));
    },
  });

  const users = (result as any)?.data ?? [];
  const total = (result as any)?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: ColumnDef<User, any>[] = [
    {
      accessorKey: "name",
      header: t("users.columns.name"),
      enableSorting: true,
      meta: { priority: 1 },
    },
    {
      accessorKey: "email",
      header: t("users.columns.email"),
      enableSorting: false,
      meta: { priority: 2 },
    },
    {
      accessorKey: "createdAt",
      header: t("users.columns.created"),
      enableSorting: true,
      cell: ({ row }) => {
        const d = row.original.createdAt ? new Date(row.original.createdAt) : null;
        return d && !isNaN(d.getTime())
          ? formatDistanceToNow(d, { addSuffix: true })
          : "\u2014";
      },
      meta: { priority: 3 },
    },
    {
      id: "status",
      header: t("users.columns.status"),
      cell: ({ row }) =>
        row.original.banned ? (
          <Badge variant="destructive">{t("users.status.banned")}</Badge>
        ) : (
          <Badge variant="default">{t("users.status.active")}</Badge>
        ),
      meta: { priority: 1 },
    },
    {
      id: "actions",
      header: "",
      meta: { cardHidden: true },
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">{tc("openMenu")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => navigate(`/users/${row.original.id}`)}>
              {t("users.actions.viewDetails")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setImpersonateTarget(row.original)}>
              {t("users.actions.impersonate")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setBanTarget(row.original)}
              className={row.original.banned ? "" : "text-destructive"}
            >
              {row.original.banned ? t("users.actions.unbanUser") : t("users.actions.banUser")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("users.title")}</h1>

      {!isLoading && users.length === 0 && !search ? (
        <p className="text-sm text-muted-foreground py-12 text-center">
          {t("users.empty")}
        </p>
      ) : (
        <DataTable
          columns={columns}
          data={users}
          isLoading={isLoading}
          searchPlaceholder={t("users.searchPlaceholder")}
          searchValue={search}
          onSearchChange={setSearch}
          pageCount={pageCount}
          pageIndex={page}
          onPaginationChange={setPage}
        />
      )}

      {/* Ban/Unban Dialog */}
      <Dialog open={!!banTarget} onOpenChange={() => setBanTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{banTarget?.banned ? t("users.banDialog.unbanTitle") : t("users.banDialog.banTitle")}</DialogTitle>
            <DialogDescription>
              {banTarget?.banned
                ? t("users.banDialog.unbanDescription", { email: banTarget?.email })
                : t("users.banDialog.banDescription", { email: banTarget?.email })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setBanTarget(null)}>
              {banTarget?.banned ? tc("cancel") : t("users.banDialog.keepActive")}
            </Button>
            <Button
              variant={banTarget?.banned ? "default" : "destructive"}
              onClick={() => banTarget && banMutation.mutate(banTarget)}
              disabled={banMutation.isPending}
            >
              {banMutation.isPending
                ? t("users.banDialog.updating")
                : banTarget?.banned
                  ? t("users.actions.unbanUser")
                  : t("users.actions.banUser")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Impersonate Dialog */}
      <Dialog open={!!impersonateTarget} onOpenChange={() => setImpersonateTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("users.impersonateDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("users.impersonateDialog.description", { email: impersonateTarget?.email })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setImpersonateTarget(null)}>
              {t("users.impersonateDialog.returnToAdmin")}
            </Button>
            <Button
              onClick={() => impersonateTarget && impersonateMutation.mutate(impersonateTarget)}
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
