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
export function useNotificationStream(
  onMessage: (data: { type: string; id: string }) => void,
): void {
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
