"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, Link2, ListTree, RotateCcw, X } from "lucide-react";
import { api } from "@/lib/api";
import type { FullNote, HistoryEntry, LinkContextResult } from "@/lib/types";
import type { OutlineItem } from "@/lib/outline";
import { extractOutline } from "@/lib/outline";
import { cn } from "@/lib/utils";

const OUTLINE_LEVEL: Record<number, { className: string; label: string }> = {
  1: { className: "text-sm font-semibold text-ink", label: "Section" },
  2: { className: "text-sm font-medium text-ink/90", label: "Subsection" },
  3: { className: "text-xs font-medium text-muted", label: "Subheading" },
};

function friendlyLinkLabel(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.replace(/\.md$/i, "").replace(/-/g, " ");
}

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
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function authorLabel(author: string): string {
  if (author === "human") return "You";
  if (author.startsWith("agent:")) return author.replace("agent:", "Agent · ");
  return author;
}

export function DocPanel({
  note,
  tab,
  onTabChange,
  onOpenLink,
  onClose,
  liveBody,
  onOutlineClick,
  token,
  onRestoreVersion,
}: {
  note: FullNote;
  tab: "outline" | "links" | "timeline";
  onTabChange: (tab: "outline" | "links" | "timeline") => void;
  onOpenLink: (path: string) => void;
  onClose: () => void;
  liveBody?: string;
  onOutlineClick?: (item: OutlineItem, occurrence: number) => void;
  token?: string | null;
  onRestoreVersion?: (version: string) => Promise<void>;
}) {
  const outline = useMemo(() => extractOutline(liveBody ?? note.body), [liveBody, note.body]);
  const links = note.meta.links ?? [];
  const [linkCtx, setLinkCtx] = useState<LinkContextResult | null>(null);
  const [linksLoading, setLinksLoading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== "links" || !token) return;
    let cancelled = false;
    setLinksLoading(true);
    void api
      .noteLinkContext(token, note.path, { semanticLimit: 8 })
      .then((res) => {
        if (!cancelled) setLinkCtx(res);
      })
      .catch(() => {
        if (!cancelled) setLinkCtx(null);
      })
      .finally(() => {
        if (!cancelled) setLinksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, token, note.path]);

  useEffect(() => {
    if (tab !== "timeline" || !token) return;
    let cancelled = false;
    setHistoryLoading(true);
    void api
      .noteHistory(token, note.path, { limit: 40 })
      .then((res) => {
        if (!cancelled) setHistory(res.entries);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, token, note.path]);

  return (
    <aside className="flex min-h-0 w-64 shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <div className="flex gap-0.5 rounded-lg bg-bg p-0.5 text-xs">
          {(
            [
              { id: "outline" as const, label: "Outline", icon: ListTree },
              { id: "links" as const, label: "Links", icon: Link2 },
              { id: "timeline" as const, label: "Timeline", icon: Clock },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onTabChange(id)}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors",
                tab === id ? "bg-surface text-brand-ink shadow-sm" : "text-muted hover:text-ink",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted hover:bg-bg hover:text-ink"
          aria-label="Close panel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {tab === "outline" ? (
          outline.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs leading-relaxed text-muted">
              Add headings in the note
              <br />
              <span className="text-muted/70">(# in markdown)</span>
            </p>
          ) : (
            <ul className="space-y-0.5" role="tree" aria-label="Document outline">
              {outline.map((item, i) => {
                const style = OUTLINE_LEVEL[item.level] ?? OUTLINE_LEVEL[3]!;
                const occurrence = outline.slice(0, i).filter((o) => o.text === item.text && o.level === item.level).length;
                return (
                  <li key={`${item.level}-${item.text}-${i}`} role="treeitem" aria-level={item.level}>
                    <button
                      type="button"
                      onClick={() => onOutlineClick?.(item, occurrence)}
                      className="flex w-full min-w-0 items-stretch gap-2 rounded-md py-1 pr-2 text-left transition-colors hover:bg-brand-weak"
                      style={{ paddingLeft: `${(item.level - 1) * 0.75 + 0.5}rem` }}
                      title={`Go to: ${item.text}`}
                    >
                      <span
                        className={cn(
                          "mt-2 w-0.5 shrink-0 rounded-full",
                          item.level === 1 && "bg-brand/70",
                          item.level === 2 && "bg-border",
                          item.level === 3 && "bg-border/60",
                        )}
                        aria-hidden
                      />
                      <span className={cn("min-w-0 truncate leading-snug", style.className)}>{item.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : tab === "links" ? (
          linksLoading ? (
            <p className="px-2 py-6 text-center text-xs text-muted">Loading links…</p>
          ) : !linkCtx && links.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs leading-relaxed text-muted">
              No links yet
              <br />
              <span className="text-muted/70">Use [[path]] in the note</span>
            </p>
          ) : (
            <div className="space-y-3">
              {(linkCtx?.is_orphan || linkCtx?.is_hub) && (
                <div className="flex flex-wrap gap-1 px-2">
                  {linkCtx.is_orphan && (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                      Orphan
                    </span>
                  )}
                  {linkCtx.is_hub && (
                    <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-medium text-brand-ink">
                      Hub · {linkCtx.backlink_count} backlinks
                    </span>
                  )}
                </div>
              )}
              {links.length > 0 && (
                <section>
                  <h4 className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Outgoing
                  </h4>
                  <ul className="space-y-0.5">
                    {links.map((path) => (
                      <li key={`out-${path}`}>
                        <button
                          type="button"
                          onClick={() => onOpenLink(path)}
                          className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-brand-weak hover:text-brand-ink"
                          title={path}
                        >
                          <span className="block truncate text-sm font-medium text-ink">{friendlyLinkLabel(path)}</span>
                          <span className="block truncate text-[10px] text-muted">{path}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {linkCtx && linkCtx.backlinks.length > 0 && (
                <section>
                  <h4 className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Backlinks
                  </h4>
                  <ul className="space-y-0.5">
                    {linkCtx.backlinks.map((n) => (
                      <li key={`in-${n.path}`}>
                        <button
                          type="button"
                          onClick={() => onOpenLink(n.path)}
                          className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-brand-weak hover:text-brand-ink"
                          title={n.path}
                        >
                          <span className="block truncate text-sm font-medium text-ink">{n.title}</span>
                          <span className="block truncate text-[10px] text-muted">{n.path}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {linkCtx && linkCtx.suggestions.length > 0 && (
                <section>
                  <h4 className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Suggested links
                  </h4>
                  <ul className="space-y-0.5">
                    {linkCtx.suggestions.map((s) => (
                      <li key={`sug-${s.path}`}>
                        <button
                          type="button"
                          onClick={() => onOpenLink(s.path)}
                          className="w-full rounded-md border border-dashed border-border/80 px-2 py-1.5 text-left transition-colors hover:border-brand/40 hover:bg-brand-weak/50 hover:text-brand-ink"
                          title={s.path}
                        >
                          <span className="block truncate text-sm font-medium text-ink">{s.title}</span>
                          <span className="block truncate text-[10px] text-muted">{s.path}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )
        ) : historyLoading ? (
          <p className="px-2 py-6 text-center text-xs text-muted">Loading history…</p>
        ) : !history?.length ? (
          <p className="px-2 py-6 text-center text-xs leading-relaxed text-muted">
              No versions yet
              <br />
              <span className="text-muted/70">Edits are tracked per note</span>
          </p>
        ) : (
          <ul className="space-y-1">
            {history.map((entry) => (
              <li key={entry.version}>
                <div className="rounded-md border border-border/80 bg-bg/40 px-2 py-1.5">
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-ink">{entry.summary || "Edit"}</p>
                      <p className="mt-0.5 text-[10px] text-muted">
                        {authorLabel(entry.author)} · {formatWhen(entry.timestamp)}
                      </p>
                    </div>
                    {onRestoreVersion && (
                      <button
                        type="button"
                        disabled={restoring === entry.version}
                        onClick={() => {
                          if (!window.confirm("Restore this version? Current content will be replaced.")) return;
                          setRestoring(entry.version);
                          void onRestoreVersion(entry.version).finally(() => setRestoring(null));
                        }}
                        className="shrink-0 rounded p-1 text-muted transition-colors hover:bg-surface hover:text-brand-ink disabled:opacity-40"
                        title={`Restore ${entry.version.slice(0, 7)}`}
                        aria-label="Restore version"
                      >
                        <RotateCcw className={cn("h-3.5 w-3.5", restoring === entry.version && "animate-spin")} />
                      </button>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-[9px] text-muted/80">{entry.version.slice(0, 7)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
