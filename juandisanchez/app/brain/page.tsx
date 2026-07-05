"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { BrainMap } from "@/components/BrainMap";
import { RichMarkdown, type AllowedLink } from "@/components/Rich";
import { detectLang, strings, type Lang, type BrainStrings } from "@/lib/i18n";
import type { IndexedNote } from "@/lib/types";

/**
 * The Second Brain — the SAME public notes the chat agent is grounded in,
 * browsable directly: as an Obsidian-style folder list, or as the brain
 * graph (ported from ohmyself!'s own dashboard). Nothing here is generated
 * by a model; it's Juan Diego's own public notes, verbatim.
 */

interface NoteSummary {
  path: string;
  title: string;
  type: string;
  tags: string[];
  links: string[];
  created?: string;
  updated?: string;
  excerpt?: string;
}

interface NoteFull {
  path: string;
  title: string;
  type: string;
  tags: string[];
  body: string;
  created?: string;
  updated?: string;
}

type ViewMode = "list" | "graph";

/** A note's OWN links — the only URLs that could ever legitimately appear
 *  while rendering it, so they double as its allowlist for RichMarkdown
 *  (no model in the loop here, unlike the chat). */
function extractUrls(body: string): string[] {
  const out = new Set<string>();
  const re = /https?:\/\/[^\s)\]}"'<>]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.add(m[0].replace(/[.,;:!?]+$/, ""));
  return [...out];
}

export default function BrainPage() {
  const [lang, setLang] = useState<Lang>("en");
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<ViewMode>("list");
  const [query, setQuery] = useState("");
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<NoteFull | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  const [openError, setOpenError] = useState(false);

  const t = strings(lang);

  useEffect(() => {
    let chosen: Lang;
    try {
      const saved = localStorage.getItem("jds.lang");
      chosen = saved === "es" || saved === "en" ? saved : detectLang();
    } catch {
      chosen = detectLang();
    }
    setLang(chosen);
    if (typeof document !== "undefined") document.documentElement.lang = chosen;
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/brain/notes")
      .then((r) => r.json())
      .then((d: { notes?: NoteSummary[] }) => {
        if (alive) setNotes(d.notes ?? []);
      })
      .catch(() => {
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  function onLang(next: Lang) {
    setLang(next);
    if (typeof document !== "undefined") document.documentElement.lang = next;
    try {
      localStorage.setItem("jds.lang", next);
    } catch {
      /* storage unavailable — fine, just won't persist */
    }
  }

  const openNoteByPath = useCallback((path: string) => {
    setOpenPath(path);
    setOpenNote(null);
    setOpenError(false);
    setOpenLoading(true);
    fetch(`/api/brain/note?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((d: { note?: NoteFull }) => {
        if (d.note) setOpenNote(d.note);
        else setOpenError(true);
      })
      .catch(() => setOpenError(true))
      .finally(() => setOpenLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!notes) return [];
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) => n.title.toLowerCase().includes(q) || n.tags.some((tg) => tg.toLowerCase().includes(q)),
    );
  }, [notes, query]);

  const groups = useMemo(() => {
    const map = new Map<string, NoteSummary[]>();
    for (const n of filtered) {
      const arr = map.get(n.type) ?? [];
      arr.push(n);
      map.set(n.type, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.title.localeCompare(b.title));
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const graphNotes: IndexedNote[] = useMemo(
    () =>
      (notes ?? []).map((n) => ({
        path: n.path,
        title: n.title,
        type: n.type,
        visibility: "public" as const,
        tags: n.tags,
        links: n.links,
        created: n.created,
        updated: n.updated,
        excerpt: n.excerpt,
      })),
    [notes],
  );

  const loadSemantic = useCallback(async () => {
    const res = await fetch("/api/brain/semantic");
    const data = (await res.json()) as {
      enabled?: boolean;
      edges?: { a: string; b: string; score: number }[];
    };
    return { enabled: Boolean(data.enabled), edges: data.edges ?? [] };
  }, []);

  const noteLinks: AllowedLink[] = useMemo(
    () => (openNote ? extractUrls(openNote.body).map((url) => ({ url, label: openNote.title })) : []),
    [openNote],
  );

  return (
    <main className="mx-auto flex h-[100dvh] w-full max-w-5xl flex-col px-5 sm:px-8">
      <SiteHeader lang={lang} onLang={onLang} active="brain" />

      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h2 className="font-heading text-lg font-semibold tracking-tight">{t.brain.title}</h2>
          <p className="text-sm text-muted">{t.brain.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {notes && <span className="hidden text-xs text-faint sm:inline">{t.brain.notesCount(notes.length)}</span>}
          <div className="flex items-center rounded-full border border-border bg-surface p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setView("list")}
              className={`rounded-full px-3 py-1.5 font-medium transition-colors ${
                view === "list" ? "bg-brand text-white" : "text-muted hover:text-ink"
              }`}
            >
              {t.brain.listView}
            </button>
            <button
              type="button"
              onClick={() => setView("graph")}
              className={`rounded-full px-3 py-1.5 font-medium transition-colors ${
                view === "graph" ? "bg-brand text-white" : "text-muted hover:text-ink"
              }`}
            >
              {t.brain.graphView}
            </button>
          </div>
        </div>
      </div>

      {view === "list" ? (
        <div className="flex flex-1 flex-col overflow-hidden pb-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.brain.searchPlaceholder}
            className="mb-3 w-full shrink-0 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none"
            aria-label={t.brain.searchPlaceholder}
          />
          <div className="-mr-3 flex-1 overflow-y-auto pr-3 sm:-mr-5 sm:pr-5" style={{ scrollbarGutter: "stable" }}>
            {!notes && !loadError && <p className="px-1 text-sm text-muted">{t.brain.loading}</p>}
            {loadError && <p className="px-1 text-sm text-muted">{t.brain.loadError}</p>}
            {notes && notes.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center">
                <p className="font-heading text-base font-semibold">{t.brain.emptyTitle}</p>
                <p className="mt-1 text-sm text-muted">{t.brain.emptySub}</p>
              </div>
            )}
            <div className="space-y-3 pb-2">
              {groups.map(([type, items]) => (
                <FolderGroup key={type} type={type} items={items} onOpen={openNoteByPath} />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="relative mb-4 flex-1 overflow-hidden rounded-2xl border border-border">
          <BrainMap notes={graphNotes} onOpenNote={openNoteByPath} loadSemantic={loadSemantic} />
        </div>
      )}

      {openPath && (
        <NoteDrawer
          path={openPath}
          note={openNote}
          loading={openLoading}
          error={openError}
          lang={lang}
          links={noteLinks}
          onClose={() => setOpenPath(null)}
          t={t.brain}
        />
      )}
    </main>
  );
}

function FolderGroup({
  type,
  items,
  onOpen,
}: {
  type: string;
  items: NoteSummary[];
  onOpen: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-elevated"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 font-heading text-sm font-semibold capitalize text-ink">
          <FolderIcon open={open} />
          {type}
        </span>
        <span className="text-xs text-faint">{items.length}</span>
      </button>
      {open && (
        <ul className="divide-y divide-border border-t border-border">
          {items.map((n) => (
            <li key={n.path}>
              <button
                type="button"
                onClick={() => onOpen(n.path)}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-elevated"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{n.title}</span>
                {n.tags.length > 0 && (
                  <span className="hidden shrink-0 items-center gap-1 sm:flex">
                    {n.tags.slice(0, 2).map((tg) => (
                      <span key={tg} className="rich-chip">
                        {tg}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NoteDrawer({
  note,
  loading,
  error,
  lang,
  links,
  onClose,
  t,
}: {
  path: string;
  note: NoteFull | null;
  loading: boolean;
  error: boolean;
  lang: Lang;
  links: AllowedLink[];
  onClose: () => void;
  t: BrainStrings;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex h-full w-full max-w-lg flex-col border-l border-border bg-bg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="truncate font-heading text-base font-semibold text-ink">{note?.title ?? "…"}</p>
            {note && (
              <p className="text-xs capitalize text-faint">
                {note.type}
                {note.updated ? ` · ${note.updated}` : ""}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4" style={{ scrollbarGutter: "stable" }}>
          {loading && <p className="text-sm text-muted">{t.loading}</p>}
          {!loading && error && <p className="text-sm text-muted">{t.loadError}</p>}
          {!loading && note && (
            <div className="prose">
              <RichMarkdown lang={lang} allowedLinks={links}>
                {note.body}
              </RichMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FolderIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-brand-ink" aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3V7Z" />
      <path d="M3 10h18l-1.5 9.5A2 2 0 0 1 17.53 21H6.47a2 2 0 0 1-1.97-1.5L3 10Z" />
    </svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted" aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}
