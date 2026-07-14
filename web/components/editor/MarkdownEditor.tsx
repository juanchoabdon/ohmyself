"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { useEffect, useMemo, useRef } from "react";
import "tippy.js/dist/tippy.css";
import { buildEditorExtensions } from "./extensions";
import { scrollEditorToHeading } from "./scrollToHeading";

export type ScrollToHeadingTarget = {
  text: string;
  level: number;
  /** Disambiguate duplicate headings — index in the outline list. */
  occurrence: number;
  /** Bumped on each click so repeated clicks to the same heading still scroll. */
  nonce: number;
};

/**
 * Always-on WYSIWYG markdown editor. Content round-trips to stored `.md` via
 * TipTap Markdown (tables, task lists, wiki-links, blockquotes, etc.).
 */
export function MarkdownEditor({
  value,
  onChange,
  onOpenLink,
  noteKey,
  scrollToHeading,
}: {
  value: string;
  onChange: (markdown: string) => void;
  onOpenLink?: (path: string) => void;
  /** Remount when the open note changes (path). */
  noteKey: string;
  scrollToHeading?: ScrollToHeadingTarget | null;
}) {
  const onOpenLinkRef = useRef(onOpenLink);
  onOpenLinkRef.current = onOpenLink;

  // Stable extensions — avoid tearing down the editor when parent re-renders.
  const extensions = useMemo(
    () => buildEditorExtensions((path) => onOpenLinkRef.current?.(path)),
    [],
  );

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions,
      content: value,
      contentType: "markdown",
      editorProps: {
        attributes: {
          class: "prose oms-editor-body min-h-[8rem] focus:outline-none",
        },
      },
      onUpdate: ({ editor: ed }) => {
        if (ed.isDestroyed) return;
        onChange(ed.getMarkdown());
      },
    },
    [noteKey],
  );

  // Parent reset (Cancel) without remounting the note.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = editor.getMarkdown();
    if (value !== current) {
      editor.commands.setContent(value, { contentType: "markdown" });
    }
  }, [editor, value]);

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

  return <EditorContent editor={editor} />;
}
