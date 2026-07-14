"use client";

import { FileCode2, Type } from "lucide-react";
import { cn } from "@/lib/utils";

export type EditorMode = "visual" | "source";

export function EditorModeToggle({
  mode,
  onChange,
  disabled,
  disabledReason,
}: {
  mode: EditorMode;
  onChange: (mode: EditorMode) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <div
      className="flex items-center justify-end gap-1 border-b border-border/60 px-1 py-1"
      title={disabled ? disabledReason : undefined}
    >
      <div
        className={cn(
          "flex gap-0.5 rounded-lg bg-bg p-0.5 text-[11px]",
          disabled && "pointer-events-none opacity-50",
        )}
        role="tablist"
        aria-label="Editor mode"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "visual"}
          onClick={() => onChange("visual")}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors",
            mode === "visual" ? "bg-surface text-brand-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          <Type className="h-3 w-3" aria-hidden />
          Visual
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "source"}
          onClick={() => onChange("source")}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors",
            mode === "source" ? "bg-surface text-brand-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          <FileCode2 className="h-3 w-3" aria-hidden />
          Source
        </button>
      </div>
    </div>
  );
}

export function loadEditorModePreference(): EditorMode {
  if (typeof window === "undefined") return "visual";
  try {
    const v = localStorage.getItem("oms-editor-mode");
    return v === "source" ? "source" : "visual";
  } catch {
    return "visual";
  }
}

export function saveEditorModePreference(mode: EditorMode): void {
  try {
    localStorage.setItem("oms-editor-mode", mode);
  } catch {
    /* ignore */
  }
}
