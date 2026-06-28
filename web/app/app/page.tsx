"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabaseClient";
import type { FullNote, IndexedNote, Visibility } from "@/lib/types";
import { Sidebar } from "@/components/Sidebar";
import { NoteView } from "@/components/NoteView";
import { Chat } from "@/components/Chat";

export default function Dashboard() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const [baseNotes, setBaseNotes] = useState<IndexedNote[]>([]);
  const [searchResults, setSearchResults] = useState<IndexedNote[] | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [visFilter, setVisFilter] = useState<Visibility | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [fullNote, setFullNote] = useState<FullNote | null>(null);
  const [noteLoading, setNoteLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

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

  if (!token || !ready) {
    return <div className="grid min-h-screen place-items-center text-muted">Loading your brain…</div>;
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-surface px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-lg font-semibold tracking-tight text-brand-ink">ohmyself!</span>
          <span className="text-xs text-muted">{baseNotes.length} notes</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setChatOpen((v) => !v)}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-95"
          >
            Ask your brain
          </button>
          <button onClick={signOut} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:text-ink">
            Sign out
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar
          notes={displayed}
          selected={selected}
          onSelect={openNote}
          query={query}
          onQuery={setQuery}
          typeFilter={typeFilter}
          onTypeFilter={setTypeFilter}
          visFilter={visFilter}
          onVisFilter={setVisFilter}
        />
        <main className="min-w-0 flex-1 overflow-y-auto bg-bg">
          <NoteView note={fullNote} loading={noteLoading} onOpenLink={openNote} />
        </main>
        <Chat token={token} open={chatOpen} onClose={() => setChatOpen(false)} onOpenNote={openNote} />
      </div>
    </div>
  );
}
