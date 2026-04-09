import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@baseworks/ui";
import { useIsMobile } from "@baseworks/ui/hooks/use-mobile";
import { api } from "@/lib/api";

export function Component() {
  const {
    data: result,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["admin", "billing", "overview"],
    queryFn: async () => {
      const res = await api.api.admin.billing.overview.get();
      return res.data;
    },
  });

  const isMobile = useIsMobile();

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Billing Overview</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground mb-4">
              Failed to load data. Check the API server status and try again.
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const billing = result as any;

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-live="polite">
        <h1 className="text-2xl font-semibold">Billing Overview</h1>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-64" />
        <span className="sr-only">Loading...</span>
      </div>
    );
  }

  const totalSubscribers = billing?.totalSubscribers ?? 0;
  const mrr = billing?.mrr ?? 0;
  const activeSubscriptions = billing?.activeSubscriptions ?? totalSubscribers;
  const distribution = billing?.distribution ?? [];
  const recentSubscriptions = billing?.recentSubscriptions ?? [];

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
      amount / 100,
    );

  const hasData = totalSubscribers > 0 || distribution.length > 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Billing Overview</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Subscribers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{totalSubscribers}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Monthly Recurring Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{formatCurrency(mrr)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Subscriptions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{activeSubscriptions}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Subscription Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          {!hasData ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No billing activity yet. Billing metrics will appear once tenants subscribe to
              plans.
            </p>
          ) : distribution.length > 0 ? (
            <div className="space-y-3">
              {distribution.map((plan: any) => {
                const percentage =
                  totalSubscribers > 0
                    ? Math.round((plan.count / totalSubscribers) * 100)
                    : 0;
                return (
                  <div key={plan.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{plan.name}</span>
                      <Badge variant="secondary">{plan.count} subscribers</Badge>
                    </div>
                    <Badge variant="outline">{percentage}%</Badge>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No subscription plans found.
            </p>
          )}
        </CardContent>
      </Card>

      {recentSubscriptions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Subscriptions</CardTitle>
          </CardHeader>
          <CardContent>
            {isMobile ? (
              <div className="space-y-3">
                {recentSubscriptions.slice(0, 10).map((sub: any, i: number) => (
                  <div key={sub.id ?? i} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm font-medium">{sub.tenantName ?? sub.tenantId}</p>
                      <p className="text-xs text-muted-foreground">
                        {sub.plan} &middot; {sub.date ? new Date(sub.date).toLocaleDateString() : "N/A"}
                      </p>
                    </div>
                    <Badge
                      variant={sub.status === "active" ? "default" : "secondary"}
                      className="ml-2 shrink-0"
                    >
                      {sub.status}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentSubscriptions.slice(0, 10).map((sub: any, i: number) => (
                    <TableRow key={sub.id ?? i}>
                      <TableCell>{sub.tenantName ?? sub.tenantId}</TableCell>
                      <TableCell>{sub.plan}</TableCell>
                      <TableCell>
                        <Badge
                          variant={sub.status === "active" ? "default" : "secondary"}
                        >
                          {sub.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {sub.date
                          ? new Date(sub.date).toLocaleDateString()
                          : "N/A"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
