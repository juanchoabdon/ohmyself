"use client";

import { useCallback, useState } from "react";
import { Check, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function ShareNoteButton({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  }, [url]);

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium transition-colors",
        copied ? "border-brand bg-brand-weak text-brand-ink" : "text-muted hover:border-brand hover:text-brand-ink",
        className,
      )}
      title="Copy link to this note"
      aria-label={copied ? "Link copied" : "Copy link to this note"}
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5" />
          Copied
        </>
      ) : (
        <>
          <Link2 className="h-3.5 w-3.5" />
          Share
        </>
      )}
    </button>
  );
}
