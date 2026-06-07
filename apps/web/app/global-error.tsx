"use client";

import { useEffect } from "react";

/**
 * Root error boundary. Replaces the root layout when an error is thrown in it,
 * so it must render its own <html> and <body>. Kept dependency-light and
 * self-contained (inline styles) since global CSS and providers are unavailable
 * at this level.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "1.5rem",
          textAlign: "center",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          color: "#0a0a0a",
          background: "#ffffff",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>Something went wrong</h1>
        <p style={{ fontSize: "0.875rem", color: "#71717a", margin: 0, maxWidth: "32rem" }}>
          A critical error occurred and the application could not recover. Please try again.
        </p>
        {error.digest && (
          <p style={{ fontSize: "0.75rem", color: "#a1a1aa", margin: 0 }}>
            Error reference: {error.digest}
          </p>
        )}
        <button
          type="button"
          onClick={() => reset()}
          style={{
            cursor: "pointer",
            borderRadius: "0.5rem",
            border: "none",
            background: "#0a0a0a",
            color: "#ffffff",
            padding: "0.5rem 1rem",
            fontSize: "0.875rem",
            fontWeight: 500,
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
