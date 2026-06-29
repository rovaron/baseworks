// apps/web/components/webhooks/webhook-deliveries-dialog.tsx
"use client";
import {
  Badge,
  Button,
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
import { useTranslations } from "next-intl";
import { useWebhookDeliveries } from "@/hooks/use-webhooks";

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "success") return "default";
  if (status === "failed") return "destructive";
  return "secondary";
}

export function WebhookDeliveriesDialog({
  webhookId,
  onOpenChange,
}: {
  webhookId: string | null;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useTranslations("notifications");
  const { deliveries, isLoading, redeliver } = useWebhookDeliveries(webhookId);

  return (
    <Dialog open={!!webhookId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("webhooks.deliveries")}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("webhooks.deliveriesEmpty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t("webhooks.event")}</TableHead>
                <TableHead scope="col">{t("webhooks.status")}</TableHead>
                <TableHead scope="col">{t("webhooks.code")}</TableHead>
                <TableHead scope="col">{t("webhooks.attempts")}</TableHead>
                <TableHead scope="col">{t("webhooks.actions")}</TableHead>
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
                  <TableCell>
                    <Button variant="outline" size="sm" onClick={() => redeliver(d.id)}>
                      {t("webhooks.redeliver")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
