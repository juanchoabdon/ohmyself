"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import "tippy.js/dist/tippy.css";
import { buildEditorExtensions } from "./extensions";
import { scrollEditorToHeading } from "./scrollToHeading";
import { collabRoomName, collabWsUrl } from "@/lib/collab";

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
 * When `collab` is set, Yjs syncs live edits via Hocuspocus; REST autosave remains
 * the vault source of truth (onChange → PATCH).
 */
export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  onOpenLink,
  noteKey,
  scrollToHeading,
  collab,
}: {
  value: string;
  onChange: (markdown: string) => void;
  onBlur?: () => void;
  onOpenLink?: (path: string) => void;
  /** Remount when the open note changes (path). */
  noteKey: string;
  scrollToHeading?: ScrollToHeadingTarget | null;
  collab?: CollabConfig | null;
}) {
  const onOpenLinkRef = useRef(onOpenLink);
  onOpenLinkRef.current = onOpenLink;
  const onBlurRef = useRef(onBlur);
  onBlurRef.current = onBlur;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const collabActive = Boolean(collab?.token && collab.spaceId);

  const ydoc = useMemo(() => (collabActive ? new Y.Doc() : null), [noteKey, collabActive]);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const seededRef = useRef(false);
  const [peers, setPeers] = useState(0);
  const [collabStatus, setCollabStatus] = useState<"off" | "connecting" | "live" | "error">(
    collabActive ? "connecting" : "off",
  );

  const extensions = useMemo(
    () => buildEditorExtensions((path) => onOpenLinkRef.current?.(path), ydoc ?? undefined),
    [noteKey, collabActive, ydoc],
  );

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions,
      // Always show note body immediately — don't block on WebSocket sync.
      content: collabActive ? collab?.initialBody ?? value : value,
      contentType: "markdown",
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
        if (ed.isDestroyed) return;
        onChangeRef.current(ed.getMarkdown());
      },
    },
    [noteKey, collabActive],
  );

  useEffect(() => {
    seededRef.current = false;
    if (!collabActive || !ydoc || !collab || !editor) {
      providerRef.current?.destroy();
      providerRef.current = null;
      setPeers(0);
      setCollabStatus(collabActive ? "connecting" : "off");
      return;
    }

    setCollabStatus("connecting");
    const provider = new HocuspocusProvider({
      url: collabWsUrl(),
      name: collabRoomName(collab.spaceId, collab.path),
      document: ydoc,
      token: collab.token,
    });
    providerRef.current = provider;

    const bumpPeers = () => {
      const awareness = provider.awareness;
      if (!awareness) return;
      const n = awareness.getStates().size;
      setPeers(Math.max(0, n - 1));
    };
    provider.awareness?.on("change", bumpPeers);
    bumpPeers();

    const onSynced = () => {
      setCollabStatus("live");
      if (seededRef.current || editor.isDestroyed) return;
      if (editor.isEmpty && collab.initialBody.trim()) {
        editor.commands.setContent(collab.initialBody, { contentType: "markdown" });
        seededRef.current = true;
      }
    };
    provider.on("synced", onSynced);

    provider.on("status", ({ status }: { status: string }) => {
      if (status === "disconnected") setCollabStatus("error");
      else if (status === "connected") setCollabStatus("live");
    });

    const connectTimer = window.setTimeout(() => {
      setCollabStatus((s) => (s === "connecting" ? "error" : s));
    }, 8000);

    return () => {
      window.clearTimeout(connectTimer);
      provider.awareness?.off("change", bumpPeers);
      provider.destroy();
      providerRef.current = null;
      setPeers(0);
    };
  }, [collabActive, ydoc, collab, editor, noteKey]);

  // Parent reset (Cancel) without remounting the note — skip when Yjs owns the doc.
  useEffect(() => {
    if (!editor || editor.isDestroyed || collabActive) return;
    const current = editor.getMarkdown();
    if (value !== current) {
      editor.commands.setContent(value, { contentType: "markdown" });
    }
  }, [editor, value, collabActive]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !scrollToHeading) return;
    scrollEditorToHeading(
      editor,
      scrollToHeading.text,
      scrollToHeading.level,
      scrollToHeading.occurrence,
    );
  }, [editor, scrollToHeading]);

  if (!editor || editor.isDestroyed) return null;

  return (
    <div className="relative">
      {collabActive && (
        <div
          className="pointer-events-none absolute -top-6 right-0 text-xs text-muted"
          title={
            collabStatus === "live"
              ? "Live co-editing"
              : collabStatus === "connecting"
                ? "Connecting…"
                : "Collaboration offline — edits still autosave"
          }
        >
          {collabStatus === "live" && (
            <span className="text-vis-public">
              ● Live{peers > 0 ? ` · ${peers + 1} here` : ""}
            </span>
          )}
          {collabStatus === "connecting" && <span>Connecting…</span>}
          {collabStatus === "error" && <span className="text-muted">Offline</span>}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
