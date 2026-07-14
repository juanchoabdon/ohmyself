"use client";

import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function BlockDeleteButton({
  label,
  onClick,
  className,
}: {
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded p-1 text-muted hover:bg-vis-secret/10 hover:text-vis-secret",
        className,
      )}
      aria-label={label}
      title={label}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}
