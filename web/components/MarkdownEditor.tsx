"use client";

import { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";

/**
 * A WYSIWYG markdown editor: you edit on top of the already-formatted text
 * (links, bold, headings render live) instead of raw markdown syntax. Content
 * round-trips to/from a markdown string so it stays compatible with how notes
 * are stored. Styled with the same `.prose` class as the read view, so editing
 * looks identical to reading.
 */
export function MarkdownEditor({
  value,
  onChange,
  autoFocus,
  focusCoords,
}: {
  value: string;
  onChange: (markdown: string) => void;
  autoFocus?: boolean;
  /** Viewport coords of the click that opened the editor, so the caret lands
   *  where the user clicked instead of jumping (and scrolling) to the end. */
  focusCoords?: { x: number; y: number } | null;
}) {
  const focusedOnce = useRef(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, Markdown],
    content: value,
    contentType: "markdown",
    editorProps: {
      attributes: {
        class: "prose oms-inline-edit min-h-[8rem] focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getMarkdown());
    },
  });

  useEffect(() => {
    if (!editor || !autoFocus || focusedOnce.current) return;
    focusedOnce.current = true;
    // Place the caret where the user clicked; never auto-scroll on focus.
    const at = focusCoords ? editor.view.posAtCoords({ left: focusCoords.x, top: focusCoords.y }) : null;
    if (at) {
      editor.chain().setTextSelection(at.pos).focus(undefined, { scrollIntoView: false }).run();
    } else {
      editor.commands.focus(undefined, { scrollIntoView: false });
    }
  }, [editor, autoFocus, focusCoords]);

  return <EditorContent editor={editor} />;
}
