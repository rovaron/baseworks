// apps/admin/src/routes/webhooks/deliveries-dialog.tsx
import {
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@baseworks/ui";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";

interface Delivery {
  id: string;
  eventType: string;
  status: string;
  httpStatus: string | null;
  attempts: string;
}

function statusVariant(s: string): "default" | "secondary" | "destructive" {
  if (s === "success") return "default";
  if (s === "failed") return "destructive";
  return "secondary";
}

export function WebhookDeliveriesDialog({
  webhookId,
  onClose,
}: {
  webhookId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("admin");

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "webhooks", webhookId, "deliveries"],
    queryFn: async () => {
      const res = await api.api.admin.webhooks({ id: webhookId! }).deliveries.get({
        query: { limit: 50, offset: 0 },
      });
      if (res.error) throw res.error;
      if (!("data" in res.data)) return [] as Delivery[];
      return res.data.data satisfies Delivery[];
    },
    enabled: !!webhookId,
  });

  const deliveries: Delivery[] = data ?? [];

  return (
    <Dialog open={!!webhookId} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("webhooks.deliveries.title")}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("webhooks.deliveries.empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t("webhooks.deliveries.event")}</TableHead>
                <TableHead scope="col">{t("webhooks.deliveries.status")}</TableHead>
                <TableHead scope="col">{t("webhooks.deliveries.code")}</TableHead>
                <TableHead scope="col">{t("webhooks.deliveries.attempts")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.eventType}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(d.status)}>{d.status}</Badge>
                  </TableCell>
                  <TableCell>{d.httpStatus ?? "—"}</TableCell>
                  <TableCell>{d.attempts}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
