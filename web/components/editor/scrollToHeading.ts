import type { Editor } from "@tiptap/core";

/** Find the document position of the Nth heading matching text + level. */
export function findHeadingPosition(
  editor: Editor,
  text: string,
  level: number,
  occurrence = 0,
): number | null {
  let seen = 0;
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found != null) return false;
    if (node.type.name !== "heading" || node.attrs.level !== level) return;
    if (node.textContent.trim() !== text) return;
    if (seen === occurrence) {
      found = pos;
      return false;
    }
    seen++;
  });
  return found;
}

export function scrollEditorToHeading(
  editor: Editor,
  text: string,
  level: number,
  occurrence = 0,
): boolean {
  const pos = findHeadingPosition(editor, text, level, occurrence);
  if (pos == null) return false;
  editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
  return true;
}
