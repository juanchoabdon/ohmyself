import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";

const UNPARSED_MARKERS = /:::tabs|:::tab |:::accordion|:::image|:::video|:::embed|> \[!\w+\]/;

/** Block types that delete as one unit (keyboard + chrome). */
export const RICH_BLOCK_TYPES = new Set([
  "tabs",
  "callout",
  "accordion",
  "codeBlock",
  "omsImage",
  "omsVideo",
  "omsEmbed",
]);

function walkDoc(node: JSONContent, visit: (n: JSONContent) => boolean): boolean {
  if (visit(node)) return true;
  for (const child of node.content ?? []) {
    if (walkDoc(child, visit)) return true;
  }
  return false;
}

/** Editor doc still has fence/callout syntax as literal paragraph text. */
export function editorHasUnparsedRichSyntax(editor: Editor): boolean {
  return walkDoc(editor.getJSON(), (node) => {
    return node.type === "text" && typeof node.text === "string" && UNPARSED_MARKERS.test(node.text);
  });
}

/** Vault markdown mentions rich blocks the open doc did not parse into NodeViews. */
export function needsRichMarkdownHydration(markdown: string, editor: Editor): boolean {
  const json = JSON.stringify(editor.getJSON());

  if (/>\s*\[!\w+\]/.test(markdown) && !json.includes('"type":"callout"')) {
    return true;
  }
  if (/```mermaid\b/.test(markdown) && !json.includes('"language":"mermaid"')) {
    return true;
  }
  if (/```html preview\b/.test(markdown) && !json.includes('"language":"html preview"')) {
    return true;
  }

  if (/:::tabs\b/.test(markdown) && !json.includes('"type":"tabs"')) return true;
  if (/:::accordion\b/.test(markdown) && !json.includes('"type":"accordion"')) return true;

  const mediaFences: Array<[RegExp, string]> = [
    [/:::image\b/, '"type":"omsImage"'],
    [/:::video\b/, '"type":"omsVideo"'],
    [/:::embed\b/, '"type":"omsEmbed"'],
  ];
  for (const [pattern, needle] of mediaFences) {
    if (pattern.test(markdown) && !json.includes(needle)) return true;
  }

  return false;
}

/** Pasted plain text that should run through the markdown tokenizer. */
export function looksLikeMarkdownPaste(text: string): boolean {
  if (/^>\s*\[!\w+\]/m.test(text)) return true;
  if (/^```[\w -]+/m.test(text)) return true;
  if (/^:::\w+/m.test(text)) return true;
  if (/^\|.+\|/m.test(text)) return true;
  if (/^- \[[ x]\]/m.test(text)) return true;
  if (/\[\[[^\]]+\]\]/.test(text)) return true;
  return false;
}

function pickRepairSource(editor: Editor, vaultMarkdown: string): string | null {
  const unparsed = editorHasUnparsedRichSyntax(editor);
  const currentMd = editor.getMarkdown();

  if (unparsed && UNPARSED_MARKERS.test(currentMd)) {
    return currentMd;
  }
  if (needsRichMarkdownHydration(vaultMarkdown, editor)) {
    return vaultMarkdown;
  }
  if (unparsed && currentMd.trim()) {
    return currentMd;
  }
  return null;
}

/** True when the open doc should be re-parsed from markdown (non-collab repair path). */
export function richMarkdownNeedsRepair(editor: Editor, vaultMarkdown: string): boolean {
  if (editor.isDestroyed) return false;
  return pickRepairSource(editor, vaultMarkdown) !== null;
}

/**
 * Re-parse when the live doc has stale/unparsed rich blocks.
 * Collab callers must skip this — setContent races Yjs sync and duplicates content.
 */
export function repairRichMarkdown(editor: Editor, vaultMarkdown: string): boolean {
  if (editor.isDestroyed) return false;
  const source = pickRepairSource(editor, vaultMarkdown);
  if (!source?.trim()) return false;
  editor.commands.setContent(source, { contentType: "markdown" });
  return true;
}

/** Delete a rich block node at `pos` (NodeView delete button). */
export function deleteRichBlockAt(editor: Editor, pos: number): void {
  if (editor.isDestroyed) return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || !RICH_BLOCK_TYPES.has(node.type.name)) return;
  editor
    .chain()
    .focus()
    .deleteRange({ from: pos, to: pos + node.nodeSize })
    .run();
}
