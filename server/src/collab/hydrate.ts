/**
 * Seed a Yjs XmlFragment from vault markdown (TipTap Collaboration field).
 * Used on room open (onLoadDocument) and agent MCP pushes.
 */
import { updateYFragment } from "@tiptap/y-tiptap";
import type { Doc } from "yjs";
import { collabFieldName, jsonToProsemirrorNode, markdownToProsemirrorJson } from "./schema.js";

const HYDRATE_ORIGIN = "ohmyself-vault";

export function yFragmentIsEmpty(ydoc: Doc): boolean {
  const fragment = ydoc.getXmlFragment(collabFieldName());
  // XmlFragment with no children — same signal Hocuspocus Document.isEmpty uses.
  return fragment.length === 0;
}

/** Replace the collaboration fragment with markdown parsed through the collab schema. */
export function applyMarkdownToYDoc(ydoc: Doc, body: string, origin = HYDRATE_ORIGIN): void {
  const fragment = ydoc.getXmlFragment(collabFieldName());
  const json = markdownToProsemirrorJson(body);
  const node = jsonToProsemirrorNode(json);
  ydoc.transact(() => {
    updateYFragment(ydoc, fragment, node, {
      mapping: new Map(),
      isOMark: new Map(),
    });
  }, origin);
}

/** Seed only when the Y doc has no content yet (never clobber live edits). */
export function seedYDocFromMarkdownIfEmpty(
  ydoc: Doc,
  body: string,
  origin = HYDRATE_ORIGIN,
): boolean {
  if (!yFragmentIsEmpty(ydoc)) return false;
  applyMarkdownToYDoc(ydoc, body, origin);
  return true;
}
