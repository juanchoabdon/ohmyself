"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

  const collabToken = collab?.token;
  const collabSpaceId = collab?.spaceId;
  const collabPath = collab?.path;
  const collabInitialBody = collab?.initialBody;
  const collabActive = Boolean(collabToken && collabSpaceId && collabPath);

  const collabInitialBodyRef = useRef(collabInitialBody);
  collabInitialBodyRef.current = collabInitialBody;

  const ydoc = useMemo(() => (collabActive ? new Y.Doc() : null), [noteKey, collabActive]);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const seededRef = useRef(false);
  const [peers, setPeers] = useState(0);

  const extensions = useMemo(
    () => buildEditorExtensions((path) => onOpenLinkRef.current?.(path), ydoc ?? undefined),
    [noteKey, collabActive, ydoc],
  );

  const signalReady = useCallback(
    (ed: Editor) => {
      if (readyFiredRef.current || ed.isDestroyed) return;
      const seed = collabInitialBodyRef.current ?? value;
      if (ed.isEmpty && seed.trim()) return;
      readyFiredRef.current = true;
      onReadyRef.current?.();
    },
    [value],
  );

  const seedIfEmpty = useCallback((ed: Editor) => {
    if (ed.isDestroyed || seededRef.current) return;
    const seed = collabInitialBodyRef.current ?? value;
    if (ed.isEmpty && seed.trim()) {
      ed.commands.setContent(seed, { contentType: "markdown" });
      seededRef.current = true;
    }
  }, [value]);

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions,
      content: collabActive ? collabInitialBody ?? value : value,
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
        if (ed.isDestroyed) return;
        onChangeRef.current(ed.getMarkdown());
        if (collabActive && !readyFiredRef.current && !ed.isEmpty) signalReady(ed);
      },
    },
    [noteKey, collabActive],
  );

  useEffect(() => {
    readyFiredRef.current = false;
    seededRef.current = false;
  }, [noteKey]);

  // Reconnect provider only when the note changes — never on parent re-renders.
  useEffect(() => {
    if (!collabActive || !ydoc || !collabToken || !collabSpaceId || !collabPath || !editor) {
      providerRef.current?.destroy();
      providerRef.current = null;
      setPeers(0);
      return;
    }

    const provider = new HocuspocusProvider({
      url: collabWsUrl(),
      name: collabRoomName(collabSpaceId, collabPath),
      document: ydoc,
      token: collabToken,
    });
    providerRef.current = provider;

    const bumpPeers = () => {
      const awareness = provider.awareness;
      if (!awareness) return;
      setPeers(Math.max(0, awareness.getStates().size - 1));
    };
    provider.awareness?.on("change", bumpPeers);
    bumpPeers();

    const onSynced = () => {
      if (editor.isDestroyed) return;
      seedIfEmpty(editor);
      signalReady(editor);
    };
    provider.on("synced", onSynced);

    const fallback = window.setTimeout(() => {
      if (editor.isDestroyed || readyFiredRef.current) return;
      seedIfEmpty(editor);
      signalReady(editor);
    }, 4000);

    return () => {
      window.clearTimeout(fallback);
      provider.awareness?.off("change", bumpPeers);
      provider.destroy();
      providerRef.current = null;
      setPeers(0);
    };
  }, [collabActive, collabToken, collabSpaceId, collabPath, ydoc, editor, noteKey, seedIfEmpty, signalReady]);

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
      {peers > 0 && (
        <div
          className="pointer-events-none absolute -top-6 right-0 text-xs text-vis-public"
          title="Others editing this note"
        >
          ● {peers + 1} here
        </div>
      )}
      <EditorContent editor={editor} />
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
