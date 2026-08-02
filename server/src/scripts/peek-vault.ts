/**
 * Top-level folder names in a vault — enough to recognize whose brain it is
 * without reading any note content.
 *
 *   npx tsx src/scripts/peek-vault.ts <spaceId> [...]
 */
import "../env.js";
import { serviceClient, brainBucket } from "../core/supabase.js";

async function main() {
  const sb = serviceClient();
  for (const id of process.argv.slice(2)) {
    const { data } = await sb.storage.from(brainBucket()).list(id, { limit: 100 });
    const names = (data ?? []).map((e) => e.name).sort();
    console.log(`${id}\n  ${names.join(", ") || "(empty)"}\n`);
  }
}

void main();
