"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import "tippy.js/dist/tippy.css";
import { buildEditorExtensions } from "./extensions";
import { scrollEditorToHeading } from "./scrollToHeading";
import {
  EditorModeToggle,
  loadEditorModePreference,
  saveEditorModePreference,
  type EditorMode,
} from "./EditorModeToggle";
import { SourceEditor } from "./SourceEditor";
import { collabRoomName, collabWsUrl } from "@/lib/collab";
import type { CollabUser } from "@/lib/collabUser";
import {
  PresenceBar,
  type CollabSyncStatus,
  type PresencePeer,
} from "./PresenceBar";

export type ScrollToHeadingTarget = {
  text: string;
  level: number;
  /** Disambiguate duplicate headings — index in the outline list. */
  occurrence: number;
  /** Bumped on each click so repeated clicks to the same heading still scroll. */
  nonce: number;
};

export type CollabConfig = {
  token: string;
  spaceId: string;
  path: string;
  /** Seed the Y doc when the room is empty (first opener). */
  initialBody: string;
};

/**
 * Always-on WYSIWYG markdown editor. Content round-trips to stored `.md` via
 * TipTap Markdown (tables, task lists, wiki-links, blockquotes, etc.).
 *
 * When `collab` is set, Yjs syncs live edits via Hocuspocus in the background;
 * REST autosave remains the vault source of truth (onChange → PATCH).
 *
 * Call `onReady` once the editor has displayable content — parent can show a
 * static preview until then (Yjs may briefly clear the doc on connect).
 */
export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  onOpenLink,
  noteKey,
  scrollToHeading,
  collab,
  collabUser,
  agentPresence = [],
  onSelectPresencePeer,
  onReady,
}: {
  value: string;
  onChange: (markdown: string) => void;
  onBlur?: () => void;
  onOpenLink?: (path: string) => void;
  /** Remount when the open note changes (path). */
  noteKey: string;
  scrollToHeading?: ScrollToHeadingTarget | null;
  collab?: CollabConfig | null;
  collabUser?: CollabUser | null;
  /** Recent agent editors (until MCP writes join the Y doc). */
  agentPresence?: PresencePeer[];
  onSelectPresencePeer?: (peer: PresencePeer) => void;
  /** Fires when the editor has content ready to display. */
  onReady?: () => void;
}) {
  const onOpenLinkRef = useRef(onOpenLink);
  onOpenLinkRef.current = onOpenLink;
  const onBlurRef = useRef(onBlur);
  onBlurRef.current = onBlur;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const readyFiredRef = useRef(false);
  const collabSyncedRef = useRef(false);

  const collabToken = collab?.token;
  const collabSpaceId = collab?.spaceId;
  const collabPath = collab?.path;
  const collabInitialBody = collab?.initialBody;
  const collabActive = Boolean(collabToken && collabSpaceId && collabPath);

  const collabInitialBodyRef = useRef(collabInitialBody);
  collabInitialBodyRef.current = collabInitialBody;

  const [mode, setMode] = useState<EditorMode>("visual");
  const [sourceMd, setSourceMd] = useState(value);
  const modeRef = useRef<EditorMode>("visual");
  const sourceMdRef = useRef(value);
  const editorRef = useRef<Editor | null>(null);
  const collabSyncTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const pref = loadEditorModePreference();
    setMode(pref);
    modeRef.current = pref;
  }, [noteKey]);

  useEffect(() => {
    setSourceMd(value);
    sourceMdRef.current = value;
  }, [noteKey]);

  const ydoc = useMemo(() => (collabActive ? new Y.Doc() : null), [noteKey, collabActive]);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [syncStatus, setSyncStatus] = useState<CollabSyncStatus>("connecting");
  const seededRef = useRef(false);

  const extensions = useMemo(
    () =>
      buildEditorExtensions(
        (path) => onOpenLinkRef.current?.(path),
        ydoc ?? undefined,
        provider,
        collabUser ?? null,
      ),
    [noteKey, collabActive, ydoc, provider, collabUser],
  );

  const seedIfEmpty = useCallback((ed: Editor) => {
    if (ed.isDestroyed || seededRef.current) return;
    const seed = collabInitialBodyRef.current ?? value;
    if (ed.isEmpty && seed.trim()) {
      ed.commands.setContent(seed, { contentType: "markdown" });
      seededRef.current = true;
    }
  }, [value]);

  const signalReady = useCallback(
    (ed: Editor) => {
      if (readyFiredRef.current || ed.isDestroyed) return;
      if (collabActive && !collabSyncedRef.current) return;
      seedIfEmpty(ed);
      const seed = collabInitialBodyRef.current ?? value;
      if (ed.isEmpty && seed.trim()) return;
      readyFiredRef.current = true;
      onReadyRef.current?.();
    },
    [value, collabActive, seedIfEmpty],
  );

  const canMountEditor = !collabActive || provider?.awareness != null;

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions,
      // In collab mode Yjs owns the document — seeding `content` here races with
      // the initial sync and can wipe the body. Seed via `seedIfEmpty` post-sync.
      content: collabActive ? "" : value,
      contentType: "markdown",
      onCreate: ({ editor: ed }) => {
        if (collabActive) return;
        requestAnimationFrame(() => signalReady(ed));
      },
      editorProps: {
        attributes: {
          class: "prose oms-editor-body min-h-[8rem] focus:outline-none",
        },
        handleDOMEvents: {
          blur: () => {
            onBlurRef.current?.();
            return false;
          },
        },
      },
      onUpdate: ({ editor: ed }) => {
        if (ed.isDestroyed || modeRef.current === "source") return;
        onChangeRef.current(ed.getMarkdown());
      },
    },
    [noteKey, collabActive, canMountEditor, provider, collabUser?.id],
  );

  editorRef.current = editor ?? null;

  const handleModeChange = useCallback((next: EditorMode) => {
    const ed = editorRef.current;
    if (next === "source" && ed && !ed.isDestroyed) {
      const md = ed.getMarkdown();
      setSourceMd(md);
      sourceMdRef.current = md;
    } else if (next === "visual" && ed && !ed.isDestroyed) {
      const md = sourceMdRef.current;
      if (md !== ed.getMarkdown()) {
        ed.commands.setContent(md, { contentType: "markdown" });
      }
      onChangeRef.current(md);
    }
    modeRef.current = next;
    setMode(next);
    saveEditorModePreference(next);
  }, []);

  const handleSourceChange = useCallback((md: string) => {
    setSourceMd(md);
    sourceMdRef.current = md;
    onChangeRef.current(md);
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return;
    if (collabSyncTimerRef.current) clearTimeout(collabSyncTimerRef.current);
    collabSyncTimerRef.current = setTimeout(() => {
      const current = editorRef.current;
      if (!current || current.isDestroyed) return;
      if (md !== current.getMarkdown()) {
        current.commands.setContent(md, { contentType: "markdown" });
      }
    }, 350);
  }, []);

  useEffect(() => {
    return () => {
      if (collabSyncTimerRef.current) clearTimeout(collabSyncTimerRef.current);
    };
  }, [noteKey]);

  useEffect(() => {
    if (modeRef.current !== "source" || readyFiredRef.current) return;
    if (collabActive && !collabSyncedRef.current) return;
    readyFiredRef.current = true;
    onReadyRef.current?.();
  }, [mode, collabActive, editor, provider]);

  useEffect(() => {
    readyFiredRef.current = false;
    seededRef.current = false;
    collabSyncedRef.current = false;
    setProvider(null);
    setSyncStatus("connecting");
  }, [noteKey]);

  useEffect(() => {
    if (!collabActive || !ydoc || !collabToken || !collabSpaceId || !collabPath) {
      setProvider(null);
      setSyncStatus("offline");
      return;
    }

    const nextProvider = new HocuspocusProvider({
      url: collabWsUrl(),
      name: collabRoomName(collabSpaceId, collabPath),
      document: ydoc,
      token: collabToken,
    });

    if (collabUser) {
      nextProvider.awareness?.setLocalStateField("user", {
        id: collabUser.id,
        name: collabUser.name,
        color: collabUser.color,
        avatarUrl: collabUser.avatarUrl,
        kind: collabUser.kind,
      });
    }

    const onStatus = ({ status }: { status: string }) => {
      if (status === "connected") setSyncStatus("synced");
      else if (status === "disconnected") setSyncStatus("offline");
      else setSyncStatus("connecting");
    };
    nextProvider.on("status", onStatus);
    setProvider(nextProvider);

    return () => {
      nextProvider.off("status", onStatus);
      nextProvider.destroy();
      setProvider(null);
      setSyncStatus("offline");
    };
  }, [collabActive, collabToken, collabSpaceId, collabPath, ydoc, noteKey, collabUser?.id]);

  useEffect(() => {
    if (!provider || !editor || editor.isDestroyed) return;

    const onSynced = () => {
      if (editor.isDestroyed) return;
      collabSyncedRef.current = true;
      setSyncStatus("synced");
      seedIfEmpty(editor);
      signalReady(editor);
    };
    provider.on("synced", onSynced);
    // The editor is recreated when the provider lands, so `synced` may have
    // fired before this effect subscribed — check the flag directly.
    if (provider.isSynced) onSynced();

    const fallback = window.setTimeout(() => {
      if (editor.isDestroyed || readyFiredRef.current) return;
      collabSyncedRef.current = true;
      seedIfEmpty(editor);
      signalReady(editor);
    }, 1500);

    return () => {
      window.clearTimeout(fallback);
      provider.off("synced", onSynced);
    };
  }, [provider, editor, seedIfEmpty, signalReady]);

  // Parent reset (Cancel) without remounting the note — skip when Yjs owns the doc.
  useEffect(() => {
    if (!editor || editor.isDestroyed || collabActive) return;
    const current = editor.getMarkdown();
    if (value !== current) {
      editor.commands.setContent(value, { contentType: "markdown" });
    }
  }, [editor, value, collabActive]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !scrollToHeading || mode !== "visual") return;
    scrollEditorToHeading(
      editor,
      scrollToHeading.text,
      scrollToHeading.level,
      scrollToHeading.occurrence,
    );
  }, [editor, scrollToHeading, mode]);

  if (!canMountEditor || !editor || editor.isDestroyed) return null;

  return (
    <div className="relative">
      {collabActive && provider && collabUser && (
        <PresenceBar
          provider={provider}
          localUser={collabUser}
          syncStatus={syncStatus}
          extraPeers={agentPresence}
          onSelectPeer={onSelectPresencePeer}
        />
      )}
      <EditorModeToggle mode={mode} onChange={handleModeChange} />
      {mode === "source" ? (
        <SourceEditor
          value={sourceMd}
          onChange={handleSourceChange}
          onBlur={() => onBlurRef.current?.()}
        />
      ) : null}
      <div className={mode === "source" ? "sr-only h-0 overflow-hidden" : undefined}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

const SKELETON_LINES = ["92%", "78%", "85%", "64%", "88%", "72%", "55%"];

export function EditorBodySkeleton() {
  return (
    <div className="min-h-[8rem] space-y-3 py-1" aria-hidden>
      {SKELETON_LINES.map((w, i) => (
        <span
          key={i}
          className="skeleton block h-3.5 rounded"
          style={{ width: w, marginLeft: i === 3 ? "1.25rem" : undefined }}
        />
      ))}
    </div>
  );
}
