import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Skeleton,
} from "@baseworks/ui";
import { auth } from "@/lib/api";

interface AuthGuardProps {
  children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const navigate = useNavigate();
  const session = auth.useSession();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (session.isPending) return;

    if (!session.data?.user) {
      navigate("/login");
      return;
    }

    // Check if user has owner role on any organization.
    // organization.list() returns orgs without role info, so we need to
    // set each as active and check the member's role via getFullOrganization.
    auth.organization
      .list()
      .then(async (result) => {
        if (result.error || !result.data || result.data.length === 0) {
          setIsAdmin(false);
          setChecking(false);
          return;
        }

        // Check each org for owner role
        for (const org of result.data) {
          const fullOrg = await auth.organization.getFullOrganization({
            query: { organizationId: org.id },
          });
          if (fullOrg.data) {
            const userId = session.data!.user.id;
            const member = fullOrg.data.members.find(
              (m: any) => m.userId === userId,
            );
            if (member?.role === "owner") {
              setIsAdmin(true);
              setChecking(false);
              return;
            }
          }
        }

        setIsAdmin(false);
        setChecking(false);
      })
      .catch(() => {
        setIsAdmin(false);
        setChecking(false);
      });
  }, [session.isPending, session.data, navigate]);

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
