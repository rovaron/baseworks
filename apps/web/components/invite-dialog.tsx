"use client";

import { useMemo, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";
import {
  Button,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@baseworks/ui";
import { api } from "@/lib/api";
import { CopyLinkButton } from "./copy-link-button";

interface InviteDialogProps {
  orgId: string | undefined;
  orgName: string | undefined;
}

// Factory builds emailSchema with pre-translated error messages so that
// FormMessage can render errors.email.message without any conditional logic.
function buildEmailSchema(t: (key: string) => string) {
  return z.object({
    email: z
      .string()
      .min(1, { message: t("dialog.validation.emailRequired") })
      .email({ message: t("dialog.validation.emailInvalid") }),
    role: z.enum(["admin", "member"]),
  });
}

const linkSchema = z.object({
  role: z.enum(["admin", "member"]),
});

type EmailFormValues = z.infer<ReturnType<typeof buildEmailSchema>>;

export function InviteDialog({ orgId, orgName }: InviteDialogProps) {
  const t = useTranslations("invite");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [isLinkMode, setIsLinkMode] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);

  const emailSchema = useMemo(() => buildEmailSchema(t), [t]);

  // Resolver is widened via cast because the conditional schema (linkSchema vs emailSchema)
  // produces a union type that TypeScript cannot unify with EmailFormValues. The runtime
  // behavior is correct: when isLinkMode is true the email field is unmounted, so the
  // linkSchema (role only) validates the only mounted field.
  const form = useForm<EmailFormValues>({
    resolver: zodResolver(
      isLinkMode ? linkSchema : emailSchema,
    ) as unknown as Resolver<EmailFormValues>,
    defaultValues: {
      email: "",
      role: "member",
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async (values: { email?: string; role: string; mode: "email" | "link" }) => {
      const payload = {
        role: values.role,
        mode: values.mode,
        ...(values.mode === "email" ? { email: values.email } : {}),
      };
      const { data, error } = await api.api.invitations.post(payload);
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any, variables) => {
      queryClient.invalidateQueries({ queryKey: ["invitations"] });

      if (variables.mode === "email") {
        toast.success(t("toast.inviteSent", { email: variables.email }));
        handleClose();
      } else {
        // Link mode: show the generated URL
        const invitationId = (data as any)?.data?.id;
        if (!invitationId) {
          toast.error(tc("error"));
          return;
        }
        const url = `${window.location.origin}/invite/${invitationId}`;
        setGeneratedUrl(url);
        toast.success(t("toast.linkGenerated"));
      }
    },
    onError: () => {
      toast.error(tc("error"));
    },
  });

  function handleClose() {
    setOpen(false);
    setIsLinkMode(false);
    setGeneratedUrl(null);
    form.reset();
  }

  function onSubmit(values: EmailFormValues) {
    if (isLinkMode) {
      inviteMutation.mutate({ role: values.role, mode: "link" });
    } else {
      inviteMutation.mutate({ email: values.email, role: values.role, mode: "email" });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) handleClose();
        else setOpen(true);
      }}
    >
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4" />
        {t("actions.inviteMember")}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dialog.title", { orgName: orgName ?? "" })}</DialogTitle>
          <DialogDescription>{t("dialog.description")}</DialogDescription>
        </DialogHeader>

        {generatedUrl ? (
          <div className="space-y-4">
            <Label>{t("actions.copyLink")}</Label>
            <div className="flex items-center gap-2">
              <Input value={generatedUrl} readOnly className="flex-1" />
              <CopyLinkButton
                text={generatedUrl}
                label={t("actions.copyLink")}
                copiedLabel={t("actions.linkCopied")}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                {tc("done")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="invite-mode">{t("dialog.modeLabel")}</Label>
                <div className="flex items-center gap-2 text-sm">
                  <span className={!isLinkMode ? "font-medium" : "text-muted-foreground"}>
                    {t("dialog.emailMode")}
                  </span>
                  <Switch
                    id="invite-mode"
                    checked={isLinkMode}
                    onCheckedChange={(checked) => {
                      setIsLinkMode(checked);
                      if (checked) {
                        form.clearErrors("email");
                      }
                    }}
                  />
                  <span className={isLinkMode ? "font-medium" : "text-muted-foreground"}>
                    {t("dialog.linkMode")}
                  </span>
                </div>
              </div>

              {!isLinkMode && (
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("dialog.emailLabel")}</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder={t("dialog.emailPlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("dialog.roleLabel")}</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="member">{t("roles.member")}</SelectItem>
                        <SelectItem value="admin">{t("roles.admin")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" onClick={handleClose}>
                  {tc("cancel")}
                </Button>
                <Button type="submit" disabled={inviteMutation.isPending}>
                  {inviteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isLinkMode ? t("actions.generateLink") : t("actions.sendInvite")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
