import { platformAdminRoles } from "@baseworks/api-client";
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@baseworks/ui";
import { type ReactNode, useEffect } from "react";
import { useNavigate } from "react-router";
import { auth } from "@/lib/api";

interface AuthGuardProps {
  children: ReactNode;
}

/**
 * Gates the admin dashboard on the PLATFORM-admin signal — the session user's
 * global `role` (managed by the better-auth admin plugin) — mirroring the server
 * guard `requirePlatformAdmin` and the admin plugin's `adminRoles`, all sourced
 * from `platformAdminRoles`.
 *
 * It deliberately does NOT consult organization membership/ownership: every user
 * owns a personal workspace (auto-created at signup), so an "is owner of any org"
 * check authorizes EVERY authenticated user — the pre-v1.5 model this replaces.
 * The role travels with the session, so there is no separate authorization
 * network call (and thus no transient "check failed" state to recover from):
 * once the session resolves we either have an admin or we don't.
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const navigate = useNavigate();
  const session = auth.useSession();

  useEffect(() => {
    if (session.isPending) return;
    if (!session.data?.user) {
      navigate("/login");
    }
  }, [session.isPending, session.data, navigate]);

  if (session.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-md space-y-4 p-8">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  // Unauthenticated — the effect above redirects to /login; render nothing meanwhile.
  if (!session.data?.user) {
    return null;
  }

  const role = (session.data.user as { role?: string | null }).role;
  const isAdmin = !!role && platformAdminRoles.includes(role);

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-sm text-center">
          <CardHeader>
            <CardTitle className="text-xl">Access Denied</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              You do not have admin privileges. Contact your system administrator.
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={async () => {
                await auth.signOut();
                navigate("/login");
              }}
            >
              Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
