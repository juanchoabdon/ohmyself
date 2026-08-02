/**
 * Seed a Yjs XmlFragment from vault markdown (TipTap Collaboration field).
 * Used on room open (onLoadDocument) and agent MCP pushes.
 *
 * Seeding a CRDT from markdown mints brand-new Yjs items every time, so two
 * seedings of the same text are two independent sequences that Yjs will merge
 * by keeping BOTH — the note ends up stacked, not deduplicated. A room must
 * therefore be seeded exactly once in its lifetime; `hydrateYDocOnce` is the
 * only safe entry point for that, and it decides atomically inside the Yjs
 * transaction so concurrent loaders can't both win the emptiness check.
 *
 * Deliberate overwrites (agent push, dedupe rewrite) go through
 * `replaceYDocMarkdown`, which is a diff against existing content and is
 * idempotent.
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

/**
 * Replace the collaboration fragment with markdown parsed through the collab
 * schema. Diffs against whatever the fragment already holds, so applying the
 * same body twice is a no-op.
 */
export function replaceYDocMarkdown(ydoc: Doc, body: string, origin = HYDRATE_ORIGIN): void {
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

/**
 * Seed a room from the vault, exactly once. Returns false when the document
 * already has content — meaning someone else seeded it or a client is live,
 * and writing again would stack a second copy of the note.
 *
 * The emptiness check runs inside the transaction: Yjs transactions on a doc
 * never interleave, so two concurrent hydrations can't both observe an empty
 * fragment and both insert.
 */
export function hydrateYDocOnce(ydoc: Doc, body: string, origin = HYDRATE_ORIGIN): boolean {
  const fragment = ydoc.getXmlFragment(collabFieldName());
  const json = markdownToProsemirrorJson(body);
  const node = jsonToProsemirrorNode(json);
  let seeded = false;
  ydoc.transact(() => {
    if (fragment.length !== 0) return;
    updateYFragment(ydoc, fragment, node, {
      mapping: new Map(),
      isOMark: new Map(),
    });
    seeded = true;
  }, origin);
  return seeded;
}