/**
 * Resolve an asset the way the web client does and actually fetch the URL, so a
 * "resolved fine but the browser shows a broken image" case gets pinned down.
 *
 *   npx tsx src/scripts/debug-signed-url.ts <spaceId> <assetId>
 */
import "../env.js";
import { resolveAssets } from "../core/assets.js";

async function main() {
  const [spaceId, assetId] = process.argv.slice(2);
  if (!spaceId || !assetId) throw new Error("usage: debug-signed-url.ts <spaceId> <assetId>");

  const [asset] = await resolveAssets(spaceId, [assetId]);
  if (!asset) throw new Error("asset did not resolve at all");

  console.log(`mime:  ${asset.mime}`);
  console.log(`dims:  ${asset.width}x${asset.height}`);
  console.log(`url:   ${asset.url}`);
  console.log(`absolute: ${/^https?:\/\//.test(asset.url)}`);

  const res = await fetch(asset.url);
  console.log(`\nGET -> ${res.status} ${res.statusText}`);
  console.log(`content-type:   ${res.headers.get("content-type")}`);
  console.log(`content-length: ${res.headers.get("content-length")}`);
  if (!res.ok) console.log(`body: ${(await res.text()).slice(0, 400)}`);
}

void main();
