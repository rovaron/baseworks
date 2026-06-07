import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@baseworks/ui";
import { type ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { auth } from "@/lib/api";

interface AuthGuardProps {
  children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const navigate = useNavigate();
  const session = auth.useSession();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);
  // Third state: distinguishes "the authorization check failed" (transient,
  // recoverable) from "the user is genuinely not authorized" (fail-closed).
  const [checkError, setCheckError] = useState<unknown>(null);
  // Bumping this re-runs the effect so the "Retry" button can re-check access.
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (session.isPending) return;

    if (!session.data?.user) {
      navigate("/login");
      return;
    }

    let cancelled = false;
    setChecking(true);
    setCheckError(null);

    // Check if user has owner role on any organization.
    // organization.list() returns orgs without role info, so we need to
    // set each as active and check the member's role via getFullOrganization.
    auth.organization
      .list()
      .then(async (result: any) => {
        // A returned error is a check FAILURE, not an authorization denial —
        // throw so it lands in the catch and surfaces the retry card instead
        // of the permanent "Access Denied" screen.
        if (result.error) {
          throw result.error;
        }

        if (!result.data || result.data.length === 0) {
          if (cancelled) return;
          // Genuine no-orgs case -> fail closed.
          setIsAdmin(false);
          setChecking(false);
          return;
        }

        // Fetch each org's full membership in parallel rather than awaiting
        // them one-by-one, then check whether the user is an owner anywhere.
        const fullOrgs = await Promise.all(
          result.data.map((org: any) =>
            auth.organization.getFullOrganization({
              query: { organizationId: org.id },
            }),
          ),
        );

        if (cancelled) return;

        const userId = session.data!.user.id;
        const isOwner = fullOrgs.some((fullOrg) => {
          const member = fullOrg.data?.members.find((m: any) => m.userId === userId);
          return member?.role === "owner";
        });

        // Genuine non-owner case -> fail closed.
        setIsAdmin(isOwner);
        setChecking(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Log so support can diagnose, and surface a recoverable error state
        // rather than silently mapping a transient failure to "not authorized".
        console.error("AuthGuard org/role check failed", err);
        setCheckError(err);
        setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session.isPending, session.data, navigate, retryCount]);

  if (session.isPending || checking) {
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

  // The authorization check itself failed (network blip, 500, expired session
  // mid-check). Offer a retry instead of the permanent Access Denied screen.
  if (checkError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-sm text-center">
          <CardHeader>
            <CardTitle className="text-xl">Something went wrong</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              We could not verify your access. This may be a temporary problem. Please try again.
            </p>
            <Button
              className="w-full"
              onClick={() => {
                setCheckError(null);
                setChecking(true);
                setRetryCount((c) => c + 1);
              }}
            >
              Retry
            </Button>
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
