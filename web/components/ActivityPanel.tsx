"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Clock, X } from "lucide-react";
import { api } from "@/lib/api";
import type { HistoryEntry } from "@/lib/types";
import { agentCollabUser } from "@/lib/collabUser";
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

function authorLabel(author: string | undefined | null): string {
  const a = author ?? "unknown";
  if (a === "human") return "You";
  if (a.startsWith("agent:")) return a.replace("agent:", "Agent · ");
  return a;
}

function friendlyPath(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.replace(/\.md$/i, "").replace(/-/g, " ");
}

function isAgentAuthor(author: string | undefined | null): boolean {
  const a = author ?? "";
  return a.startsWith("agent:") || a === "ohmyself";
}

export function ActivityPanel({
  token,
  open,
  onClose,
  onOpenNote,
  refreshKey,
  authorFilter,
  notePath,
  onClearAuthorFilter,
}: {
  token: string | null;
  open: boolean;
  onClose: () => void;
  onOpenNote: (path: string) => void;
  /** Bump to refetch (e.g. on SSE brain event). */
  refreshKey?: number;
  /** Filter to one author (e.g. agent session from PresenceBar). */
  authorFilter?: string | null;
  /** Current note — entries for this path sort to the top. */
  notePath?: string | null;
  onClearAuthorFilter?: () => void;
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

  const visible = useMemo(() => {
    if (!entries?.length) return [];
    let list = entries;
    if (authorFilter) {
      list = list.filter((e) => e.author === authorFilter);
    }
    if (notePath) {
      list = [...list].sort((a, b) => {
        const aHere = a.path === notePath ? 1 : 0;
        const bHere = b.path === notePath ? 1 : 0;
        return bHere - aHere;
      });
    }
    return list;
  }, [entries, authorFilter, notePath]);

  const grouped = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>();
    for (const entry of visible) {
      const key = entry.author ?? "unknown";
      const bucket = map.get(key) ?? [];
      bucket.push(entry);
      map.set(key, bucket);
    }
    return [...map.entries()].sort((a, b) => {
      const aTs = a[1][0]?.timestamp ?? 0;
      const bTs = b[1][0]?.timestamp ?? 0;
      return bTs - aTs;
    });
  }, [visible]);

  if (!open) return null;

  return (
    <aside className="flex min-h-0 w-72 shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            <Clock className="h-3.5 w-3.5 shrink-0 text-muted" />
            Activity
          </div>
          {authorFilter && (
            <button
              type="button"
              onClick={onClearAuthorFilter}
              className="truncate text-left text-[10px] text-brand hover:underline"
            >
              Filtered: {authorLabel(authorFilter)} · clear
            </button>
          )}
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
        ) : !visible.length ? (
          <p className="px-2 py-6 text-center text-xs leading-relaxed text-muted">
            {authorFilter ? "No edits from this author yet" : "No edits yet in this space"}
          </p>
        ) : (
          <ul className="space-y-3">
            {grouped.map(([author, items]) => {
              const agent = isAgentAuthor(author);
              const agentUser = agent ? agentCollabUser(author) : null;
              return (
                <li key={author}>
                  <div className="mb-1 flex items-center gap-1.5 px-1">
                    <span
                      className="grid h-5 w-5 place-items-center rounded-full text-[9px] font-semibold text-white"
                      style={{ backgroundColor: agentUser?.color ?? "var(--brand)" }}
                    >
                      {agent ? <Bot className="h-3 w-3" aria-hidden /> : authorLabel(author).slice(0, 1)}
                    </span>
                    <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted">
                      {authorLabel(author)}
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {items.map((entry) => (
                      <li key={`${entry.path}-${entry.version}`}>
                        <button
                          type="button"
                          onClick={() => entry.path && onOpenNote(entry.path)}
                          className={cn(
                            "w-full rounded-md border px-2 py-1.5 text-left transition-colors hover:border-brand/30 hover:bg-brand-weak",
                            entry.path === notePath
                              ? "border-brand/25 bg-brand-weak/40"
                              : "border-border/80 bg-bg/40",
                          )}
                        >
                          <p className="truncate text-xs font-medium text-ink">
                            {entry.path ? friendlyPath(entry.path) : "Note"}
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-[10px] text-muted">
                            {entry.summary || entry.op || "Edit"}
                          </p>
                          <p className="mt-0.5 text-[10px] text-muted/80">{formatWhen(entry.timestamp)}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
