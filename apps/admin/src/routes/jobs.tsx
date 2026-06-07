import { Button, Card, CardContent, Skeleton } from "@baseworks/ui";
import { AlertTriangle } from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * React 19 does not register `onError` for `<iframe>` elements through its synthetic event
 * system (error events don't bubble for iframes). This wrapper attaches the listener directly
 * via a ref so the error path can be triggered both by real network failures and by tests.
 */
interface IframeProps
  extends Omit<React.IframeHTMLAttributes<HTMLIFrameElement>, "onError" | "onLoad"> {
  onLoad?: () => void;
  onError?: () => void;
}

function IframeWithErrorHandler({ onLoad, onError, ...rest }: IframeProps) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);
  onLoadRef.current = onLoad;
  onErrorRef.current = onError;

  const setRef = useCallback((node: HTMLIFrameElement | null) => {
    if (ref.current) {
      ref.current.removeEventListener("load", handleLoad);
      ref.current.removeEventListener("error", handleError);
    }
    ref.current = node;
    if (node) {
      node.addEventListener("load", handleLoad);
      node.addEventListener("error", handleError);
    }
    function handleLoad() {
      onLoadRef.current?.();
    }
    function handleError() {
      onErrorRef.current?.();
    }
  }, []);

  useEffect(() => {
    return () => {
      if (ref.current) {
        // listeners are auto-cleaned when node is removed; explicit detach is defensive.
      }
    };
  }, []);

  return <iframe ref={setRef} {...rest} />;
}

/**
 * Phase 22 / OPS-02 / D-06 — Job Monitor iframe wrapper.
 * Renders bull-board as a same-origin iframe (vite.config.ts proxies /admin/bull-board to the API)
 * so the iframe inherits the better-auth session cookie. CSP frame-ancestors '${ADMIN_URL}'
 * (set by the API per D-04) refuses embedding from any other origin.
 */
export function Component() {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // iframeKey forces React to remount the iframe on retry.
  const [iframeKey, setIframeKey] = useState(0);

  const reload = () => {
    setError(false);
    setLoading(true);
    setIframeKey((k) => k + 1);
  };

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-medium">{t("jobs.title")}</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-destructive mb-4" aria-hidden />
            <p className="text-sm text-muted-foreground mb-4">{t("jobs.loadError")}</p>
            <Button variant="outline" onClick={reload}>
              {t("jobs.retry")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-medium">{t("jobs.title")}</h1>
      </header>
      <div className="relative">
        {loading && (
          <>
            <Skeleton
              className="absolute inset-0 h-[calc(100vh-3.5rem-6rem)] w-full"
              aria-busy="true"
              aria-live="polite"
            />
            <span className="sr-only">{tc("loading")}</span>
          </>
        )}
        <IframeWithErrorHandler
          key={iframeKey}
          src="/admin/bull-board"
          title={t("jobs.iframeTitle")}
          className="h-[calc(100vh-3.5rem-6rem)] w-full border-0 rounded-md"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          onLoad={() => setLoading(false)}
          onError={() => {
            setError(true);
            setLoading(false);
          }}
        />
      </div>
    </div>
  );
}
