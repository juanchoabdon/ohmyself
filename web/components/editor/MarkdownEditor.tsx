"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import * as Y from "yjs";
import "tippy.js/dist/tippy.css";
import StarterKit from "@tiptap/starter-kit";
import { buildEditorExtensions } from "./extensions";
import { handleInternalLinkClick } from "./internalLinkNavigation";
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
import type { CommentThread } from "@/lib/types";
import { CommentHighlight, syncCommentHighlights } from "./commentHighlight";
import {
  PresenceBar,
  type CollabSyncStatus,
  type PresencePeer,
} from "./PresenceBar";
import { repairRichMarkdown } from "./markdownRichContent";
import { normalizeNoteLinksForStorage, prepareNoteLinks } from "./wikiLinkMarkdown";

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
  mode: modeProp,
  onModeChange: onModeChangeProp,
  hideModeToggle,
  commentThreads,
  activeThreadId = null,
  onSelectThread,
  onStartComment,
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
  /** When set with `onModeChange`, mode is controlled by the parent (e.g. header toolbar). */
  mode?: EditorMode;
  onModeChange?: (mode: EditorMode) => void;
  /** Hide the built-in toggle row — parent renders `EditorModeToggle` elsewhere. */
  hideModeToggle?: boolean;
  /** Threads to paint as highlights (anchors are re-found in the live doc). */
  commentThreads?: CommentThread[];
  activeThreadId?: string | null;
  onSelectThread?: (threadId: string) => void;
  /** Start a thread from the current selection. */
  onStartComment?: (quote: string, offset: number) => void;
}) {
  const onOpenLinkRef = useRef(onOpenLink);
  onOpenLinkRef.current = onOpenLink;
  const onBlurRef = useRef(onBlur);
  onBlurRef.current = onBlur;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  /** Last markdown pushed to the parent — lets the value-sync effect ignore our own echoes. */
  const lastEmittedRef = useRef<string | null>(null);
  const emitMarkdown = useCallback((md: string) => {
    const normalized = normalizeNoteLinksForStorage(md);
    lastEmittedRef.current = normalized;
    onChangeRef.current(normalized);
  }, []);
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

  const modeControlled = modeProp !== undefined && onModeChangeProp !== undefined;
  const [internalMode, setInternalMode] = useState<EditorMode>("visual");
  const mode = modeControlled ? modeProp! : internalMode;
  const [sourceMd, setSourceMd] = useState(value);
  const modeRef = useRef<EditorMode>("visual");
  const controlledModeRef = useRef<EditorMode>(mode);
  const sourceMdRef = useRef(value);
  const editorRef = useRef<Editor | null>(null);
  const collabSyncTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const pref = loadEditorModePreference();
    if (!modeControlled) setInternalMode(pref);
    modeRef.current = pref;
    controlledModeRef.current = modeControlled ? modeProp ?? pref : pref;
  }, [noteKey, modeControlled, modeProp]);

  useEffect(() => {
    setSourceMd(value);
    sourceMdRef.current = value;
    lastEmittedRef.current = null;
  }, [noteKey]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  /** Parent toolbar toggles mode (header); mirror into TipTap without re-saving preference. */
  useEffect(() => {
    if (!modeControlled || controlledModeRef.current === mode) return;
    controlledModeRef.current = mode;
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return;
    if (mode === "source") {
      const md = ed.getMarkdown();
      setSourceMd(md);
      sourceMdRef.current = md;
    } else if (!collabActive) {
      const md = sourceMdRef.current;
      ed.commands.setContent(prepareNoteLinks(md), { contentType: "markdown" });
      emitMarkdown(ed.getMarkdown());
    }
  }, [mode, modeControlled, collabActive]);

  const ydoc = useMemo(() => (collabActive ? new Y.Doc() : null), [noteKey, collabActive]);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  /** True only after Hocuspocus has applied the room's Y state — never mount the
   *  editor before this in collab mode (an empty TipTap doc would broadcast into
   *  the shared room and clobber other users). */
  const [collabDocSynced, setCollabDocSynced] = useState(false);
  const [syncStatus, setSyncStatus] = useState<CollabSyncStatus>("connecting");
  const seededRef = useRef(false);

  // Kept in a ref so changing the handler never rebuilds the extension list
  // (which would remount the editor and drop the collab session).
  const onSelectThreadRef = useRef(onSelectThread);
  onSelectThreadRef.current = onSelectThread;

  const extensions = useMemo(() => {
    if (collabActive && !collabDocSynced) {
      // Stub until Yjs sync completes — never attach Collaboration to an empty doc.
      return [StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false, codeBlock: false })];
    }
    return [
      ...buildEditorExtensions(
        (path) => onOpenLinkRef.current?.(path),
        ydoc ?? undefined,
        provider,
        collabUser ?? null,
        noteKey,
      ),
      CommentHighlight.configure({
        onSelectThread: (threadId: string) => onSelectThreadRef.current?.(threadId),
      }),
    ];
  }, [noteKey, collabActive, collabDocSynced, ydoc, provider, collabUser]);

  const repairAttemptedRef = useRef(false);

  useEffect(() => {
    repairAttemptedRef.current = false;
  }, [noteKey]);

  const repairFromVault = useCallback(
    (ed: Editor) => {
      // Yjs owns the doc in collab mode; server hydrates from vault on room open.
      // Client setContent here races the sync and appends duplicate blocks.
      if (collabActive) {
        repairAttemptedRef.current = true;
        return;
      }
      const vaultMd = prepareNoteLinks(collabInitialBodyRef.current ?? value);
      if (repairRichMarkdown(ed, vaultMd)) {
        repairAttemptedRef.current = true;
        const fixed = normalizeNoteLinksForStorage(ed.getMarkdown());
        setSourceMd(fixed);
        sourceMdRef.current = fixed;
      }
    },
    [value, collabActive],
  );

  const scheduleRepair = useCallback(
    (ed: Editor) => {
      const tryRepair = () => {
        if (ed.isDestroyed) return;
        repairFromVault(ed);
      };
      tryRepair();
      if (repairAttemptedRef.current) return;
      requestAnimationFrame(tryRepair);
      window.setTimeout(tryRepair, 80);
    },
    [repairFromVault],
  );

  const seedIfEmpty = useCallback((ed: Editor) => {
    if (ed.isDestroyed || seededRef.current || collabActive) return;
    const seed = prepareNoteLinks(collabInitialBodyRef.current ?? value);
    if (ed.isEmpty && seed.trim()) {
      ed.commands.setContent(seed, { contentType: "markdown" });
      seededRef.current = true;
    }
  }, [value, collabActive]);

  const signalReady = useCallback(
    (ed: Editor) => {
      if (readyFiredRef.current || ed.isDestroyed) return;
      if (collabActive && !collabSyncedRef.current) return;
      seedIfEmpty(ed);
      const seed = collabInitialBodyRef.current ?? value;
      if (ed.isEmpty && seed.trim()) return;
      // Yjs can briefly deliver a stale partial doc before server reconcile lands.
      if (collabActive && seed.trim()) {
        const liveLen = ed.getMarkdown().trim().length;
        const seedLen = seed.trim().length;
        if (seedLen > 1000 && liveLen < seedLen * 0.4) return;
      }
      readyFiredRef.current = true;
      onReadyRef.current?.();
    },
    [value, collabActive, seedIfEmpty],
  );

  const canMountEditor = !collabActive || collabDocSynced;

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions,
      // Collab: Yjs owns the doc — never seed markdown here (races sync and can
      // broadcast an empty/partial doc into the shared room).
      ...(collabActive
        ? {}
        : { content: prepareNoteLinks(value), contentType: "markdown" as const }),
      onCreate: ({ editor: ed }) => {
        if (collabActive) {
          signalReady(ed);
          return;
        }
        scheduleRepair(ed);
        const kickReady = () => signalReady(ed);
        requestAnimationFrame(kickReady);
        window.setTimeout(kickReady, 120);
      },
      editorProps: {
        attributes: {
          class: "prose oms-editor-body min-h-[3rem] focus:outline-none",
          spellcheck: "true",
        },
        handleDOMEvents: {
          blur: () => {
            onBlurRef.current?.();
            return false;
          },
          click: (view, event) => {
            const onOpen = onOpenLinkRef.current;
            if (!onOpen || !(event instanceof MouseEvent)) return false;
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            if (pos === undefined) return false;
            return handleInternalLinkClick(view, event, pos, onOpen);
          },
        },
      },
      onUpdate: ({ editor: ed }) => {
        if (ed.isDestroyed || modeRef.current === "source" || !readyFiredRef.current) return;
        emitMarkdown(ed.getMarkdown());
      },
    },
    [noteKey, collabActive, collabDocSynced, collabUser?.id],
  );

  editorRef.current = editor ?? null;

  const handleModeChange = useCallback(
    (next: EditorMode) => {
      const ed = editorRef.current;
      if (next === "source" && ed && !ed.isDestroyed) {
        const md = normalizeNoteLinksForStorage(ed.getMarkdown());
        setSourceMd(md);
        sourceMdRef.current = md;
      } else if (next === "visual" && ed && !ed.isDestroyed) {
        if (!collabActive) {
          const md = sourceMdRef.current;
          ed.commands.setContent(prepareNoteLinks(md), { contentType: "markdown" });
          emitMarkdown(ed.getMarkdown());
        }
      }
      modeRef.current = next;
      if (modeControlled) onModeChangeProp!(next);
      else setInternalMode(next);
      saveEditorModePreference(next);
    },
    [collabActive, modeControlled, onModeChangeProp],
  );

  const handleSourceChange = useCallback((md: string) => {
    setSourceMd(md);
    sourceMdRef.current = md;
    emitMarkdown(md);
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed || collabActive) return;
    if (collabSyncTimerRef.current) clearTimeout(collabSyncTimerRef.current);
    collabSyncTimerRef.current = setTimeout(() => {
      const current = editorRef.current;
      if (!current || current.isDestroyed) return;
      if (md !== normalizeNoteLinksForStorage(current.getMarkdown())) {
        current.commands.setContent(prepareNoteLinks(md), { contentType: "markdown" });
      }
    }, 350);
  }, [collabActive]);

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
    setCollabDocSynced(false);
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
    if (!provider) return;

    const onSynced = () => {
      collabSyncedRef.current = true;
      setCollabDocSynced(true);
      setSyncStatus("synced");
    };
    provider.on("synced", onSynced);
    if (provider.isSynced) onSynced();

    return () => {
      provider.off("synced", onSynced);
    };
  }, [provider]);

  // Parent reset (Cancel) without remounting the note — skip when Yjs owns the doc.
  // Ignore value echoes from our own onUpdate — that loop was shrinking bodies on load.
  useEffect(() => {
    if (!editor || editor.isDestroyed || collabActive) return;
    if (value === lastEmittedRef.current) return;
    const current = normalizeNoteLinksForStorage(editor.getMarkdown());
    if (value === current) {
      lastEmittedRef.current = value;
      return;
    }
    editor.commands.setContent(prepareNoteLinks(value), { contentType: "markdown" });
  }, [editor, value, collabActive]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    syncCommentHighlights(editor.view, commentThreads ?? [], activeThreadId);
  }, [editor, commentThreads, activeThreadId]);

  // Floating "Comment" affordance over a text selection.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [selectionCue, setSelectionCue] = useState<{
    top: number;
    left: number;
    quote: string;
    offset: number;
  } | null>(null);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !onStartComment || mode !== "visual") {
      setSelectionCue(null);
      return;
    }
    const update = () => {
      if (editor.isDestroyed) return;
      const { from, to, empty } = editor.state.selection;
      const wrapper = wrapperRef.current;
      if (empty || !wrapper) {
        setSelectionCue(null);
        return;
      }
      const quote = editor.state.doc.textBetween(from, to, "\n").trim();
      if (quote.length < 2) {
        setSelectionCue(null);
        return;
      }
      const coords = editor.view.coordsAtPos(from);
      const box = wrapper.getBoundingClientRect();
      setSelectionCue({
        top: coords.top - box.top - 34,
        left: Math.max(0, coords.left - box.left),
        quote,
        offset: editor.state.doc.textBetween(0, from, "\n").length,
      });
    };
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("selectionUpdate", update);
    };
  }, [editor, onStartComment, mode]);

  useEffect(() => {
    setSelectionCue(null);
  }, [noteKey, mode]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !scrollToHeading || mode !== "visual") return;
    scrollEditorToHeading(
      editor,
      scrollToHeading.text,
      scrollToHeading.level,
      scrollToHeading.occurrence,
    );
  }, [editor, scrollToHeading, mode]);

  if (collabActive && !canMountEditor) {
    if (!provider || !collabUser) return null;
    return (
      <PresenceBar
        provider={provider}
        localUser={collabUser}
        syncStatus={syncStatus}
        extraPeers={agentPresence}
        onSelectPeer={onSelectPresencePeer}
      />
    );
  }

  if (!editor || editor.isDestroyed) return null;

  return (
    <div className="relative" ref={wrapperRef}>
      {selectionCue && onStartComment && (
        <button
          type="button"
          style={{ top: selectionCue.top, left: selectionCue.left }}
          // Keep the editor selection alive through the click.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onStartComment(selectionCue.quote, selectionCue.offset);
            setSelectionCue(null);
          }}
          className="absolute z-20 flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium text-ink shadow-md hover:border-brand/40 hover:text-brand"
        >
          <MessageSquarePlus className="h-3 w-3" aria-hidden />
          Comment
        </button>
      )}
      {collabActive && provider && collabUser && (
        <PresenceBar
          provider={provider}
          localUser={collabUser}
          syncStatus={syncStatus}
          extraPeers={agentPresence}
          onSelectPeer={onSelectPresencePeer}
        />
      )}
      {!hideModeToggle ? <EditorModeToggle mode={mode} onChange={handleModeChange} /> : null}
      {mode === "source" ? (
        <p className="px-2 pb-2 pt-0.5 text-[11px] text-muted">
          Source mode — callouts, Mermaid, and embeds render in{" "}
          <button
            type="button"
            className="font-medium text-brand underline underline-offset-2"
            onClick={() => handleModeChange("visual")}
          >
            Visual
          </button>
          .
        </p>
      ) : null}
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
    <div className="space-y-3 py-1" aria-hidden>
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
