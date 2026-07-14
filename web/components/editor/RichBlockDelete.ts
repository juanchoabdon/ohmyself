import { Extension } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";
import { RICH_BLOCK_TYPES } from "./markdownRichContent";

function deleteAdjacentRichBlock(editor: Editor, direction: "backward" | "forward"): boolean {
  const { selection, doc } = editor.state;
  if (selection instanceof NodeSelection && RICH_BLOCK_TYPES.has(selection.node.type.name)) {
    return editor.chain().focus().deleteSelection().run();
  }

  if (!selection.empty) return false;

  const $pos = selection.$from;
  if (direction === "backward") {
    const before = $pos.nodeBefore;
    if (before && RICH_BLOCK_TYPES.has(before.type.name)) {
      return editor
        .chain()
        .focus()
        .deleteRange({ from: $pos.pos - before.nodeSize, to: $pos.pos })
        .run();
    }
    // Cursor at start of first child inside a rich block — lift delete to parent
    if ($pos.parentOffset === 0 && $pos.depth > 0) {
      const parentType = $pos.node($pos.depth - 1).type.name;
      if (RICH_BLOCK_TYPES.has(parentType)) {
        const parentPos = $pos.before($pos.depth - 1);
        const parentNode = doc.nodeAt(parentPos);
        if (parentNode) {
          return editor
            .chain()
            .focus()
            .deleteRange({ from: parentPos, to: parentPos + parentNode.nodeSize })
            .run();
        }
      }
    }
  } else {
    const after = $pos.nodeAfter;
    if (after && RICH_BLOCK_TYPES.has(after.type.name)) {
      return editor
        .chain()
        .focus()
        .deleteRange({ from: $pos.pos, to: $pos.pos + after.nodeSize })
        .run();
    }
  }

  return false;
}

/** Backspace/Delete removes whole callout, tabs, mermaid block, embeds, etc. */
export const RichBlockDelete = Extension.create({
  name: "richBlockDelete",

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => deleteAdjacentRichBlock(editor, "backward") || false,
      Delete: ({ editor }) => deleteAdjacentRichBlock(editor, "forward") || false,
    };
  },
});
