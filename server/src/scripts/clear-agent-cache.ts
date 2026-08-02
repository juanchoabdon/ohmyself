/**
 * Drop the cached vision-sized copy of an asset so the next get_media has to
 * regenerate it with sharp. Useful to prove sharp actually loads in a
 * freshly deployed container, where a cache hit would hide a broken install.
 *
 *   npx tsx src/scripts/clear-agent-cache.ts <spaceId> <assetId>
 */
import "../env.js";
import { serviceClient, assetBucket } from "../core/supabase.js";

async function main() {
  const [spaceId, assetId] = process.argv.slice(2);
  if (!spaceId || !assetId) throw new Error("usage: clear-agent-cache.ts <spaceId> <assetId>");

  const sb = serviceClient();
  const key = `${spaceId}/agent/${assetId}.webp`;
  const { error } = await sb.storage.from(assetBucket()).remove([key]);
  if (error) throw new Error(error.message);

  const { data } = await sb.storage.from(assetBucket()).download(key);
  console.log(data ? `WARNING: ${key} still present` : `cleared ${key}`);
}

void main();
