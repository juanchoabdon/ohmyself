"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabaseClient";
import type { Category, FullNote, IndexedNote, Visibility } from "@/lib/types";
import { Sidebar } from "@/components/Sidebar";
import { NoteView } from "@/components/NoteView";
import { BrainMap } from "@/components/BrainMap";
import { Chat } from "@/components/Chat";
import { Settings } from "@/components/Settings";
import { ConfirmDialog, CreateEntryDialog, PromptDialog, type CreateEntryValues } from "@/components/dialogs";
import { ThemeToggle } from "@/components/ThemeToggle";

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "untitled"
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const [baseNotes, setBaseNotes] = useState<IndexedNote[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [searchResults, setSearchResults] = useState<IndexedNote[] | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [visFilter, setVisFilter] = useState<Visibility | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [fullNote, setFullNote] = useState<FullNote | null>(null);
  const [noteLoading, setNoteLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [view, setView] = useState<"notes" | "map">("notes");

  // Remember the last chosen tab (Notes / Map). Read after mount to avoid a
  // hydration mismatch; persisted on every change.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("oms-view");
      if (saved === "map" || saved === "notes") setView(saved);
    } catch {
      /* storage unavailable — fine */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("oms-view", view);
    } catch {
      /* storage unavailable — fine */
    }
  }, [view]);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auth bootstrap
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const t = data.session?.access_token ?? null;
      if (!t) {
        router.replace("/login");
        return;
      }
      setToken(t);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) router.replace("/login");
      else setToken(session.access_token);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  // Onboard + load notes once we have a token
  useEffect(() => {
    if (!token) return;
    let active = true;
    (async () => {
      try {
        await api.onboard(token);
      } catch {
        /* non-fatal */
      }
      try {
        const { categories } = await api.structure(token);
        if (active) setCategories(categories);
      } catch {
        /* non-fatal */
      }
      try {
        const { notes } = await api.listNotes(token);
        if (active) setBaseNotes(notes);
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  // Debounced server search
  useEffect(() => {
    if (!token) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const { results } = await api.search(token, q);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      }
    }, 250);
  }, [query, token]);

  const displayed = useMemo(() => {
    const list = searchResults ?? baseNotes;
    return list.filter((n) => {
      if (typeFilter && n.type !== typeFilter) return false;
      if (visFilter && n.visibility !== visFilter) return false;
      return true;
    });
  }, [searchResults, baseNotes, typeFilter, visFilter]);

  async function openNote(path: string) {
    if (!token) return;
    setView("notes");
    setSelected(path);
    setNoteLoading(true);
    setFullNote(null);
    try {
      setFullNote(await api.readNote(token, path));
    } catch {
      setFullNote(null);
    } finally {
      setNoteLoading(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  // ── Editing: create / update / delete / rename ─────────────────────────────
  const [createFolder, setCreateFolder] = useState<{ folder: string | null } | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [renameFolder, setRenameFolder] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "note" | "folder"; path: string; count?: number } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  async function refresh(open?: string | null) {
    if (!token) return;
    try {
      const [{ notes }, { categories: cats }] = await Promise.all([
        api.listNotes(token),
        api.structure(token),
      ]);
      setBaseNotes(notes);
      setCategories(cats);
    } catch {
      /* non-fatal */
    }
    if (open !== undefined) {
      if (open) await openNote(open);
      else {
        setSelected(null);
        setFullNote(null);
      }
    }
  }

  async function handleCreate(values: CreateEntryValues) {
    if (!token || !createFolder) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const folder = createFolder.folder;
      const path = folder ? `${folder}/${slugify(values.title)}.md` : undefined;
      const { path: created } = await api.createNote(token, {
        type: values.type,
        title: values.title,
        body: values.body,
        visibility: values.visibility,
        path,
      });
      setCreateFolder(null);
      await refresh(created);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Could not create entry");
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleSaveNote(patch: {
    title?: string;
    body?: string;
    visibility?: Visibility;
    tags?: string[];
  }) {
    if (!token || !selected) return;
    await api.updateNote(token, selected, patch);
    await refresh(selected);
  }

  async function runConfirm() {
    if (!token || !confirm) return;
    setActionBusy(true);
    try {
      if (confirm.kind === "note") {
        const wasSelected = selected === confirm.path;
        await api.deleteNote(token, confirm.path);
        setConfirm(null);
        await refresh(wasSelected ? null : selected);
      } else {
        const prefix = confirm.path + "/";
        const affected = baseNotes.filter((n) => n.path.startsWith(prefix));
        for (const n of affected) await api.deleteNote(token, n.path);
        const selectedGone = selected ? selected.startsWith(prefix) : false;
        setConfirm(null);
        await refresh(selectedGone ? null : selected);
      }
    } catch (e) {
      setConfirm(null);
      setBanner(e instanceof Error ? e.message : "Could not delete");
    } finally {
      setActionBusy(false);
    }
  }

  async function runRename(newName: string) {
    if (!token || !renameFolder) return;
    setActionBusy(true);
    try {
      const folder = renameFolder;
      const lastSlash = folder.lastIndexOf("/");
      const parent = lastSlash >= 0 ? folder.slice(0, lastSlash) : "";
      const newFolder = parent ? `${parent}/${slugify(newName)}` : slugify(newName);
      if (newFolder !== folder) {
        const prefix = folder + "/";
        const affected = baseNotes.filter((n) => n.path.startsWith(prefix));
        let newSelected = selected;
        for (const n of affected) {
          const to = newFolder + n.path.slice(folder.length);
          await api.moveNote(token, n.path, to);
          if (selected === n.path) newSelected = to;
        }
        setRenameFolder(null);
        await refresh(newSelected);
      } else {
        setRenameFolder(null);
      }
    } catch (e) {
      setRenameFolder(null);
      setBanner(e instanceof Error ? e.message : "Could not rename folder");
    } finally {
      setActionBusy(false);
    }
  }

  if (!token || !ready) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-surface px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <Link
            href="/"
            className="font-display text-lg font-semibold tracking-tight text-brand-ink transition-opacity hover:opacity-80"
            aria-label="Go to ohmyself! home"
          >
            ohmyself!
          </Link>
          <span className="text-xs text-muted">
            {baseNotes.length === 0
              ? "Empty"
              : `${baseNotes.length} ${baseNotes.length === 1 ? "entry" : "entries"}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="mr-1 flex items-center rounded-lg border border-border bg-bg p-0.5 text-sm">
            {(["notes", "map"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors ${
                  view === v ? "bg-surface text-brand-ink shadow-sm" : "text-muted hover:text-ink"
                }`}
              >
                {v === "notes" ? <NotesIcon /> : <MapIcon />}
                <span className="hidden sm:inline">{v === "notes" ? "Notes" : "Map"}</span>
              </button>
            ))}
          </div>
          <button
            onClick={() => setChatOpen((v) => !v)}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-95"
          >
            Ask yourself
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-ink hover:border-brand hover:text-brand-ink"
          >
            Connect
          </button>
          <ThemeToggle />
          <button onClick={signOut} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:text-ink">
            Sign out
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar
          notes={displayed}
          categories={categories}
          selected={selected}
          onSelect={openNote}
          query={query}
          onQuery={setQuery}
          typeFilter={typeFilter}
          onTypeFilter={setTypeFilter}
          visFilter={visFilter}
          onVisFilter={setVisFilter}
          onCreateInside={(folder) => {
            setCreateError(null);
            setCreateFolder({ folder });
          }}
          onRenameFolder={(folder) => setRenameFolder(folder)}
          onDeleteFolder={(folder) =>
            setConfirm({
              kind: "folder",
              path: folder,
              count: baseNotes.filter((n) => n.path.startsWith(folder + "/")).length,
            })
          }
        />
        <main
          className={`min-w-0 flex-1 ${
            view === "map" ? "relative overflow-hidden" : "overflow-y-auto bg-bg"
          }`}
        >
          {view === "map" ? (
            <BrainMap
              notes={baseNotes}
              onOpenNote={openNote}
              loadSemantic={token ? () => api.semanticLinks(token) : undefined}
            />
          ) : (
            <NoteView
              note={fullNote}
              loading={noteLoading}
              onOpenLink={openNote}
              onSave={handleSaveNote}
              onDelete={async () => {
                if (selected) setConfirm({ kind: "note", path: selected });
              }}
            />
          )}
        </main>
        <Chat token={token} open={chatOpen} onClose={() => setChatOpen(false)} onOpenNote={openNote} />
      </div>

      <Settings token={token} open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {createFolder && (
        <CreateEntryDialog
          folder={createFolder.folder}
          defaultType={createFolder.folder ? createFolder.folder.split("/")[0]! : "note"}
          busy={createBusy}
          error={createError}
          onSubmit={handleCreate}
          onClose={() => setCreateFolder(null)}
        />
      )}

      {renameFolder && (
        <PromptDialog
          title="Rename folder"
          label="New name"
          initialValue={renameFolder.split("/").pop() ?? renameFolder}
          confirmLabel="Rename"
          busy={actionBusy}
          onSubmit={runRename}
          onClose={() => setRenameFolder(null)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === "note" ? "Delete entry?" : "Delete folder?"}
          busy={actionBusy}
          message={
            confirm.kind === "note" ? (
              <>
                This permanently deletes <span className="font-medium text-ink">{confirm.path}</span>. This
                can&apos;t be undone.
              </>
            ) : (
              <>
                This permanently deletes <span className="font-medium text-ink">{confirm.path}</span> and all{" "}
                <span className="font-medium text-ink">{confirm.count ?? 0}</span> entr
                {(confirm.count ?? 0) === 1 ? "y" : "ies"} inside it. This can&apos;t be undone.
              </>
            )
          }
          onConfirm={runConfirm}
          onClose={() => setConfirm(null)}
        />
      )}

      {banner && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-ink px-4 py-2.5 text-sm text-bg shadow-lg">
          <span>{banner}</span>
          <button onClick={() => setBanner(null)} className="ml-3 font-medium underline">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function NotesIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 4h11l5 5v11a0 0 0 0 1 0 0H4z" />
      <path d="M14 4v5h5" />
      <path d="M8 13h7M8 17h7" />
    </svg>
  );
}

function MapIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6" cy="7" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <circle cx="17" cy="18" r="2.2" />
      <circle cx="7" cy="17" r="2.2" />
      <path d="M8 8.4 16 7M7.4 9 7 14.8M8.6 16.4 15 17.6M16.6 8 17 15.8" />
    </svg>
  );
}

/** Loading state that mirrors the real shell (header + sidebar + reading column)
 *  so nothing jumps when notes arrive. */
function DashboardSkeleton() {
  const groups = [
    { heading: "w-20", rows: [{ d: 0, w: "58%" }, { d: 1, w: "70%" }, { d: 1, w: "46%" }] },
    { heading: "w-16", rows: [{ d: 0, w: "62%" }, { d: 1, w: "74%" }] },
    { heading: "w-24", rows: [{ d: 0, w: "52%" }, { d: 1, w: "66%" }, { d: 1, w: "58%" }, { d: 2, w: "42%" }] },
    { heading: "w-14", rows: [{ d: 0, w: "60%" }] },
  ];
  const para = ["100%", "94%", "88%", "97%", "72%"];

  return (
    <div className="flex h-screen flex-col" aria-busy="true" aria-label="Loading your second self">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-surface px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="skeleton h-5 w-28 rounded-md" />
          <span className="skeleton h-3 w-14 rounded" />
        </div>
        <div className="flex items-center gap-2">
          <span className="skeleton h-8 w-24 rounded-lg" />
          <span className="skeleton h-8 w-20 rounded-lg" />
          <span className="skeleton h-8 w-16 rounded-lg" />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-surface">
          <div className="border-b border-border p-3">
            <span className="skeleton block h-9 w-full rounded-lg" />
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {["w-10", "w-14", "w-16", "w-14"].map((w, i) => (
                <span key={i} className={`skeleton h-5 ${w} rounded-full`} />
              ))}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {["w-12", "w-16", "w-10"].map((w, i) => (
                <span key={i} className={`skeleton h-5 ${w} rounded-full`} />
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-hidden p-2">
            {groups.map((g, gi) => (
              <div key={gi} className="mb-3">
                <div className="px-2 py-1">
                  <span className={`skeleton block h-2.5 ${g.heading} rounded`} />
                </div>
                {g.rows.map((r, ri) => (
                  <div key={ri} className="flex items-center py-1.5 pr-2" style={{ paddingLeft: 8 + r.d * 14 }}>
                    <span className="skeleton h-3.5 rounded" style={{ width: r.w }} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-hidden bg-bg">
          <div className="mx-auto max-w-3xl px-8 py-10">
            <span className="skeleton block h-7 w-1/2 rounded-md" />
            <div className="mt-3 flex gap-2">
              <span className="skeleton h-4 w-16 rounded-full" />
              <span className="skeleton h-4 w-20 rounded-full" />
            </div>
            <div className="mt-8 space-y-3">
              {para.map((w, i) => (
                <span key={i} className="skeleton block h-3.5 rounded" style={{ width: w }} />
              ))}
            </div>
            <div className="mt-8 space-y-3">
              {["96%", "80%", "90%"].map((w, i) => (
                <span key={i} className="skeleton block h-3.5 rounded" style={{ width: w }} />
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
