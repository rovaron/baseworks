import * as React from "react";

export function SkipToContent({
  label,
  targetId = "main-content",
}: {
  label: string;
  targetId?: string;
}) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:text-foreground focus:shadow-md focus:ring-2 focus:ring-ring"
    >
      {label}
    </a>
  );
}
