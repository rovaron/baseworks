// apps/web/components/webhooks/webhook-form-dialog.tsx
"use client";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Label,
} from "@baseworks/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useWebhooks } from "@/hooks/use-webhooks";
import type { WebhookEndpoint } from "@/lib/webhooks-api";

const CATEGORIES = ["system", "team", "billing", "files", "security"] as const;

const schema = z.object({
  url: z.string().min(1).url(),
  description: z.string().optional(),
  categories: z.array(z.string()).min(1),
});
type Values = z.infer<typeof schema>;

export function WebhookFormDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing?: WebhookEndpoint | null;
}) {
  const t = useTranslations("notifications");
  const { create, update } = useWebhooks();
  const [secret, setSecret] = useState<string | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      url: editing?.url ?? "",
      description: editing?.description ?? "",
      categories: editing?.categories ?? [],
    },
  });

  // The dialog stays mounted (only `open` toggles), so RHF defaultValues — which
  // apply once on mount — would go stale across edit/create opens. Re-seed the
  // form (and clear any revealed secret) every time the dialog opens.
  useEffect(() => {
    if (open) {
      setSecret(null);
      form.reset({
        url: editing?.url ?? "",
        description: editing?.description ?? "",
        categories: editing?.categories ?? [],
      });
    }
  }, [open, editing, form]);

  const onSubmit = async (values: Values) => {
    try {
      if (editing) {
        await update({ id: editing.id, input: values });
        onOpenChange(false);
      } else {
        const created = await create(values);
        setSecret(created.secret); // reveal once; keep dialog open
      }
    } catch {
      /* toast handled in the hook */
    }
  };

  const close = () => {
    setSecret(null);
    form.reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? t("webhooks.edit") : t("webhooks.create")}</DialogTitle>
          <DialogDescription>{t("webhooks.description")}</DialogDescription>
        </DialogHeader>

        {secret ? (
          <div className="space-y-3">
            <Label>{t("webhooks.secretTitle")}</Label>
            <code className="block w-full break-all rounded bg-muted p-3 text-sm">{secret}</code>
            <p className="text-sm text-destructive">{t("webhooks.secretWarning")}</p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  navigator.clipboard?.writeText(secret);
                  toast.success(t("webhooks.copied"));
                }}
              >
                {t("webhooks.copy")}
              </Button>
              <Button type="button" onClick={close}>
                {t("webhooks.save")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("webhooks.url")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("webhooks.urlPlaceholder")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("webhooks.descriptionField")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="categories"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("webhooks.categories")}</FormLabel>
                    <div className="grid grid-cols-2 gap-2">
                      {CATEGORIES.map((c) => {
                        const checked = field.value.includes(c);
                        return (
                          <label
                            key={c}
                            htmlFor={`webhook-cat-${c}`}
                            className="flex items-center gap-2 text-sm"
                          >
                            <Checkbox
                              id={`webhook-cat-${c}`}
                              checked={checked}
                              onCheckedChange={(v) =>
                                field.onChange(
                                  v ? [...field.value, c] : field.value.filter((x) => x !== c),
                                )
                              }
                            />
                            {c}
                          </label>
                        );
                      })}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={close}>
                  {t("webhooks.cancel")}
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {editing ? t("webhooks.save") : t("webhooks.create")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
