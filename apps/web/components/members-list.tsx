"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { MoreHorizontal } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
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
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@baseworks/ui";
import { auth } from "@/lib/api";
import { useTenant } from "@/components/tenant-provider";

const roleBadgeVariant = {
  owner: "outline",
  admin: "secondary",
  member: "default",
} as const;

function getInitials(name: string | undefined | null, email: string | undefined | null): string {
  if (name) {
    return name
      .split(" ")
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }
  if (email) {
    return email[0].toUpperCase();
  }
  return "?";
}

export function MembersList() {
  const t = useTranslations("invite");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const { activeTenant } = useTenant();
  const [removeTarget, setRemoveTarget] = useState<{
    memberId: string;
    name: string;
  } | null>(null);

  const membersQuery = useQuery({
    queryKey: ["members", activeTenant?.id],
    queryFn: async () => {
      if (!activeTenant?.id) return [];
      const result = await auth.organization.getFullOrganization({
        query: { organizationId: activeTenant.id },
      });
      return (result.data as any)?.members ?? [];
    },
    enabled: !!activeTenant?.id,
  });

  const removeMutation = useMutation({
    mutationFn: async (memberIdOrEmail: string) => {
      await auth.organization.removeMember({
        memberIdOrEmail,
        organizationId: activeTenant!.id,
      });
    },
    onSuccess: () => {
      toast.success(t("members.removed"));
      queryClient.invalidateQueries({ queryKey: ["members"] });
      setRemoveTarget(null);
    },
    onError: () => {
      toast.error(tc("error"));
    },
  });

  const currentSession = auth.useSession();
  const currentUserId = (currentSession.data as any)?.user?.id;

  if (membersQuery.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
        <span className="sr-only">{tc("loading")}</span>
      </div>
    );
  }

  const members = (membersQuery.data as any[]) ?? [];

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t("members.title")}</TableHead>
            <TableHead scope="col" className="hidden sm:table-cell">
              {t("roles.admin")}
            </TableHead>
            <TableHead scope="col" className="w-[50px]">
              <span className="sr-only">{tc("actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member: any) => {
            const user = member.user ?? {};
            const role: string = member.role ?? "member";
            const isCurrentUser = user.id === currentUserId;
            const isOwner = role === "owner";
            const canRemove = !isCurrentUser && !isOwner;

            return (
              <TableRow key={member.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs">
                        {getInitials(user.name, user.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{user.name ?? user.email}</p>
                      {user.name && user.email && (
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      )}
                    </div>
                    <Badge
                      variant={
                        roleBadgeVariant[role as keyof typeof roleBadgeVariant] ?? "default"
                      }
                      className="ml-auto sm:hidden"
                    >
                      {t(`roles.${role}` as any)}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Badge
                    variant={
                      roleBadgeVariant[role as keyof typeof roleBadgeVariant] ?? "default"
                    }
                  >
                    {t(`roles.${role}` as any)}
                  </Badge>
                </TableCell>
                <TableCell>
                  {canRemove && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">{tc("actions")}</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            setRemoveTarget({
                              memberId: member.id,
                              name: user.name ?? user.email ?? "",
                            })
                          }
                          className="text-destructive"
                        >
                          {t("members.removeMember")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Dialog
        open={!!removeTarget}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("members.removeConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("members.removeConfirmBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>
              {tc("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (removeTarget) {
                  removeMutation.mutate(removeTarget.memberId);
                }
              }}
              disabled={removeMutation.isPending}
            >
              {t("members.removeConfirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
