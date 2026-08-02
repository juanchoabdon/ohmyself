/**
 * Remove the media demo note and its asset from a space.
 *
 *   npx tsx src/scripts/cleanup-media-demo.ts <spaceId>
 */
import "../env.js";
import { serviceClient, assetBucket } from "../core/supabase.js";
import { buildCore } from "../core/index.js";

const NOTE_PATH = "notes/media-demo.md";

async function main() {
  const spaceId = process.argv[2];
  if (!spaceId) throw new Error("usage: cleanup-media-demo.ts <spaceId>");
  const sb = serviceClient();

  const { data: assets } = await sb
    .from("note_assets")
    .select("id, storage_key")
    .eq("space_id", spaceId)
    .eq("path", NOTE_PATH);
  const rows = (assets ?? []) as Array<{ id: string; storage_key: string }>;

  for (const row of rows) {
    await sb.storage.from(assetBucket()).remove([row.storage_key, `${spaceId}/agent/${row.id}.webp`]);
    await sb.from("note_assets").delete().eq("id", row.id);
    console.log(`removed asset ${row.id}`);
  }

  const { brain } = buildCore();
  try {
    await brain.deleteNote(spaceId, NOTE_PATH, ["public", "private", "secret"]);
    console.log(`removed note ${NOTE_PATH}`);
  } catch (err) {
    console.log(`note not removed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const stillThere = await brain
    .readNote(spaceId, NOTE_PATH, ["public", "private", "secret"])
    .then(() => true)
    .catch(() => false);
  console.log(stillThere ? "WARNING: note still present" : "verified: note is gone");
}

void main();
