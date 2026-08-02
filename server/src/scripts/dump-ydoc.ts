/**
 * Serialize a note's persisted Yjs state back to markdown.
 *
 * In collab mode the editor renders the Y.Doc, not the vault file, so when the
 * two disagree this is the only view of what the user is actually looking at.
 *
 *   npx tsx src/scripts/dump-ydoc.ts <spaceId> <path>
 */
import "../env.js";
import { Doc, applyUpdate } from "yjs";
import { loadCollabState } from "../collab/state-store.js";
import { yDocToMarkdown } from "../collab/schema.js";

async function main() {
  const [spaceId, path] = process.argv.slice(2);
  if (!spaceId || !path) throw new Error("usage: dump-ydoc.ts <spaceId> <path>");

  const state = await loadCollabState(spaceId, path);
  if (!state) {
    console.log("no persisted Y state for this note (editor would hydrate from the vault)");
    return;
  }

  const doc = new Doc();
  applyUpdate(doc, state, "dump");
  for (const line of yDocToMarkdown(doc).split("\n")) {
    if (/^:::|^src:|^alt:|^caption:/.test(line)) console.log(`>> ${JSON.stringify(line)}`);
  }
}

void main();
