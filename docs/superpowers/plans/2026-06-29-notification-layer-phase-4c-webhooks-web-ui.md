# Notification Layer Phase 4c — Webhook Tenant Web UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tenant-facing settings page (`/dashboard/settings/webhooks`) to create / edit / delete / rotate-secret webhook endpoints, view their delivery history, re-enable auto-disabled endpoints, and redeliver past events — against the Phase 4b API.

**Architecture:** Mirrors the existing notifications client stack: a thin Eden wrapper module (`lib/webhooks-api.ts`) → a React Query hook (`hooks/use-webhooks.ts`, list query + mutations with toast + invalidation) → presentational client components (manager table, form dialog, deliveries dialog) → an App-Router page. Categories use a Checkbox group (no multi-select component exists). i18n strings live under the existing `notifications` next-intl namespace.

**Tech Stack:** Next.js App Router, React 19, `@baseworks/ui` (shadcn), `@tanstack/react-query`, Eden Treaty (`@/lib/api`), react-hook-form + zod, `sonner`, next-intl, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-29-notification-layer-phase-4-webhooks-design.md` (apps/web tenant self-serve)
**Branch:** create `feat/notifications-phase-4c` off `main`.
**Depends on:** Phase 4b (merged) — the `/api/notifications/webhooks` routes.
**Out of scope:** admin UI (4d). Locale switching (only `en` + `pt-BR` message files are maintained; both updated here).

## Conventions (verified in-repo)

- Eden client: `import { api } from "@/lib/api"`; routes under `api.api.notifications.webhooks…` (the module prefix is `/api/notifications`). Calls return `{ data, error }`; backend handlers return a `{ success, data }` / `{ success, error }` Result envelope at HTTP 200. Unwrap: throw on `error`, throw on `!data.success`, else return `data.data`. Following `lib/notifications-api.ts`, use a `(api.api as any).notifications` accessor to avoid Eden envelope-type friction.
- React Query: key `["webhooks", activeTenant?.id]`, `enabled: !!activeTenant?.id`; invalidate `["webhooks"]` on every mutation success; `toast.success`/`toast.error` from `sonner`.
- Tenant: `useTenant()` from `@/components/tenant-provider` → `{ activeTenant, activeRole }`.
- i18n: `useTranslations("notifications")`; add a `webhooks` sub-object to `packages/i18n/src/locales/{en,pt-BR}/notifications.json`. `common` namespace has a generic `error`.
- Tables: hand-rolled shadcn `Table` (see `components/members-list.tsx`). Row actions via `DropdownMenu` + ghost `Button` + `MoreHorizontal`.
- Components from `@baseworks/ui`: `Button, Card*, Dialog*, Form*, Input, Label, Select*, Badge, Table*, DropdownMenu*, Checkbox, Skeleton, Separator`. Toast: `toast` from `sonner`.

---

## File Structure

**Create:**
- `apps/web/lib/webhooks-api.ts` — typed Eden wrappers + DTO types.
- `apps/web/hooks/use-webhooks.ts` — `useWebhooks()` (list + create/update/delete/rotate) and `useWebhookDeliveries(id)` (list + redeliver).
- `apps/web/hooks/__tests__/use-webhooks.test.tsx` — Vitest hook test.
- `apps/web/components/webhooks/webhooks-manager.tsx` — list table + actions + dialogs orchestration.
- `apps/web/components/webhooks/webhook-form-dialog.tsx` — create/edit form + one-time secret reveal.
- `apps/web/components/webhooks/webhook-deliveries-dialog.tsx` — delivery history + redeliver.
- `apps/web/app/(dashboard)/dashboard/settings/webhooks/page.tsx` — the page.

**Modify:**
- `packages/i18n/src/locales/en/notifications.json` + `packages/i18n/src/locales/pt-BR/notifications.json` — add `webhooks.*`.
- `packages/i18n/src/locales/en/dashboard.json` + `pt-BR/dashboard.json` — add `nav.webhooks`.
- `apps/web/components/sidebar-nav.tsx` — add the Webhooks nav item.

---

## Task 1: i18n strings

**Files:**
- Modify: `packages/i18n/src/locales/en/notifications.json`, `packages/i18n/src/locales/pt-BR/notifications.json`, `packages/i18n/src/locales/en/dashboard.json`, `packages/i18n/src/locales/pt-BR/dashboard.json`

- [ ] **Step 1: Add the `webhooks` block to `en/notifications.json`**

Add this key (sibling to the existing keys) in `packages/i18n/src/locales/en/notifications.json`:

```json
  "webhooks": {
    "title": "Webhooks",
    "description": "Send signed HTTP callbacks to your systems when events occur.",
    "empty": "No webhook endpoints yet.",
    "new": "New webhook",
    "edit": "Edit webhook",
    "create": "Create webhook",
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete",
    "deliveries": "Deliveries",
    "rotateSecret": "Rotate secret",
    "enable": "Enable",
    "disable": "Disable",
    "redeliver": "Redeliver",
    "url": "Endpoint URL",
    "urlPlaceholder": "https://example.com/webhooks",
    "descriptionField": "Description",
    "categories": "Event categories",
    "status": "Status",
    "lastDelivery": "Last delivery",
    "actions": "Actions",
    "statusActive": "Active",
    "statusDisabled": "Disabled",
    "statusAutoDisabled": "Auto-disabled",
    "secretTitle": "Signing secret",
    "secretWarning": "Copy this secret now — it will not be shown again.",
    "copy": "Copy",
    "copied": "Copied",
    "created": "Webhook created",
    "updated": "Webhook updated",
    "deleted": "Webhook deleted",
    "secretRotated": "Secret rotated",
    "redelivered": "Delivery re-queued",
    "deliveriesEmpty": "No deliveries yet.",
    "event": "Event",
    "code": "Code",
    "attempts": "Attempts",
    "time": "Time",
    "confirmDelete": "Delete this webhook endpoint? Its delivery history will be removed."
  }
```

- [ ] **Step 2: Add the same block to `pt-BR/notifications.json`** (translated)

```json
  "webhooks": {
    "title": "Webhooks",
    "description": "Envie callbacks HTTP assinados para seus sistemas quando eventos ocorrerem.",
    "empty": "Nenhum endpoint de webhook ainda.",
    "new": "Novo webhook",
    "edit": "Editar webhook",
    "create": "Criar webhook",
    "save": "Salvar",
    "cancel": "Cancelar",
    "delete": "Excluir",
    "deliveries": "Entregas",
    "rotateSecret": "Girar segredo",
    "enable": "Ativar",
    "disable": "Desativar",
    "redeliver": "Reenviar",
    "url": "URL do endpoint",
    "urlPlaceholder": "https://example.com/webhooks",
    "descriptionField": "Descrição",
    "categories": "Categorias de evento",
    "status": "Status",
    "lastDelivery": "Última entrega",
    "actions": "Ações",
    "statusActive": "Ativo",
    "statusDisabled": "Desativado",
    "statusAutoDisabled": "Desativado automaticamente",
    "secretTitle": "Segredo de assinatura",
    "secretWarning": "Copie este segredo agora — ele não será mostrado novamente.",
    "copy": "Copiar",
    "copied": "Copiado",
    "created": "Webhook criado",
    "updated": "Webhook atualizado",
    "deleted": "Webhook excluído",
    "secretRotated": "Segredo girado",
    "redelivered": "Entrega reenfileirada",
    "deliveriesEmpty": "Nenhuma entrega ainda.",
    "event": "Evento",
    "code": "Código",
    "attempts": "Tentativas",
    "time": "Hora",
    "confirmDelete": "Excluir este endpoint de webhook? Seu histórico de entregas será removido."
  }
```

- [ ] **Step 3: Add `nav.webhooks` to `en/dashboard.json` and `pt-BR/dashboard.json`**

In the `"nav"` object of `en/dashboard.json` add `"webhooks": "Webhooks"`; in `pt-BR/dashboard.json` add `"webhooks": "Webhooks"`.

- [ ] **Step 4: Validate JSON**

Run: `bun run typecheck`
Expected: PASS (JSON is imported as messages; malformed JSON would fail the i18n build/typecheck). Also confirm valid JSON: `bunx biome check packages/i18n/src/locales` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/src/locales
git commit -m "feat(i18n): webhook settings strings (en + pt-BR)"
```

---

## Task 2: Eden API wrapper

**Files:**
- Create: `apps/web/lib/webhooks-api.ts`

- [ ] **Step 1: Write the implementation**

```ts
// apps/web/lib/webhooks-api.ts
import { api } from "@/lib/api";

export interface WebhookEndpoint {
  id: string;
  url: string;
  categories: string[] | null;
  description: string | null;
  status: "active" | "disabled" | "auto_disabled";
  consecutiveFailures: string;
  lastDeliveryAt: string | null;
  lastStatus: string | null;
  disabledReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventType: string;
  category: string;
  status: string;
  httpStatus: string | null;
  attempts: string;
  lastError: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface CreateWebhookInput {
  url: string;
  categories: string[];
  description?: string;
}
export interface UpdateWebhookInput {
  url?: string;
  categories?: string[];
  description?: string;
  status?: "active" | "disabled";
}

// The notifications module mounts routes under /api/notifications; Eden envelope
// types aren't exposed, so use the same `any` accessor as lib/notifications-api.ts.
const w = () => (api.api as any).notifications.webhooks;

// Backend handlers return a { success, data } / { success, error } Result at HTTP 200.
function unwrap<T>(res: { data: any; error: any }): T {
  if (res.error) throw new Error(String(res.error?.value ?? res.error?.message ?? "Request failed"));
  const env = res.data;
  if (env && typeof env === "object" && "success" in env) {
    if (!env.success) throw new Error(env.error ?? "Request failed");
    return env.data as T;
  }
  return env as T;
}

export async function listWebhooks(): Promise<WebhookEndpoint[]> {
  return unwrap<WebhookEndpoint[]>(await w().get());
}

export async function createWebhook(
  input: CreateWebhookInput,
): Promise<WebhookEndpoint & { secret: string }> {
  return unwrap<WebhookEndpoint & { secret: string }>(await w().post(input));
}

export async function updateWebhook(id: string, input: UpdateWebhookInput): Promise<WebhookEndpoint> {
  return unwrap<WebhookEndpoint>(await w()({ id }).patch(input));
}

export async function deleteWebhook(id: string): Promise<void> {
  unwrap<{ id: string }>(await w()({ id }).delete());
}

export async function rotateWebhookSecret(id: string): Promise<{ id: string; secret: string }> {
  return unwrap<{ id: string; secret: string }>(await w()({ id })["rotate-secret"].post());
}

export async function listWebhookDeliveries(
  webhookId: string,
  opts: { status?: string; limit?: number; offset?: number } = {},
): Promise<WebhookDelivery[]> {
  const query: Record<string, string> = {};
  if (opts.status) query.status = opts.status;
  if (opts.limit != null) query.limit = String(opts.limit);
  if (opts.offset != null) query.offset = String(opts.offset);
  return unwrap<WebhookDelivery[]>(await w()({ id: webhookId }).deliveries.get({ query }));
}

export async function redeliverWebhook(deliveryId: string): Promise<{ deliveryId: string }> {
  return unwrap<{ deliveryId: string }>(
    await w().deliveries({ deliveryId }).redeliver.post(),
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/webhooks-api.ts
git commit -m "feat(web): webhooks Eden API wrapper"
```

---

## Task 3: React Query hook (+ test)

**Files:**
- Create: `apps/web/hooks/use-webhooks.ts`
- Test: `apps/web/hooks/__tests__/use-webhooks.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/hooks/__tests__/use-webhooks.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/webhooks-api", () => ({
  listWebhooks: vi.fn(async () => [
    { id: "w1", url: "https://x/y", categories: ["system"], description: null, status: "active", consecutiveFailures: "0", lastDeliveryAt: null, lastStatus: null, disabledReason: null, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  ]),
  createWebhook: vi.fn(async () => ({ id: "w2", secret: "whsec_x" })),
  updateWebhook: vi.fn(async () => ({ id: "w1" })),
  deleteWebhook: vi.fn(async () => {}),
  rotateWebhookSecret: vi.fn(async () => ({ id: "w1", secret: "whsec_new" })),
}));

vi.mock("@/components/tenant-provider", () => ({
  useTenant: () => ({ activeTenant: { id: "t1", name: "T", slug: "t" }, activeRole: "owner" }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useWebhooks } from "../use-webhooks";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useWebhooks", () => {
  test("loads the list and exposes mutations", async () => {
    const { result } = renderHook(() => useWebhooks(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.webhooks).toHaveLength(1));
    expect(result.current.webhooks[0].url).toBe("https://x/y");

    let created: { secret: string } | undefined;
    await act(async () => {
      created = await result.current.create({ url: "https://a/b", categories: ["system"] });
    });
    expect(created?.secret).toBe("whsec_x");

    const { createWebhook } = await import("@/lib/webhooks-api");
    expect(createWebhook).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && bunx vitest run hooks/__tests__/use-webhooks.test.tsx`
Expected: FAIL — `Cannot find module "../use-webhooks"`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/hooks/use-webhooks.ts
"use client";
import { useTenant } from "@/components/tenant-provider";
import {
  type CreateWebhookInput,
  createWebhook,
  deleteWebhook,
  listWebhookDeliveries,
  listWebhooks,
  redeliverWebhook,
  rotateWebhookSecret,
  type UpdateWebhookInput,
  updateWebhook,
  type WebhookEndpoint,
} from "@/lib/webhooks-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

export function useWebhooks() {
  const { activeTenant } = useTenant();
  const tenantId = activeTenant?.id;
  const qc = useQueryClient();
  const t = useTranslations("notifications");
  const tc = useTranslations("common");

  const query = useQuery({
    queryKey: ["webhooks", tenantId],
    queryFn: () => listWebhooks(),
    enabled: !!tenantId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["webhooks"] });

  const createM = useMutation({
    mutationFn: (input: CreateWebhookInput) => createWebhook(input),
    onSuccess: () => {
      toast.success(t("webhooks.created"));
      invalidate();
    },
    onError: () => toast.error(tc("error")),
  });
  const updateM = useMutation({
    mutationFn: (args: { id: string; input: UpdateWebhookInput }) =>
      updateWebhook(args.id, args.input),
    onSuccess: () => {
      toast.success(t("webhooks.updated"));
      invalidate();
    },
    onError: () => toast.error(tc("error")),
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => deleteWebhook(id),
    onSuccess: () => {
      toast.success(t("webhooks.deleted"));
      invalidate();
    },
    onError: () => toast.error(tc("error")),
  });
  const rotateM = useMutation({
    mutationFn: (id: string) => rotateWebhookSecret(id),
    onSuccess: () => {
      toast.success(t("webhooks.secretRotated"));
      invalidate();
    },
    onError: () => toast.error(tc("error")),
  });

  return {
    webhooks: (query.data ?? []) as WebhookEndpoint[],
    isLoading: query.isPending && !!tenantId,
    isError: query.isError,
    create: createM.mutateAsync,
    update: updateM.mutateAsync,
    remove: deleteM.mutateAsync,
    rotate: rotateM.mutateAsync,
  };
}

export function useWebhookDeliveries(webhookId: string | null) {
  const qc = useQueryClient();
  const t = useTranslations("notifications");
  const tc = useTranslations("common");

  const query = useQuery({
    queryKey: ["webhook-deliveries", webhookId],
    queryFn: () => listWebhookDeliveries(webhookId as string),
    enabled: !!webhookId,
  });

  const redeliverM = useMutation({
    mutationFn: (deliveryId: string) => redeliverWebhook(deliveryId),
    onSuccess: () => {
      toast.success(t("webhooks.redelivered"));
      qc.invalidateQueries({ queryKey: ["webhook-deliveries"] });
    },
    onError: () => toast.error(tc("error")),
  });

  return {
    deliveries: query.data ?? [],
    isLoading: query.isPending && !!webhookId,
    redeliver: redeliverM.mutateAsync,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && bunx vitest run hooks/__tests__/use-webhooks.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/hooks/use-webhooks.ts apps/web/hooks/__tests__/use-webhooks.test.tsx
git commit -m "feat(web): useWebhooks + useWebhookDeliveries React Query hooks"
```

---

## Task 4: Webhook form dialog (create/edit + one-time secret)

**Files:**
- Create: `apps/web/components/webhooks/webhook-form-dialog.tsx`

- [ ] **Step 1: Write the implementation**

```tsx
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
import { useState } from "react";
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
                          <label key={c} className="flex items-center gap-2 text-sm">
                            <Checkbox
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
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS. (If `@baseworks/ui` does not export `Checkbox` from its barrel, import it from its component path `@baseworks/ui/components/checkbox` — verify against `packages/ui/src/index.ts` and adjust the import.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/webhooks/webhook-form-dialog.tsx
git commit -m "feat(web): webhook create/edit dialog with one-time secret reveal"
```

---

## Task 5: Deliveries dialog

**Files:**
- Create: `apps/web/components/webhooks/webhook-deliveries-dialog.tsx`

- [ ] **Step 1: Write the implementation**

```tsx
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
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/webhooks/webhook-deliveries-dialog.tsx
git commit -m "feat(web): webhook deliveries dialog with redeliver"
```

---

## Task 6: Manager (table + actions)

**Files:**
- Create: `apps/web/components/webhooks/webhooks-manager.tsx`

- [ ] **Step 1: Write the implementation**

```tsx
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
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/webhooks/webhooks-manager.tsx
git commit -m "feat(web): webhooks manager table + row actions"
```

---

## Task 7: Page + sidebar nav

**Files:**
- Create: `apps/web/app/(dashboard)/dashboard/settings/webhooks/page.tsx`
- Modify: `apps/web/components/sidebar-nav.tsx`

- [ ] **Step 1: Create the page**

```tsx
// apps/web/app/(dashboard)/dashboard/settings/webhooks/page.tsx
import { getTranslations } from "next-intl/server";
import { WebhooksManager } from "@/components/webhooks/webhooks-manager";

export default async function WebhooksSettingsPage() {
  const t = await getTranslations("notifications");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("webhooks.title")}</h1>
      <WebhooksManager />
    </div>
  );
}
```

- [ ] **Step 2: Add the sidebar nav item**

In `apps/web/components/sidebar-nav.tsx`:
- Add `Webhook` to the `lucide-react` import.
- Add a `webhooks` entry to the `navIcons` map: `webhooks: Webhook,` (match the existing `navIcons` shape — see the file around the other icon entries).
- Add to the `navHrefs` array: `{ key: "webhooks", href: "/dashboard/settings/webhooks", icon: navIcons.webhooks },`.

(The active-state matcher already uses `pathname.startsWith(item.href)`, and the label comes from the `dashboard` namespace `nav.webhooks` key added in Task 1.)

- [ ] **Step 3: Typecheck + lint**

Run: `bun run typecheck`
Expected: PASS.
Run: `bunx biome check apps/web/app/(dashboard)/dashboard/settings/webhooks apps/web/components/webhooks apps/web/components/sidebar-nav.tsx apps/web/lib/webhooks-api.ts apps/web/hooks/use-webhooks.ts`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(dashboard)/dashboard/settings/webhooks/page.tsx" apps/web/components/sidebar-nav.tsx
git commit -m "feat(web): webhooks settings page + sidebar nav entry"
```

---

## Task 8: Verify

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the workspace**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 2: Run the web test suite**

Run: `cd apps/web && bunx vitest run`
Expected: PASS (includes the new `use-webhooks` test and existing notification tests).

- [ ] **Step 3: Biome**

Run: `bunx biome check apps/web/lib apps/web/hooks apps/web/components`
Expected: clean (pre-existing warnings only).

- [ ] **Step 4: Production build (catches App-Router/RSC + import errors a unit test won't)**

Run: `bun run --cwd apps/web build` (or the repo's web build script, e.g. `bun run build:web` from root — check `package.json`)
Expected: build succeeds.

- [ ] **Step 5: Commit (if any lint/format fixes were applied)**

```bash
git add -A
git commit -m "chore(web): lint/format fixes for webhooks UI" || echo "nothing to commit"
```

---

## Self-Review Notes (for the implementer)

- **Visual QA is manual.** The workflow verifies typecheck / vitest / biome / `next build` — it cannot see the rendered page. After merge, run the app (`bun run dev` / the web dev script), open `/dashboard/settings/webhooks`, and exercise create → secret reveal → list → edit → deliveries → redeliver → rotate → delete.
- **`@baseworks/ui` exports:** the plan assumes `Checkbox`, `DropdownMenu*`, `Skeleton`, `Badge`, `Table*`, `Dialog*`, `Form*` are exported from the barrel (confirmed in the conventions map). If any is not in `packages/ui/src/index.ts`, import from its component subpath and note it.
- **Result envelope:** notifications routes return the `{success,data}` Result at HTTP 200 (no 400 mapping). `unwrap()` throws on `!success` so React Query `onError` + toast fire. Do not assume non-2xx on business errors.
- **Auth scope:** the page is cookie-gated by `(dashboard)` middleware + server-side API guards; management is tenant-scoped (matches 4b). If admin-only gating is later desired, gate the "New webhook"/row actions with `activeRole` from `useTenant()` — out of scope here.
- **No `.rejects` hazard here** (frontend tests mock the api module; no live DB), but keep mutation tests asserting resolved values / mock calls, not rejections of live promises.
- **Categories** are a Checkbox group (no multi-select component exists). Keep `CATEGORIES` in sync with the backend `KNOWN_CATEGORIES`.
