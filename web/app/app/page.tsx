"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setActiveSpace } from "@/lib/api";
import { supabase } from "@/lib/supabaseClient";
import type { Category, FolderCount, FullNote, HistoryEntry, IndexedNote, Space, Visibility } from "@/lib/types";
import { Sidebar } from "@/components/Sidebar";
import { NoteView, type NoteViewHandle } from "@/components/NoteView";
import { ActivityPanel } from "@/components/ActivityPanel";
import { BrainMap } from "@/components/BrainMap";
import { Chat } from "@/components/Chat";
import { Settings } from "@/components/Settings";
import { ConfirmDialog, CreateEntryDialog, PromptDialog, type CreateEntryValues } from "@/components/dialogs";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SpaceSwitcher, applySpaceAccent } from "@/components/SpaceSwitcher";
import { CreateSpaceDialog, type CreateSpaceValues } from "@/components/CreateSpaceDialog";
import { ProfileMenu, type SettingsTab } from "@/components/ProfileMenu";
import { EditorTabs } from "@/components/EditorTabs";
import { CommandPalette } from "@/components/CommandPalette";
import { DocPanel } from "@/components/DocPanel";
import {
  closeTab,
  loadEditorTabs,
  reorderTabs,
  saveEditorTabs,
  upsertTab,
  type EditorTab,
} from "@/lib/editorTabs";
import { Clock, PanelRight, Search } from "lucide-react";
import { connectBrainEvents } from "@/lib/brainEvents";
import { fetchCollabEnabled } from "@/lib/collab";
import { collabUserFromSupabase, agentCollabUser, type CollabUser } from "@/lib/collabUser";
import type { PresencePeer } from "@/components/editor/PresenceBar";
import type { OutlineItem } from "@/lib/outline";
import type { ScrollToHeadingTarget } from "@/components/editor/MarkdownEditor";

/** localStorage key holding the last note opened in a given space, so a page
 *  refresh (or coming back to a space) reopens where you left off. */
function openNoteKey(spaceId: string): string {
  return `oms-note:${spaceId}`;
}

/** One-shot deep link from preview_url (?note= & ?space=). */
type DeepLinkTarget = { note?: string; space?: string };

function readDeepLinkFromUrl(): DeepLinkTarget | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const note = params.get("note")?.trim();
  const space = params.get("space")?.trim();
  if (!note && !space) return null;
  const url = new URL(window.location.href);
  url.searchParams.delete("note");
  url.searchParams.delete("space");
  window.history.replaceState({}, "", url.toString());
  return { note: note || undefined, space: space || undefined };
}

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

  // Spaces: the personal "self" brain + any company wikis the user belongs to.
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [createSpaceOpen, setCreateSpaceOpen] = useState(false);
  const [createSpaceBusy, setCreateSpaceBusy] = useState(false);
  const [createSpaceError, setCreateSpaceError] = useState<string | null>(null);
  const activeSpace = useMemo(
    () => spaces.find((s) => s.id === activeSpaceId) ?? spaces.find((s) => s.kind === "self") ?? null,
    [spaces, activeSpaceId],
  );

  const [baseNotes, setBaseNotes] = useState<IndexedNote[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [folderCounts, setFolderCounts] = useState<FolderCount[]>([]);
  const [loadedFolders, setLoadedFolders] = useState<Set<string>>(new Set());
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());
  const [searchResults, setSearchResults] = useState<IndexedNote[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Refs mirror lazy-load state so async callbacks don't read stale closures.
  const loadedRef = useRef<Set<string>>(new Set());
  const loadingRef = useRef<Set<string>>(new Set());
  const allLoadedRef = useRef(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [visFilter, setVisFilter] = useState<Visibility | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [fullNote, setFullNote] = useState<FullNote | null>(null);
  const [noteLoading, setNoteLoading] = useState(false);
  const [notePreviewTitle, setNotePreviewTitle] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(undefined);
  const [view, setView] = useState<"notes" | "map">("notes");
  const [openTabs, setOpenTabs] = useState<EditorTab[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [docPanelOpen, setDocPanelOpen] = useState(true);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);
  const [docPanelTab, setDocPanelTab] = useState<"outline" | "links" | "timeline">("outline");
  const [editorBody, setEditorBody] = useState<string | undefined>(undefined);
  const [scrollToHeading, setScrollToHeading] = useState<ScrollToHeadingTarget | null>(null);
  const [collabEnabled, setCollabEnabled] = useState(false);
  const [collabUser, setCollabUser] = useState<CollabUser | null>(null);
  const [activityAuthorFilter, setActivityAuthorFilter] = useState<string | null>(null);
  const [recentActivity, setRecentActivity] = useState<HistoryEntry[]>([]);
  const deepLinkRef = useRef<DeepLinkTarget | null>(readDeepLinkFromUrl());

  const agentPresence = useMemo((): PresencePeer[] => {
    if (!selected) return [];
    const cutoff = Date.now() / 1000 - 15 * 60;
    const agents = new Map<string, PresencePeer>();
    for (const entry of recentActivity) {
      if (!entry?.path || entry.path !== selected) continue;
      const author = entry.author ?? "";
      const agent = author.startsWith("agent:") || author === "ohmyself";
      if (!agent || entry.timestamp < cutoff) continue;
      if (!author || agents.has(author)) continue;
      const user = agentCollabUser(author);
      agents.set(author, {
        clientId: -agents.size,
        id: user.id,
        name: user.name,
        color: user.color,
        kind: "agent",
      });
    }
    return [...agents.values()];
  }, [recentActivity, selected]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void api.spaceActivity(token, { limit: 40 })
      .then((res) => {
        if (active) setRecentActivity(res.entries ?? []);
      })
      .catch(() => {
        if (active) setRecentActivity([]);
      });
    return () => {
      active = false;
    };
  }, [token, activityRefreshKey]);

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

  // Editor tabs persist per space.
  useEffect(() => {
    if (!activeSpaceId) return;
    setOpenTabs(loadEditorTabs(activeSpaceId));
  }, [activeSpaceId]);

  useEffect(() => {
    if (!activeSpaceId) return;
    saveEditorTabs(activeSpaceId, openTabs);
  }, [openTabs, activeSpaceId]);

  useEffect(() => {
    setEditorBody(undefined);
    setScrollToHeading(null);
  }, [selected]);

  useEffect(() => {
    if (!fullNote) return;
    setOpenTabs((prev) => upsertTab(prev, fullNote.path, fullNote.meta.title));
  }, [fullNote?.path, fullNote?.meta.title]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!paletteOpen || !token || !ready) return;
    void ensureAllLoaded();
    // ensureAllLoaded is idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteOpen, token, ready]);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // After the Google OAuth redirect (?connector=…&status=…), open Settings and
  // surface the result, then strip the params from the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connector") !== "google-drive-meetings") return;
    const status = params.get("status");
    const messages: Record<string, string> = {
      connected: "Google account connected — you can now sync meeting notes.",
      denied: "Google connection was cancelled.",
      expired: "That connect link expired — try again.",
      no_refresh_token: "Google didn't grant offline access — remove ohmyself! from your Google account permissions and reconnect.",
      error: "Couldn't connect that Google account.",
    };
    setBanner(messages[status ?? ""] ?? null);
    setSettingsTab("connectors");
    setSettingsOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.delete("connector");
    url.searchParams.delete("status");
    window.history.replaceState({}, "", url.toString());
  }, []);

  useEffect(() => {
    let active = true;
    void fetchCollabEnabled().then((on) => {
      if (active) setCollabEnabled(on);
    });
    return () => {
      active = false;
    };
  }, []);

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
    supabase.auth.getUser().then(({ data }) => {
      if (!active || !data.user) return;
      setCollabUser(collabUserFromSupabase(data.user));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) router.replace("/login");
      else {
        setToken(session.access_token);
        if (session.user) setCollabUser(collabUserFromSupabase(session.user));
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  // Load the spaces the user belongs to (self + companies). Default to the
  // self space; a saved preference (last active space) is honored if still valid.
  useEffect(() => {
    if (!token) return;
    let active = true;
    (async () => {
      try {
        const { spaces: list } = await api.listSpaces(token);
        if (!active) return;
        setSpaces(list);
        const saved = (() => {
          try {
            return localStorage.getItem("oms-space");
          } catch {
            return null;
          }
        })();
        const deep = deepLinkRef.current;
        const pick =
          (deep?.space && list.find((s) => s.id === deep.space)) ||
          list.find((s) => s.id === saved) ||
          list.find((s) => s.kind === "self") ||
          list[0] ||
          null;
        setActiveSpaceId(pick?.id ?? null);
      } catch {
        /* non-fatal — fall back to the implicit self space */
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  // Re-skin the whole UI from the active space's accent (revert to default coral
  // for a space with no chosen color).
  useEffect(() => {
    applySpaceAccent(activeSpace?.themeColor ?? null);
    return () => applySpaceAccent(null);
  }, [activeSpace]);

  // Onboard + load the lightweight tree scaffold (pillar counts) once we have a
  // token and an active space. Notes load lazily per folder — see ensureFolder.
  useEffect(() => {
    if (!token || !activeSpaceId) return;
    let active = true;
    // Point every API call at the active brain, and reset the tree so we don't
    // show one space's notes while another loads.
    setActiveSpace(activeSpaceId);
    try {
      localStorage.setItem("oms-space", activeSpaceId);
    } catch {
      /* storage unavailable — fine */
    }
    setReady(false);
    setBaseNotes([]);
    setSearchResults(null);
    setSelected(null);
    setFullNote(null);
    setFolderCounts([]);
    setCategories([]);
    loadedRef.current = new Set();
    loadingRef.current = new Set();
    allLoadedRef.current = false;
    setLoadedFolders(new Set());
    setLoadingFolders(new Set());
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
        const { folders } = await api.folders(token);
        if (active) setFolderCounts(folders);
      } finally {
        if (active) setReady(true);
      }
      // Reopen the note that was open in this space before the refresh, and
      // expand its pillar so the sidebar highlights it.
      if (active && activeSpaceId) {
        const deep = deepLinkRef.current;
        let saved: string | null = deep?.note ?? null;
        if (!saved) {
          try {
            saved = localStorage.getItem(openNoteKey(activeSpaceId));
          } catch {
            /* storage unavailable — fine */
          }
        } else {
          deepLinkRef.current = null;
        }
        if (saved) {
          const tabTitle =
            loadEditorTabs(activeSpaceId).find((t) => t.path === saved)?.title ??
            saved.split("/").pop()?.replace(/\.md$/, "") ??
            saved;
          // Prime selection + loading shell before ensureFolder so refresh never
          // flashes "Pick an entry" while the saved note is being restored.
          setSelected(saved);
          setNoteLoading(true);
          setNotePreviewTitle(tabTitle);
          await ensureFolder(saved.split("/")[0]!);
          if (active) await openNote(saved);
        }
      }
    })();
    return () => {
      active = false;
    };
    // openNote/ensureFolder are stable within this render and intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeSpaceId]);

  // Debounced server search
  useEffect(() => {
    if (!token) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const { results } = await api.search(token, q);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
  }, [query, token]);

  // The Map graph and client-side type/visibility filters need the full brain,
  // not just the expanded folders, so pull everything the first time they're used.
  useEffect(() => {
    if (!token || !ready) return;
    if (view === "map" || typeFilter || visFilter) void ensureAllLoaded();
    // ensureAllLoaded is idempotent and ref-guarded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, ready, view, typeFilter, visFilter]);

  const displayed = useMemo(() => {
    const list = searchResults ?? baseNotes;
    return list.filter((n) => {
      if (typeFilter && n.type !== typeFilter) return false;
      if (visFilter && n.visibility !== visFilter) return false;
      return true;
    });
  }, [searchResults, baseNotes, typeFilter, visFilter]);

  const folderCountMap = useMemo(
    () => Object.fromEntries(folderCounts.map((f) => [f.folder, f.count])),
    [folderCounts],
  );
  // Commitments are hidden from the sidebar (used by planning skills only), so
  // don't count them in the visible "N entries" total.
  const totalEntries = useMemo(
    () => folderCounts.reduce((s, f) => (f.folder === "commitments" ? s : s + f.count), 0),
    [folderCounts],
  );

  // ── Lazy note loading ──────────────────────────────────────────────────────
  const markLoaded = (folders: string[]) => {
    for (const f of folders) loadedRef.current.add(f);
    setLoadedFolders(new Set(loadedRef.current));
  };

  /** Merge notes in, optionally dropping a folder's stale rows first so
   *  deletions/renames are reflected on re-fetch. */
  const mergeNotes = (incoming: IndexedNote[], replacePrefix?: string) => {
    setBaseNotes((prev) => {
      const map = new Map(prev.map((n) => [n.path, n]));
      if (replacePrefix) for (const p of [...map.keys()]) if (p.startsWith(replacePrefix)) map.delete(p);
      for (const n of incoming) map.set(n.path, n);
      return [...map.values()];
    });
  };

  /** Load a top-level pillar's notes on demand (idempotent). */
  const ensureFolder = async (folder: string) => {
    if (!token) return;
    if (allLoadedRef.current || loadedRef.current.has(folder) || loadingRef.current.has(folder)) return;
    loadingRef.current.add(folder);
    setLoadingFolders(new Set(loadingRef.current));
    try {
      const { notes } = await api.listNotes(token, { prefix: `${folder}/` });
      mergeNotes(notes, `${folder}/`);
      markLoaded([folder]);
    } catch {
      /* non-fatal — pillar stays collapsible, user can retry */
    } finally {
      loadingRef.current.delete(folder);
      setLoadingFolders(new Set(loadingRef.current));
    }
  };

  /** Load the entire brain (for the Map view and global type/visibility filters).
   *  Commitments are hidden everywhere in the UI (they're meeting-derived task
   *  debt, not knowledge nodes), so we exclude them here too — otherwise ~1.3k
   *  commitments crowd out the real graph under the row cap. */
  const ensureAllLoaded = async () => {
    if (!token || allLoadedRef.current) return;
    const { notes } = await api.listNotes(token, { exclude: ["commitment"] });
    allLoadedRef.current = true;
    setBaseNotes(notes);
    markLoaded([...new Set(notes.map((n) => n.path.split("/")[0]!)), ...folderCounts.map((f) => f.folder)]);
  };

  /** Fresh server read of a folder's notes — used by folder delete/rename so
   *  they're correct regardless of what's currently loaded. */
  const notesUnder = async (folder: string): Promise<IndexedNote[]> => {
    if (!token) return [];
    const { notes } = await api.listNotes(token, { prefix: `${folder}/` });
    return notes;
  };

  async function openNote(path: string) {
    if (!token) return;
    if (selected && selected !== path) {
      await noteViewRef.current?.flush();
    }
    const seq = ++openNoteSeqRef.current;
    setView("notes");
    setSelected(path);
    setNoteLoading(true);
    setFullNote((prev) => (prev?.path === path ? prev : null));
    const indexed = (searchResults ?? baseNotes).find((n) => n.path === path);
    setNotePreviewTitle(
      indexed?.title ?? path.split("/").pop()?.replace(/\.md$/, "") ?? path,
    );
    setOpenTabs((prev) => upsertTab(prev, path, indexed?.title ?? path.split("/").pop()?.replace(/\.md$/, "") ?? path));
    // Remember it so a refresh reopens this note (see the space-load effect).
    if (activeSpaceId) {
      try {
        localStorage.setItem(openNoteKey(activeSpaceId), path);
      } catch {
        /* storage unavailable — fine */
      }
    }
    try {
      const note = await api.readNote(token, path);
      if (seq !== openNoteSeqRef.current) return;
      setFullNote(note);
    } catch {
      if (seq !== openNoteSeqRef.current) return;
      setFullNote(null);
      // A note that no longer reads (deleted elsewhere) shouldn't keep
      // reopening on every refresh.
      if (activeSpaceId) {
        try {
          localStorage.removeItem(openNoteKey(activeSpaceId));
        } catch {
          /* storage unavailable — fine */
        }
      }
    } finally {
      if (seq !== openNoteSeqRef.current) return;
      setNoteLoading(false);
      setNotePreviewTitle(null);
    }
  }

  function closeEditorTab(path: string) {
    const remaining = closeTab(openTabs, path);
    setOpenTabs(remaining);
    if (selected === path) {
      const next = remaining[remaining.length - 1]?.path;
      if (next) void openNote(next);
      else {
        setSelected(null);
        setFullNote(null);
        if (activeSpaceId) {
          try {
            localStorage.removeItem(openNoteKey(activeSpaceId));
          } catch {
            /* storage unavailable */
          }
        }
      }
    }
  }

  function handleTabReorder(activePath: string, overPath: string) {
    setOpenTabs((prev) => reorderTabs(prev, activePath, overPath));
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  function switchSpace(space: Space) {
    if (space.id === activeSpaceId) return;
    setQuery("");
    setTypeFilter(null);
    setVisFilter(null);
    setActiveSpaceId(space.id);
  }

  async function handleCreateSpace(values: CreateSpaceValues) {
    if (!token) return;
    setCreateSpaceBusy(true);
    setCreateSpaceError(null);
    try {
      const { space } = await api.createSpace(token, {
        name: values.name,
        themeColor: values.themeColor,
      });
      let created = space;
      if (values.logoDataUrl) {
        try {
          const res = await api.uploadSpaceLogo(token, space.id, values.logoDataUrl);
          created = res.space ?? { ...space, logoUrl: res.logoUrl ?? space.logoUrl };
        } catch {
          // Space is created; a failed logo upload shouldn't block entry — they can retry in Settings.
        }
      }
      setSpaces((prev) => [...prev, created]);
      setCreateSpaceOpen(false);
      setActiveSpaceId(created.id); // drop the user straight into their new wiki
    } catch (e) {
      setCreateSpaceError(e instanceof Error ? e.message : "Could not create space");
    } finally {
      setCreateSpaceBusy(false);
    }
  }

  // ── Editing: create / update / delete / rename ─────────────────────────────
  const [createFolder, setCreateFolder] = useState<{ folder: string | null } | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [renameFolder, setRenameFolder] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "note" | "folder"; path: string; count?: number } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const noteDirtyRef = useRef(false);
  const collabEnabledRef = useRef(false);
  const selectedRef = useRef<string | null>(null);
  const noteViewRef = useRef<NoteViewHandle>(null);
  const openNoteSeqRef = useRef(0);
  selectedRef.current = selected;
  collabEnabledRef.current = collabEnabled;

  async function refresh(open?: string | null) {
    if (!token) return;
    try {
      const [{ folders }, { categories: cats }] = await Promise.all([
        api.folders(token),
        api.structure(token),
      ]);
      setFolderCounts(folders);
      setCategories(cats);
      // Re-pull whatever's currently loaded so the tree reflects the change.
      if (allLoadedRef.current) {
        const { notes } = await api.listNotes(token);
        setBaseNotes(notes);
      } else {
        const loaded = [...loadedRef.current];
        const results = await Promise.all(loaded.map((f) => api.listNotes(token, { prefix: `${f}/` })));
        const map = new Map<string, IndexedNote>();
        for (const r of results) for (const n of r.notes) map.set(n.path, n);
        setBaseNotes([...map.values()]);
      }
    } catch {
      /* non-fatal */
    }
    if (open !== undefined) {
      if (open) await openNote(open);
      else {
        setSelected(null);
        setFullNote(null);
        if (activeSpaceId) {
          try {
            localStorage.removeItem(openNoteKey(activeSpaceId));
          } catch {
            /* storage unavailable — fine */
          }
        }
      }
    }
  }

  // Live refresh when an agent (MCP) or another client writes to this space.
  useEffect(() => {
    if (!token || !ready || !activeSpaceId) return;
    const ac = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      try {
        await connectBrainEvents(
          token,
          async (event) => {
            if (event.spaceId !== activeSpaceId) return;

            if (event.type === "note_deleted" && selectedRef.current === event.path) {
              setBanner("This note was deleted elsewhere.");
              await refresh(null);
              return;
            }

            let reopen: string | undefined;
            if (event.type === "note_moved" && event.to && selectedRef.current === event.path) {
              reopen = event.to;
              setSelected(event.to);
              setOpenTabs((prev) => {
                const old = prev.find((t) => t.path === event.path);
                if (!old) return prev;
                return upsertTab(closeTab(prev, event.path), event.to!, old.title);
              });
            }

            await refresh(reopen);

            setActivityRefreshKey((k) => k + 1);

            const livePath = event.type === "note_moved" && event.to ? event.to : event.path;
            const cur = selectedRef.current;
            if (livePath && (cur === event.path || cur === livePath)) {
              // With Yjs collab, autosave from the other editor is expected — not a conflict.
              if (collabEnabledRef.current) return;

              if (noteDirtyRef.current) {
                setBanner("This note was updated elsewhere — save or reload to sync.");
                return;
              }
              try {
                setFullNote(await api.readNote(token, livePath));
              } catch {
                /* note gone or inaccessible */
              }
            }
          },
          ac.signal,
        );
      } catch {
        if (!ac.signal.aborted) retryTimer = setTimeout(connect, 4000);
      }
    };

    void connect();
    return () => {
      ac.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [token, ready, activeSpaceId]);

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
  }): Promise<FullNote> {
    if (!token || !selected) throw new Error("Not ready");
    const updated = await api.updateNote(token, selected, patch);
    const note: FullNote = {
      path: updated.path,
      meta: updated.meta,
      body: updated.body,
      raw: fullNote?.raw ?? "",
    };
    setFullNote(note);
    setOpenTabs((prev) => upsertTab(prev, selected, note.meta.title));
    void refresh();
    return note;
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
        const affected = await notesUnder(confirm.path);
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
        const affected = await notesUnder(folder);
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
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-surface px-4 py-2.5">
        <div className="flex items-center gap-2">
          <SpaceSwitcher
            spaces={spaces}
            activeSpaceId={activeSpaceId}
            onSwitch={switchSpace}
            onCreate={() => {
              setCreateSpaceError(null);
              setCreateSpaceOpen(true);
            }}
          />
          <span className="text-xs text-muted">
            {totalEntries === 0
              ? "Empty"
              : `${totalEntries} ${totalEntries === 1 ? "entry" : "entries"}`}
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
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden items-center gap-2 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm text-muted hover:text-ink sm:flex"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Search</span>
            <kbd className="rounded border border-border px-1 py-0.5 text-[10px]">⌘K</kbd>
          </button>
          {view === "notes" && (
            <button
              type="button"
              onClick={() => {
                setActivityOpen((v) => !v);
                if (!activityOpen) setDocPanelOpen(false);
              }}
              aria-pressed={activityOpen}
              className={`rounded-lg border border-border p-1.5 transition-colors ${
                activityOpen ? "bg-brand-weak text-brand-ink" : "text-muted hover:text-ink"
              }`}
              title="Space activity feed"
            >
              <Clock className="h-4 w-4" />
            </button>
          )}
          {view === "notes" && selected && (
            <button
              type="button"
              onClick={() => {
                setDocPanelOpen((v) => !v);
                if (!docPanelOpen) setActivityOpen(false);
              }}
              aria-pressed={docPanelOpen}
              className={`rounded-lg border border-border p-1.5 transition-colors ${
                docPanelOpen ? "bg-brand-weak text-brand-ink" : "text-muted hover:text-ink"
              }`}
              title="Toggle outline panel"
            >
              <PanelRight className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => {
              setSettingsTab("connectors");
              setSettingsOpen(true);
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-ink hover:border-brand hover:text-brand-ink"
          >
            Connect
          </button>
          <ThemeToggle />
          <ProfileMenu
            appearanceLabel={activeSpace?.kind === "company" ? "Company" : "Appearance"}
            onOpenSettings={(tab) => {
              setSettingsTab(tab);
              setSettingsOpen(true);
            }}
            onSignOut={signOut}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          notes={displayed}
          categories={categories}
          folderCounts={folderCountMap}
          loadedFolders={loadedFolders}
          loadingFolders={loadingFolders}
          onExpandFolder={ensureFolder}
          loading={!ready}
          searching={searching}
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
          onDeleteFolder={async (folder) => {
            const affected = await notesUnder(folder);
            setConfirm({ kind: "folder", path: folder, count: affected.length });
          }}
        />
        <main
          className={`min-h-0 min-w-0 flex flex-1 flex-col overflow-hidden bg-bg ${
            view === "map" ? "relative" : ""
          }`}
        >
          {view === "map" ? (
            <BrainMap
              notes={baseNotes}
              onOpenNote={openNote}
              loadSemantic={token ? () => api.semanticLinks(token) : undefined}
            />
          ) : totalEntries === 0 && !selected && !noteLoading ? (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
              <SpaceWelcome
                space={activeSpace}
                categories={categories}
                onCreateInside={(folder) => {
                  setCreateError(null);
                  setCreateFolder({ folder });
                }}
              />
            </div>
          ) : (
            <>
              <EditorTabs
                tabs={openTabs}
                activePath={selected}
                onSelect={openNote}
                onClose={closeEditorTab}
                onReorder={handleTabReorder}
              />
              <div className="flex min-h-0 flex-1 overflow-hidden">
                <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain">
                  <NoteView
                    ref={noteViewRef}
                    note={fullNote}
                    loading={noteLoading}
                    activePath={selected}
                    previewTitle={notePreviewTitle}
                    onOpenLink={openNote}
                    onSave={handleSaveNote}
                    onBodyChange={setEditorBody}
                    onDirtyChange={(d) => {
                      noteDirtyRef.current = d;
                    }}
                    scrollToHeading={scrollToHeading}
                    collab={
                      token && activeSpaceId
                        ? { enabled: collabEnabled, token, spaceId: activeSpaceId }
                        : null
                    }
                    collabUser={collabUser}
                    agentPresence={agentPresence}
                    onSelectPresencePeer={(peer) => {
                      if (peer.kind !== "agent" || !peer.id) return;
                      setActivityAuthorFilter(peer.id);
                      setActivityOpen(true);
                      setDocPanelOpen(false);
                    }}
                    onDelete={async () => {
                      if (selected) setConfirm({ kind: "note", path: selected });
                    }}
                  />
                </div>
                {docPanelOpen && selected && (
                  noteLoading || !fullNote || fullNote.path !== selected ? (
                    <DocPanelSkeleton />
                  ) : (
                    <DocPanel
                      note={fullNote}
                      tab={docPanelTab}
                      onTabChange={setDocPanelTab}
                      onOpenLink={openNote}
                      onClose={() => setDocPanelOpen(false)}
                      liveBody={editorBody}
                      onOutlineClick={(item: OutlineItem, occurrence: number) =>
                        setScrollToHeading({
                          text: item.text,
                          level: item.level,
                          occurrence,
                          nonce: Date.now(),
                        })
                      }
                      token={token}
                      onRestoreVersion={
                        selected && token
                          ? async (version) => {
                              await api.restoreVersion(token, selected, version);
                              noteDirtyRef.current = false;
                              setEditorBody(undefined);
                              await openNote(selected);
                            }
                          : undefined
                      }
                    />
                  )
                )}
                <ActivityPanel
                  token={token}
                  open={activityOpen}
                  onClose={() => setActivityOpen(false)}
                  onOpenNote={openNote}
                  refreshKey={activityRefreshKey}
                  authorFilter={activityAuthorFilter}
                  notePath={selected}
                  onClearAuthorFilter={() => setActivityAuthorFilter(null)}
                />
              </div>
            </>
          )}
        </main>
        <Chat token={token} open={chatOpen} onClose={() => setChatOpen(false)} onOpenNote={openNote} />
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        notes={baseNotes}
        spaces={spaces}
        activeSpaceId={activeSpaceId}
        recentTabs={openTabs}
        onOpenNote={openNote}
        onNewNote={() => {
          setCreateError(null);
          setCreateFolder({ folder: "" });
        }}
        onToggleMap={() => setView((v) => (v === "map" ? "notes" : "map"))}
        onSwitchSpace={switchSpace}
      />

      <Settings
        token={token}
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          void refresh();
        }}
        initialTab={settingsTab}
        activeSpace={activeSpace}
        onSpaceUpdated={(s) => setSpaces((prev) => prev.map((x) => (x.id === s.id ? { ...x, ...s } : x)))}
        onChanged={() => void refresh()}
      />

      {createSpaceOpen && (
        <CreateSpaceDialog
          busy={createSpaceBusy}
          error={createSpaceError}
          onSubmit={handleCreateSpace}
          onClose={() => setCreateSpaceOpen(false)}
        />
      )}

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

/** Teaching empty state for a brand-new (or emptied) space. A company wiki
 *  explains its seeded structure and invites the first note; a personal space
 *  nudges toward capturing. Category chips create a note inside that section. */
function SpaceWelcome({
  space,
  categories,
  onCreateInside,
}: {
  space: Space | null;
  categories: Category[];
  onCreateInside: (folder: string) => void;
}) {
  const isCompany = space?.kind === "company";
  const name = space?.name?.trim() || (isCompany ? "your company" : "you");
  const chips = categories.slice(0, 10);
  return (
    <div className="grid h-full place-items-center px-6 py-16">
      <div className="max-w-xl text-center">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-border bg-surface text-2xl shadow-sm">
          {isCompany ? "🏢" : "🌱"}
        </div>
        <h2 className="font-heading text-2xl font-bold tracking-tight text-ink">
          {isCompany ? `Welcome to ${name}'s wiki` : "Your second self is empty"}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-pretty text-sm leading-relaxed text-muted">
          {isCompany
            ? "This shared brain is seeded with the sections an AI-native company needs from day zero. Pick one to write your first note — or connect your team's tools to fill it automatically."
            : "Nothing here yet. Pick a section to write your first note — or connect your tools so it fills in as you go."}
        </p>

        {chips.length > 0 && (
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {chips.map((c) => (
              <button
                key={c.folder}
                onClick={() => onCreateInside(c.folder)}
                className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink shadow-sm transition-colors hover:border-brand hover:text-brand-ink"
              >
                + {c.label}
              </button>
            ))}
          </div>
        )}

        <div className="mt-7">
          <button
            onClick={() => onCreateInside(chips[0]?.folder ?? "notes")}
            className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-transform duration-200 hover:-translate-y-0.5 hover:opacity-95"
          >
            {isCompany ? "Write the first note" : "Create your first note"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DocPanelSkeleton() {
  return (
    <aside
      className="flex min-h-0 w-64 shrink-0 flex-col border-l border-border bg-surface"
      aria-busy="true"
      aria-hidden
    >
      <div className="border-b border-border px-2 py-2">
        <span className="skeleton block h-7 w-full rounded-lg" />
      </div>
      <div className="flex-1 space-y-3 p-3">
        {["72%", "58%", "64%", "50%", "68%"].map((w, i) => (
          <span key={i} className="skeleton block h-3 rounded" style={{ width: w }} />
        ))}
      </div>
    </aside>
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
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden" aria-busy="true" aria-label="Loading your second self">
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

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex h-full min-h-0 w-72 shrink-0 flex-col border-r border-border bg-surface">
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

        <main className="min-h-0 min-w-0 flex-1 overflow-hidden bg-bg">
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
