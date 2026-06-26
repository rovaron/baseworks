# Notification Layer — Phase 2-web Implementation Plan (bell + feed + SSE hook)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Checkbox (`- [ ]`) steps. (Executed via the gated multi-agent Workflow; the browser pass is run by the reviewer.)

**Goal:** The web-facing half of Phase 2 — a notification **bell** with a live **unread badge**, a **dropdown feed** (list / mark-read+navigate / mark-all-read), and an **`EventSource` hook** that pushes updates over the Phase-2 SSE endpoint. Consumes the backend shipped in PR #11; adds no producers (a notification is triggered manually for the browser pass).

**Architecture:** `apps/web` (Next.js, React Query, `next-intl`, `@baseworks/ui`, Eden client `@/lib/api`). Two hooks (`useNotifications` for list+unread-count, `useNotificationStream` for SSE→cache-invalidation) feed a `<NotificationBell/>` mounted in the dashboard header. SSE is a raw cross-origin `EventSource` with `withCredentials` (CORS already allows credentials); the feed/mutations use the Eden client (cast, since module routes are erased to `any` by `getModuleRoutes`). First adds a vitest setup to `apps/web` (mirroring `apps/admin`).

**Tech Stack:** Next.js 15 / React 19, `@tanstack/react-query`, `next-intl`, `@baseworks/ui`, `sonner`, Vitest + Testing Library + happy-dom, `EventSource`.

**Spec:** `docs/superpowers/specs/2026-06-25-notification-layer-design.md` · **Builds on:** Phase 2 backend (#11)

---

## File structure (Phase 2-web)

| File | Responsibility |
|------|----------------|
| `apps/web/vitest.config.ts` · `apps/web/vitest.setup.ts` (create) | web test runner (mirror admin) |
| `apps/web/package.json` (modify) | `test` script + vitest devDeps |
| `package.json` (modify) | add `bun test`-equivalent web step to the root `test` chain |
| `apps/web/lib/notifications-api.ts` (create) | thin typed wrapper over the Eden client for the 4 REST calls |
| `apps/web/hooks/use-notifications.ts` (create) | React Query: `list` + `unread-count` |
| `apps/web/hooks/use-notification-stream.ts` (create) | `EventSource` → invalidate notification queries |
| `apps/web/components/notification-bell.tsx` (create) | bell + badge + dropdown feed |
| `apps/web/app/(dashboard)/layout.tsx` (modify) | mount `<NotificationBell/>` in the header |
| `packages/i18n/src/locales/{en,pt-BR}/*.json` (modify) | bell/feed strings |
| tests alongside hooks + component | |

---

## Task 1: Vitest setup for `apps/web`

**Files:** Create `apps/web/vitest.config.ts`, `apps/web/vitest.setup.ts`; modify `apps/web/package.json`, root `package.json`.

- [ ] **Step 1: Read the admin config to mirror it**

Run: `cat apps/admin/vitest.config.ts apps/admin/vitest.setup.ts apps/admin/package.json`
Note its `test`-related `devDependencies` (vitest, @testing-library/react, @testing-library/jest-dom, happy-dom or jsdom, @vitejs/plugin-react) and config (environment, setup file, alias `@`).

- [ ] **Step 2: Create `apps/web/vitest.config.ts`** mirroring admin's, with the web `@` alias → `apps/web` root and `environment: "happy-dom"` (or whatever admin uses):

```ts
// apps/web/vitest.config.ts
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": resolve(__dirname, ".") } },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

- [ ] **Step 3: Create `apps/web/vitest.setup.ts`** (mirror admin — at minimum `@testing-library/jest-dom`):

```ts
// apps/web/vitest.setup.ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 4: Add the test script + devDeps to `apps/web/package.json`** (copy the exact vitest-related devDependency versions from `apps/admin/package.json`):

```json
"scripts": { "test": "vitest run" }
```
plus the same vitest/testing-library/happy-dom/@vitejs/plugin-react devDependencies admin uses. Run `bun install`.

- [ ] **Step 5: Wire into the root `test` chain** — modify root `package.json` `"test"`: append ` && cd apps/web && bun run test` (mirroring the trailing `cd packages/ui && bun run test`).

- [ ] **Step 6: Sanity test** — create `apps/web/__tests__/smoke.test.tsx`:

```tsx
import { describe, expect, test } from "vitest";
describe("web vitest", () => { test("runs", () => { expect(1 + 1).toBe(2); }); });
```

Run: `cd apps/web && bun run test`
Expected: 1 pass. Then delete the smoke file.

- [ ] **Step 7: Commit** `chore(web): vitest setup`.

## Task 2: Notifications API wrapper

**Files:** Create `apps/web/lib/notifications-api.ts`

- [ ] **Step 1: Implement** (Eden client; routes are runtime-reachable even though typed `any` via `getModuleRoutes` — mirror the admin app's `(api.api.x as any)` usage). Source the client from `@/lib/api`.

```ts
// apps/web/lib/notifications-api.ts
import { api } from "@/lib/api";

export interface NotificationItem {
  id: string;
  type: string;
  category: string;
  severity: "info" | "success" | "warning" | "error";
  title: string;
  body: string;
  url?: string | null;
  readAt?: string | null;
  createdAt: string;
}

const n = () => (api.api as any).notifications;

export async function fetchNotifications(unreadOnly = false): Promise<NotificationItem[]> {
  const res = await n().get({ query: { limit: 20, unreadOnly: String(unreadOnly) } });
  if (res.error) throw res.error;
  return (res.data?.data ?? res.data ?? []) as NotificationItem[];
}

export async function fetchUnreadCount(): Promise<number> {
  const res = await n()["unread-count"].get();
  if (res.error) throw res.error;
  return (res.data?.data?.unread ?? res.data?.unread ?? 0) as number;
}

export async function markNotificationRead(id: string): Promise<void> {
  const res = await n()({ id }).read.post();
  if (res.error) throw res.error;
}

export async function markAllNotificationsRead(): Promise<void> {
  const res = await n()["read-all"].post();
  if (res.error) throw res.error;
}
```

- [ ] **Step 2: Typecheck** `bun run typecheck` → clean. **Step 3: Commit** `feat(web): notifications API wrapper`.

## Task 3: `useNotifications` hook

**Files:** Create `apps/web/hooks/use-notifications.ts` · Test `apps/web/hooks/__tests__/use-notifications.test.tsx`

- [ ] **Step 1: Failing test** (mock the api wrapper, assert list + unread + mark-read mutation invalidates)

```tsx
// apps/web/hooks/__tests__/use-notifications.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/notifications-api", () => ({
  fetchNotifications: vi.fn(async () => [
    { id: "1", type: "system.test", category: "system", severity: "info", title: "t", body: "b", readAt: null, createdAt: "2026-01-01" },
  ]),
  fetchUnreadCount: vi.fn(async () => 1),
  markNotificationRead: vi.fn(async () => {}),
  markAllNotificationsRead: vi.fn(async () => {}),
}));

import { useNotifications } from "../use-notifications";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useNotifications", () => {
  test("exposes list + unread count and a markRead mutation", async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.unreadCount).toBe(1));
    expect(result.current.notifications).toHaveLength(1);
    await act(async () => { await result.current.markRead("1"); });
    const { markNotificationRead } = await import("@/lib/notifications-api");
    expect(markNotificationRead).toHaveBeenCalledWith("1");
  });
});
```

- [ ] **Step 2: Run → fails.** `cd apps/web && bun run test hooks/__tests__/use-notifications.test.tsx`

- [ ] **Step 3: Implement**

```ts
// apps/web/hooks/use-notifications.ts
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications-api";

const KEYS = { list: ["notifications", "list"] as const, unread: ["notifications", "unread"] as const };

export function useNotifications() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: KEYS.list, queryFn: () => fetchNotifications(false) });
  const unread = useQuery({ queryKey: KEYS.unread, queryFn: fetchUnreadCount });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: KEYS.list });
    qc.invalidateQueries({ queryKey: KEYS.unread });
  };

  const readMut = useMutation({ mutationFn: markNotificationRead, onSuccess: invalidate });
  const readAllMut = useMutation({ mutationFn: markAllNotificationsRead, onSuccess: invalidate });

  return {
    notifications: list.data ?? [],
    unreadCount: unread.data ?? 0,
    isLoading: list.isPending,
    markRead: (id: string) => readMut.mutateAsync(id),
    markAllRead: () => readAllMut.mutateAsync(),
    invalidate,
  };
}

export const NOTIFICATION_QUERY_KEYS = KEYS;
```

- [ ] **Step 4: Run → pass.** **Step 5: Commit** `feat(web): useNotifications hook`.

## Task 4: `useNotificationStream` hook (SSE)

**Files:** Create `apps/web/hooks/use-notification-stream.ts` · Test `apps/web/hooks/__tests__/use-notification-stream.test.tsx`

- [ ] **Step 1: Failing test** (stub `EventSource`, assert an incoming message triggers the supplied `onMessage`)

```tsx
// apps/web/hooks/__tests__/use-notification-stream.test.tsx
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useNotificationStream } from "../use-notification-stream";

class FakeES {
  static last: FakeES | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  closed = false;
  constructor(public url: string, public init?: { withCredentials?: boolean }) { FakeES.last = this; }
  close() { this.closed = true; }
}
// @ts-expect-error inject stub
globalThis.EventSource = FakeES;
afterEach(() => { FakeES.last = null; });

describe("useNotificationStream", () => {
  test("opens a credentialed stream and forwards messages; closes on unmount", () => {
    const onMessage = vi.fn();
    const { unmount } = renderHook(() => useNotificationStream(onMessage));
    expect(FakeES.last?.init?.withCredentials).toBe(true);
    FakeES.last?.onmessage?.({ data: JSON.stringify({ type: "notification.created", id: "1" }) });
    expect(onMessage).toHaveBeenCalledTimes(1);
    unmount();
    expect(FakeES.last?.closed).toBe(true);
  });
});
```

- [ ] **Step 2: Run → fails.** **Step 3: Implement**

```ts
// apps/web/hooks/use-notification-stream.ts
"use client";
import { useEffect } from "react";

/** Resolve the API base URL the same way the Eden client does. */
function apiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
}

/**
 * Subscribe to the server's notification SSE stream. Cross-origin (web → api),
 * so `withCredentials` sends the session cookie (CORS allows credentials).
 * Calls `onMessage` for each `notification.created` event. Reconnection is
 * handled by the browser's EventSource.
 */
export function useNotificationStream(onMessage: (data: { type: string; id: string }) => void): void {
  useEffect(() => {
    const es = new EventSource(`${apiUrl()}/api/notifications/stream`, { withCredentials: true });
    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        if (parsed?.type) onMessage(parsed);
      } catch {
        /* keep-alive comments / malformed frames ignored */
      }
    };
    return () => es.close();
  }, [onMessage]);
}
```

- [ ] **Step 4: Run → pass.** **Step 5: Commit** `feat(web): useNotificationStream SSE hook`.

## Task 5: `NotificationBell` component + i18n

**Files:** Create `apps/web/components/notification-bell.tsx` · Test `apps/web/components/__tests__/notification-bell.test.tsx` · Modify `packages/i18n/src/locales/{en,pt-BR}/<namespace>.json`

- [ ] **Step 1: Add i18n keys** to the dashboard/common namespace the web uses (confirm the namespace from `apps/web/app/(dashboard)/layout.tsx` — it uses `useTranslations("common")`; add a `notifications` namespace if the web registers per-namespace, else nest under an existing one). Keys (en):

```json
"notifications": {
  "title": "Notifications",
  "empty": "No notifications",
  "markAllRead": "Mark all as read",
  "unreadLabel": "{count} unread notifications",
  "bellLabel": "Notifications"
}
```
and the pt-BR equivalents (`Notificações`, `Nenhuma notificação`, `Marcar todas como lidas`, `{count} notificações não lidas`, `Notificações`).

- [ ] **Step 2: Failing test** (badge shows unread; clicking an item marks read + opens its url; mark-all)

```tsx
// apps/web/components/__tests__/notification-bell.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

const markRead = vi.fn(async () => {});
vi.mock("@/hooks/use-notifications", () => ({
  useNotifications: () => ({
    notifications: [{ id: "1", type: "system.test", category: "system", severity: "info", title: "Hello", body: "World", url: "/dashboard", readAt: null, createdAt: "2026-01-01" }],
    unreadCount: 1, isLoading: false, markRead, markAllRead: vi.fn(), invalidate: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-notification-stream", () => ({ useNotificationStream: () => {} }));
vi.mock("next-intl", () => ({ useTranslations: () => (k: string, v?: any) => (v?.count != null ? `${v.count} unread` : k) }));

import { NotificationBell } from "../notification-bell";

describe("NotificationBell", () => {
  test("shows the unread badge", () => {
    render(<NotificationBell />);
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run → fails.** **Step 4: Implement** (use `@baseworks/ui` `DropdownMenu`/`Popover` + `Badge` + `Button`; `lucide-react` `Bell`; `next-intl`; `useRouter` from `next/navigation` for url navigation). The stream hook invalidates the queries on each event:

```tsx
// apps/web/components/notification-bell.tsx
"use client";
import {
  Badge, Button,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@baseworks/ui";
import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useNotifications } from "@/hooks/use-notifications";
import { useNotificationStream } from "@/hooks/use-notification-stream";

export function NotificationBell() {
  const t = useTranslations("notifications");
  const router = useRouter();
  const { notifications, unreadCount, markRead, markAllRead, invalidate } = useNotifications();
  useNotificationStream(invalidate); // SSE → refetch list + unread

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t("bellLabel")}>
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-5 min-w-5 justify-center px-1 text-xs"
              aria-label={t("unreadLabel", { count: unreadCount })}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0">{t("title")}</DropdownMenuLabel>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-auto px-1 text-xs" onClick={() => markAllRead()}>
              {t("markAllRead")}
            </Button>
          )}
        </div>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          notifications.map((notif) => (
            <DropdownMenuItem
              key={notif.id}
              className={notif.readAt ? "opacity-60" : "font-medium"}
              onSelect={async () => {
                await markRead(notif.id);
                if (notif.url) router.push(notif.url);
              }}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm">{notif.title}</span>
                <span className="text-xs text-muted-foreground">{notif.body}</span>
              </div>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 5: Run → pass.** **Step 6: Commit** `feat(web): NotificationBell component + i18n`.

## Task 6: Mount in the dashboard header

**Files:** Modify `apps/web/app/(dashboard)/layout.tsx`

- [ ] **Step 1: Mount the bell** on the right of the header. Change the header block:

```tsx
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-6" />
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </header>
```
and add the import `import { NotificationBell } from "@/components/notification-bell";`.

- [ ] **Step 2: Gate** — `bun run typecheck && bun run lint && cd apps/web && bun run test` → all pass; then `cd .. && bun run build:web` → builds (the bell is `"use client"`, mounted in a client layout). Expected: green.
- [ ] **Step 3: Commit** `feat(web): mount NotificationBell in the dashboard header`.

---

## Self-review

- **Spec coverage (Phase 2-web):** bell + unread badge (T5) ✓; dropdown feed with mark-read+navigate + mark-all (T5) ✓; `EventSource` hook → live refresh (T4, wired in T5) ✓; mounted in the shell (T6) ✓; automated tests via a new web vitest setup (T1–T5) ✓. No producers/preferences (later phases).
- **Placeholders:** none — concrete code per step. (T1 Steps 1/4 reference admin's exact devDep versions — a read-and-copy, not a placeholder.)
- **Type consistency:** `NotificationItem` (T2) used by `useNotifications` (T3) + bell (T5); query keys via `NOTIFICATION_QUERY_KEYS`; `useNotificationStream(onMessage)` signature matches the bell's `invalidate` usage.
- **Verifications (not placeholders):** the exact web i18n namespace registration (T5 Step 1 — confirm against `apps/web` i18n config); that the Eden `(api.api as any).notifications` paths resolve at runtime (covered by the browser pass); that CORS echoes the web origin + `Access-Control-Allow-Credentials` for the SSE endpoint (the existing cors config covers `/api/*` — the browser pass confirms the stream connects).

## Browser pass (run by the reviewer, not the workflow)

Automated tests cover the units; the end-to-end SSE delivery is validated in a browser:
1. Start API (`STRIPE_WEBHOOK_SECRET=dummy DATABASE_URL_RLS=… bun apps/api/src/index.ts`) + web (`bun run dev:web`).
2. Sign in as a test user; open the dashboard — bell shows **0**.
3. Trigger a notification for that user/tenant **manually** (no producer ships this phase): a one-off script calling `notify({ type: "system.test", recipients: { userIds: [<that user>] }, data: { message: "hello" } })` with an RLS-scoped ctx for the user's tenant (writes the row + publishes to Redis → the running API's SSE bridge → the browser).
4. Assert: the badge increments **live** (no refresh) via SSE; opening the dropdown shows the item; clicking it marks-read (badge → 0) and navigates to its `url`. Screenshot both states.

## Next

Phases 3–6: email channel + billing-email migration (this is where the **first real producers** wire `notify()`/`sendTransactionalEmail()`), webhooks, dispatch actions, preferences + a preferences page.
