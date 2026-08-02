/**
 * Print a note's raw stored markdown, with the media fences made visible.
 *
 *   npx tsx src/scripts/dump-note.ts <spaceId> <path>
 */
import "../env.js";
import { buildCore, serializeNote } from "../core/index.js";

async function main() {
  const [spaceId, path] = process.argv.slice(2);
  if (!spaceId || !path) throw new Error("usage: dump-note.ts <spaceId> <path>");

  const { brain } = buildCore();
  const note = await brain.readNote(spaceId, path, ["public", "private", "secret"]);
  const raw = serializeNote(note.meta, note.body);

  for (const line of raw.split("\n")) {
    if (/^:::|^src:|^alt:|^caption:|^title:/.test(line)) console.log(`>> ${JSON.stringify(line)}`);
  }
}

void main();
