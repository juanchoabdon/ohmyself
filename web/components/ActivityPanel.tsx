"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, X } from "lucide-react";
import { api } from "@/lib/api";
import type { HistoryEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

function formatWhen(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function authorLabel(author: string): string {
  if (author === "human") return "You";
  if (author.startsWith("agent:")) return author.replace("agent:", "Agent · ");
  return author;
}

function friendlyPath(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.replace(/\.md$/i, "").replace(/-/g, " ");
}

export function ActivityPanel({
  token,
  open,
  onClose,
  onOpenNote,
  refreshKey,
}: {
  token: string | null;
  open: boolean;
  onClose: () => void;
  onOpenNote: (path: string) => void;
  /** Bump to refetch (e.g. on SSE brain event). */
  refreshKey?: number;
}) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await api.spaceActivity(token, { limit: 40 });
      setEntries(res.entries);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!open || !token) return;
    void load();
  }, [open, token, load, refreshKey]);

  if (!open) return null;

  return (
    <aside className="flex min-h-0 w-72 shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <Clock className="h-3.5 w-3.5 text-muted" />
          Activity
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted hover:bg-bg hover:text-ink"
          aria-label="Close activity"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <p className="px-2 py-6 text-center text-xs text-muted">Loading…</p>
        ) : !entries?.length ? (
          <p className="px-2 py-6 text-center text-xs leading-relaxed text-muted">
            No edits yet in this space
          </p>
        ) : (
          <ul className="space-y-1">
            {entries.map((entry) => (
              <li key={`${entry.path}-${entry.version}`}>
                <button
                  type="button"
                  onClick={() => entry.path && onOpenNote(entry.path)}
                  className="w-full rounded-md border border-border/80 bg-bg/40 px-2 py-1.5 text-left transition-colors hover:border-brand/30 hover:bg-brand-weak"
                >
                  <p className="truncate text-xs font-medium text-ink">
                    {entry.path ? friendlyPath(entry.path) : "Note"}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-muted">{entry.summary || entry.op || "Edit"}</p>
                  <p className="mt-0.5 text-[10px] text-muted/80">
                    {authorLabel(entry.author)} · {formatWhen(entry.timestamp)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
