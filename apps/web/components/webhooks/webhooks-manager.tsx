// apps/web/components/webhooks/webhooks-manager.tsx
"use client";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@baseworks/ui";
import { MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useWebhooks } from "@/hooks/use-webhooks";
import type { WebhookEndpoint } from "@/lib/webhooks-api";
import { WebhookDeliveriesDialog } from "./webhook-deliveries-dialog";
import { WebhookFormDialog } from "./webhook-form-dialog";

function statusBadge(status: string, t: (k: string) => string) {
  if (status === "active") return <Badge>{t("webhooks.statusActive")}</Badge>;
  if (status === "disabled")
    return <Badge variant="secondary">{t("webhooks.statusDisabled")}</Badge>;
  return <Badge variant="destructive">{t("webhooks.statusAutoDisabled")}</Badge>;
}

export function WebhooksManager() {
  const t = useTranslations("notifications");
  const { webhooks, isLoading, update, remove, rotate } = useWebhooks();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WebhookEndpoint | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<string | null>(null);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (w: WebhookEndpoint) => {
    setEditing(w);
    setFormOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">{t("webhooks.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("webhooks.description")}</p>
        </div>
        <Button onClick={openCreate}>{t("webhooks.new")}</Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : webhooks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("webhooks.empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t("webhooks.url")}</TableHead>
              <TableHead scope="col">{t("webhooks.categories")}</TableHead>
              <TableHead scope="col">{t("webhooks.status")}</TableHead>
              <TableHead scope="col">{t("webhooks.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {webhooks.map((wh) => (
              <TableRow key={wh.id}>
                <TableCell className="max-w-xs truncate font-mono text-xs">{wh.url}</TableCell>
                <TableCell className="text-sm">{(wh.categories ?? []).join(", ")}</TableCell>
                <TableCell>{statusBadge(wh.status, t)}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={t("webhooks.actions")}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(wh)}>
                        {t("webhooks.edit")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setDeliveriesFor(wh.id)}>
                        {t("webhooks.deliveries")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => rotate(wh.id)}>
                        {t("webhooks.rotateSecret")}
                      </DropdownMenuItem>
                      {wh.status === "active" ? (
                        <DropdownMenuItem
                          onClick={() => update({ id: wh.id, input: { status: "disabled" } })}
                        >
                          {t("webhooks.disable")}
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onClick={() => update({ id: wh.id, input: { status: "active" } })}
                        >
                          {t("webhooks.enable")}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => {
                          if (window.confirm(t("webhooks.confirmDelete"))) remove(wh.id);
                        }}
                      >
                        {t("webhooks.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <WebhookFormDialog open={formOpen} onOpenChange={setFormOpen} editing={editing} />
      <WebhookDeliveriesDialog
        webhookId={deliveriesFor}
        onOpenChange={(v) => !v && setDeliveriesFor(null)}
      />
    </div>
  );
}
