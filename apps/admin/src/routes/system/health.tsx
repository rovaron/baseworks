import { useQuery } from "@tanstack/react-query";
import { formatDuration, intervalToDuration } from "date-fns";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@baseworks/ui";
import { api } from "@/lib/api";

function getOverallStatus(health: any): "healthy" | "degraded" | "unhealthy" {
  if (!health) return "unhealthy";

  const queues = health.queues ?? [];
  const redis = health.redis;

  if (redis && !redis.connected) return "unhealthy";

  const hasHighQueue = queues.some((q: any) => (q.waiting ?? 0) > 1000);
  const hasWarningQueue = queues.some((q: any) => (q.waiting ?? 0) > 100);

  if (hasHighQueue) return "unhealthy";
  if (hasWarningQueue) return "degraded";

  return "healthy";
}

function getQueueStatus(waiting: number): "healthy" | "warning" | "critical" {
  if (waiting > 1000) return "critical";
  if (waiting > 100) return "warning";
  return "healthy";
}

function getStatusVariant(
  status: string,
): "default" | "secondary" | "destructive" {
  switch (status) {
    case "healthy":
      return "default";
    case "degraded":
    case "warning":
      return "secondary";
    case "unhealthy":
    case "critical":
      return "destructive";
    default:
      return "secondary";
  }
}

function formatUptime(seconds: number): string {
  const duration = intervalToDuration({ start: 0, end: seconds * 1000 });
  return formatDuration(duration, { format: ["days", "hours", "minutes"] }) || "< 1 minute";
}

export function Component() {
  const {
    data: result,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["admin", "system", "health"],
    queryFn: async () => {
      const res = await api.api.admin.system.health.get();
      return res.data;
    },
    refetchInterval: 30000,
  });

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">System Health</h1>
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

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">System Health</h1>
        <Skeleton className="h-24" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }

  const health = result as any;
  const overallStatus = getOverallStatus(health);
  const queues = health?.queues ?? [];
  const redis = health?.redis;
  const uptime = health?.uptime ?? 0;
  const modules = health?.modules ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">System Health</h1>

      {/* Overall Status */}
      <Card>
        <CardContent className="flex items-center gap-4 py-6">
          <Badge
            variant={getStatusVariant(overallStatus)}
            className="text-base px-4 py-1"
          >
            {overallStatus === "healthy"
              ? "Healthy"
              : overallStatus === "degraded"
                ? "Degraded"
                : "Unhealthy"}
          </Badge>
          <p className="text-sm text-muted-foreground">
            {overallStatus === "healthy"
              ? "All systems are operating normally."
              : overallStatus === "degraded"
                ? "Some systems are experiencing elevated load."
                : "One or more systems require attention."}
          </p>
        </CardContent>
      </Card>

      {/* Queue Status */}
      {queues.length > 0 && (
        <>
          <h2 className="text-lg font-medium">Queues</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {queues.map((queue: any) => {
              const status = getQueueStatus(queue.waiting ?? 0);
              return (
                <Card key={queue.name}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">
                        {queue.name}
                      </CardTitle>
                      <Badge variant={getStatusVariant(status)}>{status}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <p className="text-muted-foreground">Waiting</p>
                        <p className="font-medium">{queue.waiting ?? 0}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Active</p>
                        <p className="font-medium">{queue.active ?? 0}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Completed</p>
                        <p className="font-medium">{queue.completed ?? 0}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Failed</p>
                        <p className="font-medium">{queue.failed ?? 0}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Redis Status */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Redis</CardTitle>
              {redis && (
                <Badge variant={redis.connected ? "default" : "destructive"}>
                  {redis.connected ? "connected" : "disconnected"}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {redis ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Memory usage</span>
                  <span className="font-medium">{redis.memoryUsage ?? "N/A"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Connected clients</span>
                  <span className="font-medium">{redis.connectedClients ?? "N/A"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Uptime</span>
                  <span className="font-medium">
                    {redis.uptime ? formatUptime(redis.uptime) : "N/A"}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No Redis data available.</p>
            )}
          </CardContent>
        </Card>

        {/* API Server Status */}
        <Card>
          <CardHeader>
            <CardTitle>API Server</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Uptime</span>
                <span className="font-medium">{formatUptime(uptime)}</span>
              </div>
              {modules.length > 0 && (
                <div>
                  <p className="text-muted-foreground mb-1">Loaded modules</p>
                  <div className="flex flex-wrap gap-1">
                    {modules.map((mod: string) => (
                      <Badge key={mod} variant="outline" className="text-xs">
                        {mod}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
