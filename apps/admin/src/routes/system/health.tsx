import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Skeleton,
} from "@baseworks/ui";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, formatDuration, intervalToDuration } from "date-fns";
import { AlertTriangle, Boxes, Cpu, Database, Layers, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** D-07 envelope shape — Phase 22 / OPS-03 */
interface DetailedHealth {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: number;
  queues: Array<{
    name: string;
    waiting: number;
    active: number;
    delayed: number;
    completed: number;
    failed: number;
    status: "healthy" | "warning" | "critical";
    thresholds: { warn: number; critical: number };
  }>;
  workers: Array<{
    instanceId: string;
    queues: string[];
    lastHeartbeat: string;
    ageSec: number;
    status: "healthy" | "stale" | "dead";
  }>;
  db: {
    connected: boolean;
    lagMs: number | null;
    status: "healthy" | "degraded" | "unhealthy";
  };
  recentErrors: Array<{
    timestamp: string;
    message: string;
    source: string;
    count: number;
  }>;
  modules: Array<{
    name: string;
    loaded: boolean;
    status: "healthy" | "degraded" | "unhealthy" | "unknown";
    details?: unknown;
  }>;
}

type StatusKey =
  | "healthy"
  | "degraded"
  | "warning"
  | "stale"
  | "unhealthy"
  | "critical"
  | "dead"
  | "unknown";

function getStatusVariant(
  status: StatusKey | string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "healthy":
      return "default";
    case "degraded":
    case "warning":
    case "stale":
      return "secondary";
    case "unhealthy":
    case "critical":
    case "dead":
      return "destructive";
    case "unknown":
      return "outline";
    default:
      return "secondary";
  }
}

function formatUptime(seconds: number): string {
  const duration = intervalToDuration({ start: 0, end: seconds * 1000 });
  return formatDuration(duration, { format: ["days", "hours", "minutes"] }) || "< 1 minute";
}

export function Component() {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");

  const {
    data: result,
    isLoading,
    isFetching,
    error,
    refetch,
    dataUpdatedAt,
  } = useQuery<DetailedHealth, Error>({
    queryKey: ["admin", "health-detailed"],
    queryFn: async () => {
      const res = await fetch("/health/detailed", { credentials: "include" });
      if (!res.ok) {
        const err = new Error(`status:${res.status}`);
        (err as Error & { status?: number }).status = res.status;
        throw err;
      }
      const body = await res.json();
      return body.data as DetailedHealth;
    },
    refetchInterval: 30000,
  });

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (error) {
    const status = (error as Error & { status?: number }).status;
    let copyKey = "systemHealth.errors.serverError";
    if (status === 401) copyKey = "systemHealth.errors.unauthorized";
    else if (status === 403) copyKey = "systemHealth.errors.forbidden";
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-medium">{t("systemHealth.title")}</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-destructive mb-4" aria-hidden />
            <p className="text-sm text-muted-foreground mb-4">{t(copyKey)}</p>
            {status !== 403 && (
              <Button variant="outline" onClick={() => refetch()}>
                {tc("retry")}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !result) {
    return (
      <div className="space-y-6" aria-busy="true" aria-live="polite">
        <h1 className="text-2xl font-medium">{t("systemHealth.title")}</h1>
        <Skeleton className="h-24" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
        <span className="sr-only">{tc("loading")}</span>
      </div>
    );
  }

  const ageSecBetween = Math.max(0, Math.round((now - dataUpdatedAt) / 1000));
  const updatedLabel =
    ageSecBetween === 0
      ? t("systemHealth.updatedJustNow")
      : t("systemHealth.updatedAgo", { time: `${ageSecBetween}s` });

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-medium">{t("systemHealth.title")}</h1>
        <div className="flex items-center gap-2" aria-live="polite">
          <span className="text-xs text-muted-foreground">{updatedLabel}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            aria-label={t("systemHealth.refreshNow")}
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} aria-hidden />
          </Button>
        </div>
      </header>

      {/* Overall status card */}
      <Card>
        <CardContent className="py-6 flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{t("systemHealth.statusLabel")}</p>
            <Badge variant={getStatusVariant(result.status as StatusKey)}>
              {t(`systemHealth.status.${result.status}`)}
            </Badge>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Uptime</p>
            <p className="text-sm">{formatUptime(result.uptime)}</p>
          </div>
        </CardContent>
      </Card>

      {/* Queues */}
      {result.queues.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-medium flex items-center gap-2">
            <Layers className="h-5 w-5" aria-hidden /> {t("systemHealth.queues")}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {result.queues.map((q) => (
              <Card key={q.name} data-testid="queue-card">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium">{q.name}</CardTitle>
                    <Badge variant={getStatusVariant(q.status)}>{q.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-muted-foreground">
                        {t("systemHealth.queueMetrics.waiting")}
                      </p>
                      <p className="font-medium">{q.waiting}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        {t("systemHealth.queueMetrics.active")}
                      </p>
                      <p className="font-medium">{q.active}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        {t("systemHealth.queueMetrics.delayed")}
                      </p>
                      <p className="font-medium">{q.delayed}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        {t("systemHealth.queueMetrics.failed")}
                      </p>
                      <p className="font-medium">{q.failed}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("systemHealth.queueMetrics.warnAt", { count: q.thresholds.warn })}
                    {" · "}
                    {t("systemHealth.queueMetrics.criticalAt", { count: q.thresholds.critical })}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Workers */}
      <section className="space-y-2">
        <h2 className="text-lg font-medium flex items-center gap-2">
          <Cpu className="h-5 w-5" aria-hidden /> {t("systemHealth.workers.title")}
        </h2>
        {result.workers.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              {t("systemHealth.workers.empty")}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {result.workers.map((w) => (
              <Card key={w.instanceId} data-testid="worker-card">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium">{w.instanceId}</CardTitle>
                    <Badge variant={getStatusVariant(w.status)}>
                      {t(`systemHealth.workers.status.${w.status}`)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="text-sm">
                  <p className="text-muted-foreground">{t("systemHealth.workers.queues")}</p>
                  <p className="font-medium mb-2">{w.queues.join(", ") || "—"}</p>
                  <p className="text-muted-foreground">{t("systemHealth.workers.lastHeartbeat")}</p>
                  <p className="font-medium">
                    {formatDistanceToNow(new Date(w.lastHeartbeat), { addSuffix: true })}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* DB + Recent Errors row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section>
          <h2 className="text-lg font-medium flex items-center gap-2">
            <Database className="h-5 w-5" aria-hidden /> {t("systemHealth.db.title")}
          </h2>
          <Card data-testid="db-card">
            <CardContent className="py-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span>
                  {result.db.connected
                    ? t("systemHealth.db.connected")
                    : t("systemHealth.db.disconnected")}
                </span>
                <Badge variant={getStatusVariant(result.db.status)}>
                  {t(`systemHealth.status.${result.db.status}`)}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>{t("systemHealth.db.lagMs")}</span>
                <span>
                  {typeof result.db.lagMs === "number"
                    ? `${result.db.lagMs} ms`
                    : t("systemHealth.db.lagUnavailable")}
                </span>
              </div>
            </CardContent>
          </Card>
        </section>

        <section>
          <h2 className="text-lg font-medium flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" aria-hidden /> {t("systemHealth.recentErrors.title")}
          </h2>
          <Card data-testid="errors-card">
            <CardContent className="py-4">
              {result.recentErrors.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("systemHealth.recentErrors.empty")}
                </p>
              ) : (
                <ul className="space-y-2 max-h-72 overflow-y-auto text-sm">
                  {result.recentErrors.map((e, i) => (
                    <li key={`${e.timestamp}-${i}`} className="border-b last:border-b-0 pb-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {t(`systemHealth.recentErrors.source.${e.source}`)} ·{" "}
                          {new Date(e.timestamp).toLocaleTimeString()}
                        </span>
                        <span>
                          {t("systemHealth.recentErrors.occurrences", { count: e.count })}
                        </span>
                      </div>
                      <p title={e.message} className="text-sm">
                        {e.message.length > 200 ? `${e.message.slice(0, 200)}…` : e.message}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      {/* Modules */}
      <section className="space-y-2">
        <h2 className="text-lg font-medium flex items-center gap-2">
          <Boxes className="h-5 w-5" aria-hidden /> {t("systemHealth.modules.title")}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {result.modules.map((m) => (
            <Card key={m.name} data-testid="module-card">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">{m.name}</CardTitle>
                  <Badge variant={getStatusVariant(m.status)}>
                    {t(`systemHealth.modules.status.${m.status}`)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {m.loaded ? "Loaded" : "Not loaded"}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
