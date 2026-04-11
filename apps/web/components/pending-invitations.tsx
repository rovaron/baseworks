"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Mail, X, Loader2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@baseworks/ui";
import { api } from "@/lib/api";

const isLinkInvite = (email: string) => email.endsWith("@internal");

const roleBadgeVariant = {
  admin: "secondary",
  member: "default",
} as const;

export function PendingInvitations() {
  const t = useTranslations("invite");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const [cancelTarget, setCancelTarget] = useState<{ id: string; email: string } | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const invitationsQuery = useQuery({
    queryKey: ["invitations"],
    queryFn: async () => {
      const { data, error } = await api.api.invitations.get();
      if (error) throw error;
      return data;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await (api.api.invitations as any)[invitationId].delete();
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("pending.cancelled"));
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
      setCancelTarget(null);
    },
    onError: () => {
      toast.error(tc("error"));
    },
  });

  const resendMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      setResendingId(invitationId);
      const { error } = await (api.api.invitations as any)[invitationId].resend.post();
      if (error) throw error;
    },
    onSuccess: (_data: any, invitationId: string) => {
      // Find the invitation to get the email for the toast
      const invitations = (invitationsQuery.data as any)?.data ?? [];
      const inv = invitations.find((i: any) => i.id === invitationId);
      const email = inv?.email ?? "";
      toast.success(t("pending.resent", { email }));
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
    },
    onError: () => {
      toast.error(tc("error"));
    },
    onSettled: () => setResendingId(null),
  });

  if (invitationsQuery.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
        <span className="sr-only">{tc("loading")}</span>
      </div>
    );
  }

  const invitations = (invitationsQuery.data as any)?.data ?? [];

  if (!Array.isArray(invitations) || invitations.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="font-medium">{t("pending.empty")}</p>
          <p className="text-sm text-muted-foreground">{t("pending.emptyDescription")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t("dialog.emailLabel")}</TableHead>
            <TableHead scope="col">{t("dialog.roleLabel")}</TableHead>
            <TableHead scope="col" className="hidden sm:table-cell">
              {t("dialog.modeLabel")}
            </TableHead>
            <TableHead scope="col" className="w-[100px]">
              <span className="sr-only">{tc("actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invitations.map((invitation: any) => {
            const isLink = isLinkInvite(invitation.email);
            const role: string = invitation.role ?? "member";

            return (
              <TableRow key={invitation.id}>
                <TableCell>
                  {isLink ? (
                    <span className="text-muted-foreground">{t("pending.typeLink")}</span>
                  ) : (
                    invitation.email
                  )}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      roleBadgeVariant[role as keyof typeof roleBadgeVariant] ?? "default"
                    }
                  >
                    {t(`roles.${role}` as any)}
                  </Badge>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <span className="text-xs text-muted-foreground">
                    {isLink ? t("pending.typeLink") : t("pending.typeEmail")}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {!isLink && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => resendMutation.mutate(invitation.id)}
                            disabled={resendingId === invitation.id}
                          >
                            {resendingId === invitation.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Mail className="h-4 w-4" />
                            )}
                            <span className="sr-only">{t("actions.resendInvite")}</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("actions.resendInvite")}</TooltipContent>
                      </Tooltip>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive"
                          onClick={() =>
                            setCancelTarget({
                              id: invitation.id,
                              email: isLink ? t("pending.typeLink") : invitation.email,
                            })
                          }
                        >
                          <X className="h-4 w-4" />
                          <span className="sr-only">{t("actions.cancelInvitation")}</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("actions.cancelInvitation")}</TooltipContent>
                    </Tooltip>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Dialog
        open={!!cancelTarget}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cancel.confirmTitle")}</DialogTitle>
            <DialogDescription>{t("cancel.confirmBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setCancelTarget(null)}>
              {tc("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (cancelTarget) {
                  cancelMutation.mutate(cancelTarget.id);
                }
              }}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("cancel.confirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
