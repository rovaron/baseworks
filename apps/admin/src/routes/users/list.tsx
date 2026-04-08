import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { formatDistanceToNow } from "date-fns";
import { MoreHorizontal } from "lucide-react";
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
      toast.success(user.banned ? "User unbanned" : "User banned");
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setBanTarget(null);
    },
    onError: () => {
      toast.error("Failed to update user");
    },
  });

  const impersonateMutation = useMutation({
    mutationFn: async (user: User) => {
      const res = await (api.api.admin.users as any)({ id: user.id }).impersonate.post({});
      return res.data;
    },
    onSuccess: () => {
      toast.success("Impersonation started. Check the new session.");
      setImpersonateTarget(null);
    },
    onError: () => {
      toast.error("Failed to start impersonation");
    },
  });

  const users = (result as any)?.data ?? [];
  const total = (result as any)?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: ColumnDef<User, any>[] = [
    {
      accessorKey: "name",
      header: "Name",
      enableSorting: true,
      meta: { priority: 1 },
    },
    {
      accessorKey: "email",
      header: "Email",
      enableSorting: false,
      meta: { priority: 2 },
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      enableSorting: true,
      cell: ({ row }) =>
        formatDistanceToNow(new Date(row.original.createdAt), { addSuffix: true }),
      meta: { priority: 3 },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) =>
        row.original.banned ? (
          <Badge variant="destructive">banned</Badge>
        ) : (
          <Badge variant="default">active</Badge>
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
              <span className="sr-only">Open menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => navigate(`/users/${row.original.id}`)}>
              View details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setImpersonateTarget(row.original)}>
              Impersonate
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setBanTarget(row.original)}
              className={row.original.banned ? "" : "text-destructive"}
            >
              {row.original.banned ? "Unban user" : "Ban user"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Users</h1>

      {!isLoading && users.length === 0 && !search ? (
        <p className="text-sm text-muted-foreground py-12 text-center">
          No accounts registered yet. Users will appear here once they sign up.
        </p>
      ) : (
        <DataTable
          columns={columns}
          data={users}
          isLoading={isLoading}
          searchPlaceholder="Search users..."
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
            <DialogTitle>{banTarget?.banned ? "Unban user" : "Ban user"}</DialogTitle>
            <DialogDescription>
              {banTarget?.banned
                ? `Unbanning ${banTarget?.email} will restore their access to the platform.`
                : `Banning ${banTarget?.email} will immediately end their session and prevent login. This can be reversed.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setBanTarget(null)}>
              {banTarget?.banned ? "Cancel" : "Keep user active"}
            </Button>
            <Button
              variant={banTarget?.banned ? "default" : "destructive"}
              onClick={() => banTarget && banMutation.mutate(banTarget)}
              disabled={banMutation.isPending}
            >
              {banMutation.isPending
                ? "Updating..."
                : banTarget?.banned
                  ? "Unban user"
                  : "Ban user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Impersonate Dialog */}
      <Dialog open={!!impersonateTarget} onOpenChange={() => setImpersonateTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Impersonate user</DialogTitle>
            <DialogDescription>
              You are about to impersonate {impersonateTarget?.email}. All actions will be logged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setImpersonateTarget(null)}>
              Return to admin
            </Button>
            <Button
              onClick={() => impersonateTarget && impersonateMutation.mutate(impersonateTarget)}
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
