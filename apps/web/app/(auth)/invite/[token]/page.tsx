"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Loader2, AlertCircle } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from "@baseworks/ui";
import { auth } from "@/lib/api";
import { env } from "@/lib/env";

interface InvitationData {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  status: string;
  inviterId: string;
  organization: { name: string };
  inviter: { user: { name: string; email: string } };
}

function getOrgInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export default function InviteAcceptPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations("invite");
  const tc = useTranslations("common");

  const token = params.token;

  const [isAccepting, setIsAccepting] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const [showDeclineDialog, setShowDeclineDialog] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [alreadyMember, setAlreadyMember] = useState(false);

  const session = auth.useSession();
  const isLoggedIn = !!session.data?.user;
  const isSessionLoading = session.isPending;

  const {
    data: invitation,
    isLoading: isInvitationLoading,
    isError,
  } = useQuery<InvitationData>({
    queryKey: ["invitation", token],
    queryFn: async () => {
      const res = await fetch(
        `${env.NEXT_PUBLIC_API_URL}/api/invitations/${token}`
      );
      if (!res.ok) {
        throw new Error("invalid");
      }
      return res.json();
    },
    retry: false,
  });

  const isLoading = isSessionLoading || isInvitationLoading;
  const isInvalid = isError || (invitation && invitation.status !== "pending");

  async function handleAccept() {
    if (!invitation) return;
    setIsAccepting(true);
    try {
      await auth.organization.acceptInvitation({ invitationId: token });
      await auth.organization.setActive({
        organizationId: invitation.organizationId,
      });
      queryClient.invalidateQueries();
      router.push("/dashboard");
    } catch (error: any) {
      const message = error?.message || "";
      if (
        message.toLowerCase().includes("already a member") ||
        message.toLowerCase().includes("already member")
      ) {
        setAlreadyMember(true);
      }
      setIsAccepting(false);
    }
  }

  async function handleDeclineConfirm() {
    setIsDeclining(true);
    try {
      await auth.organization.rejectInvitation({ invitationId: token });
      setDeclined(true);
    } catch {
      // Error declining -- still close dialog
    } finally {
      setIsDeclining(false);
      setShowDeclineDialog(false);
    }
  }

  // Loading state
  if (isLoading) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <Skeleton className="h-16 w-16 rounded-full" />
          <Skeleton className="mt-4 h-7 w-48" />
          <Skeleton className="mt-2 h-5 w-64" />
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-6 w-20" />
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardFooter>
      </Card>
    );
  }

  // Invalid / expired / already used token
  if (isInvalid && !alreadyMember) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <h1 className="mt-4 text-2xl font-semibold leading-none tracking-tight">
            {t("accept.invalidTitle")}
          </h1>
          <CardDescription>{t("accept.invalidBody")}</CardDescription>
        </CardHeader>
        <CardFooter className="justify-center">
          <Button variant="outline" onClick={() => router.push("/")}>
            {t("accept.goHome")}
          </Button>
        </CardFooter>
      </Card>
    );
  }

  // Already a member
  if (alreadyMember) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <h1 className="text-2xl font-semibold leading-none tracking-tight">
            {t("accept.alreadyMember")}
          </h1>
        </CardHeader>
        <CardFooter className="justify-center">
          <Button onClick={() => router.push("/dashboard")}>
            {t("accept.goToDashboard")}
          </Button>
        </CardFooter>
      </Card>
    );
  }

  // Declined state
  if (declined) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <h1 className="text-2xl font-semibold leading-none tracking-tight">
            {t("accept.declined")}
          </h1>
        </CardHeader>
        <CardFooter className="justify-center">
          <Button variant="outline" onClick={() => router.push("/")}>
            {t("accept.goHome")}
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (!invitation) return null;

  const orgName = invitation.organization.name;
  const inviterName =
    invitation.inviter.user.name || invitation.inviter.user.email;
  const invitedEmail = invitation.email;

  // Logged in -- show accept/decline
  if (isLoggedIn) {
    return (
      <>
        <Card className="w-full max-w-md">
          <CardHeader className="items-center text-center">
            <Avatar className="h-16 w-16">
              <AvatarFallback className="text-xl">
                {getOrgInitials(orgName)}
              </AvatarFallback>
            </Avatar>
            <h1 className="mt-4 text-2xl font-semibold leading-none tracking-tight">
              {orgName}
            </h1>
            <CardDescription>
              {t("accept.invitedBy", { name: inviterName, orgName })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {t("accept.roleAssigned")}
            </span>
            <Badge variant="secondary">{t(`roles.${invitation.role}` as any)}</Badge>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button
              className="w-full"
              onClick={handleAccept}
              disabled={isAccepting || isDeclining}
            >
              {isAccepting && <Loader2 className="mr-2 animate-spin" />}
              {t("actions.accept")}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setShowDeclineDialog(true)}
              disabled={isAccepting || isDeclining}
            >
              {t("actions.decline")}
            </Button>
          </CardFooter>
        </Card>

        <Dialog open={showDeclineDialog} onOpenChange={setShowDeclineDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("accept.declineConfirmTitle")}</DialogTitle>
              <DialogDescription>
                {t("accept.declineConfirmBody")}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowDeclineDialog(false)}
                disabled={isDeclining}
              >
                {tc("cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeclineConfirm}
                disabled={isDeclining}
              >
                {isDeclining && <Loader2 className="mr-2 animate-spin" />}
                {t("accept.declineConfirmButton")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Not logged in -- show login/signup options
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="items-center text-center">
        <Avatar className="h-16 w-16">
          <AvatarFallback className="text-xl">
            {getOrgInitials(orgName)}
          </AvatarFallback>
        </Avatar>
        <h1 className="mt-4 text-2xl font-semibold leading-none tracking-tight">
          {orgName}
        </h1>
        <CardDescription>
          {t("accept.invitedBy", { name: inviterName, orgName })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {t("accept.roleAssigned")}
        </span>
        <Badge variant="secondary">{t(`roles.${invitation.role}` as any)}</Badge>
      </CardContent>
      <CardFooter className="flex flex-col gap-3">
        <Button
          className="w-full"
          onClick={() => router.push(`/login?invite=${token}`)}
        >
          {t("actions.loginToAccept")}
        </Button>
        <Button
          variant="outline"
          className="w-full"
          onClick={() =>
            router.push(
              `/signup?invite=${token}&email=${encodeURIComponent(invitedEmail)}`
            )
          }
        >
          {t("actions.createAccountToJoin")}
        </Button>
      </CardFooter>
    </Card>
  );
}
