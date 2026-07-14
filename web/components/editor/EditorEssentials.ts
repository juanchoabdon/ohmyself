import { Extension } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";

/** Duplicate the nearest block (Notion / VS Code style Mod-d). */
function duplicateBlock(editor: Editor): boolean {
  const { selection } = editor.state;

  if (selection instanceof NodeSelection) {
    const node = selection.node;
    return editor.chain().focus().insertContentAt(selection.to, node.toJSON()).run();
  }

  const $from = selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    const name = node.type.name;
    if (name === "doc" || name === "tab" || name === "accordionItem") continue;
    if (!node.isBlock) continue;
    const pos = $from.after(d);
    return editor.chain().focus().insertContentAt(pos, node.toJSON()).run();
  }

  return false;
}

/**
 * Reliable undo/redo/duplicate — runs above other extensions so Mod-z isn't swallowed.
 * Copy/cut (Mod-c / Mod-x) stay native browser behavior; we don't bind them here.
 */
export const EditorEssentials = Extension.create({
  name: "editorEssentials",
  priority: 10_000,

  addKeyboardShortcuts() {
    return {
      "Mod-d": ({ editor }) => duplicateBlock(editor),
      "Mod-z": ({ editor }) => editor.commands.undo(),
      "Mod-y": ({ editor }) => editor.commands.redo(),
      "Shift-Mod-z": ({ editor }) => editor.commands.redo(),
    };
  },
});
