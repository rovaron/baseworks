// Phase 22 / OPS-01 — bull-board mount with RBAC + CSP + readOnly env feature flag.
// References:
//   - github.com/felixmosh/bull-board/tree/master/examples/with-elysia (verified 2026-04-27)
//   - github.com/felixmosh/bull-board/blob/master/README.md#queue-options (readOnlyMode)
//   - github.com/oven-sh/bun/issues/5809 (uiBasePath Bun workaround)
import { Elysia } from "elysia";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ElysiaAdapter } from "@bull-board/elysia";
import type { Queue } from "bullmq";
import { requireRole } from "@baseworks/module-auth";
import { env } from "@baseworks/config";

/**
 * Phase 22 / OPS-01 — Elysia plugin factory mounting bull-board at /admin/bull-board.
 *
 * Composition (D-03):
 *   .use(requireRole("owner"))           ← every request including HTML/CSS/JS gets RBAC
 *   .use(serverAdapter.registerPlugin()) ← bull-board's Elysia subtree
 *   .onAfterHandle(set CSP)              ← D-04 frame-ancestors (plugin-scoped per Pitfall 6)
 *
 * Read-only mode (D-02): each BullMQAdapter constructed with the env-driven flag.
 * Toggling requires a process restart — readOnlyMode is captured at createBullBoard() time.
 *
 * @param queues - Module-collected BullMQ Queue refs to expose in the dashboard.
 * @returns Awaitable Elysia plugin ready to be mounted with `app.use(plugin)`.
 */
export async function createBullBoardPlugin(queues: Queue[]): Promise<Elysia> {
  // D-04 — frame-ancestors: ADMIN_URL is the only allowed embedder. When unset,
  // degrade to 'none' (strictest possible — bull-board still serves but cannot be iframed).
  const frameAncestors = env.ADMIN_URL ? `'${env.ADMIN_URL}'` : "'none'";

  const serverAdapter = new ElysiaAdapter({
    basePath: "/admin/bull-board",
    prefix: "/admin/bull-board",
  });

  // D-02 — readOnlyMode is per-queue; every adapter receives the same env-driven flag.
  const readOnly = env.BULL_BOARD_READ_ONLY === "true";

  createBullBoard({
    queues: queues.map((q) => new BullMQAdapter(q, { readOnlyMode: readOnly })),
    serverAdapter,
    options: {
      // CRITICAL Bun-compat workaround for oven-sh/bun#5809 (eval inside @bull-board/ui).
      // Without this, the build/runtime fails. Path is relative to process.cwd() at runtime.
      uiBasePath: "node_modules/@bull-board/ui",
      uiConfig: {
        boardTitle: "Baseworks Job Monitor",
        hideRedisDetails: true,
      },
    },
  });

  // D-03 + Pitfall 6 — requireRole composition: every request inside this plugin
  // (HTML/CSS/JS/static) passes through the role derive. Returns 401 unauth, 403 wrong role.
  //
  // CSP via onRequest: set the header EARLY so it survives every downstream path,
  // including the requireRole-throws-Unauthorized → global errorMiddleware → 401
  // response build. Elysia's response builder reads `set.headers` regardless of
  // whether onAfterHandle fires (which it does NOT for thrown handlers).
  // The plugin is named so set.headers mutations are scoped — CSP does NOT leak
  // to sibling routes (Pitfall 6 — verified by the "CSP does NOT leak" test).
  return new Elysia({ name: "bull-board-mount" })
    .onRequest(({ set }) => {
      set.headers["content-security-policy"] = `frame-ancestors ${frameAncestors}`;
    })
    .use(requireRole("owner"))
    .use(await serverAdapter.registerPlugin());
}
