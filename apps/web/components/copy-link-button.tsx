"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@baseworks/ui";

interface CopyLinkButtonProps {
  text: string;
  label: string;
  copiedLabel: string;
}

export function CopyLinkButton({ text, label, copiedLabel }: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write can fail (permissions, HTTP context, unfocused page)
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleCopy} aria-live="polite">
      {copied ? (
        <><Check className="h-4 w-4" />{copiedLabel}</>
      ) : (
        <><Copy className="h-4 w-4" />{label}</>
      )}
    </Button>
  );
}
