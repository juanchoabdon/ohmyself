/**
 * Add three image blocks that differ only in where the URL comes from, so the
 * browser tells us which layer is broken:
 *
 *   A  oms-asset:<id>        -> goes through the client resolver
 *   B  a signed supabase URL -> skips the resolver, same host as A
 *   C  a public image on another host. Full size on purpose: upload.wikimedia.org
 *      400s on any thumbnail width outside its allowed list.
 *
 * A broken, B fine   -> the client resolver
 * A+B broken, C fine -> supabase.co unreachable from the browser
 * all broken         -> images are broken generally, not a media bug
 *
 *   npx tsx src/scripts/diagnose-image-render.ts <spaceId> <assetId>
 */
import "../env.js";
import { buildCore, getUserConfig, resolveAssets, assetUri } from "../core/index.js";
import { deleteCollabState } from "../collab/state-store.js";

const NOTE_PATH = "notes/media-diagnostic.md";

async function main() {
  const [spaceId, assetId] = process.argv.slice(2);
  if (!spaceId || !assetId) throw new Error("usage: diagnose-image-render.ts <spaceId> <assetId>");

  const [asset] = await resolveAssets(spaceId, [assetId]);
  if (!asset) throw new Error("asset did not resolve");

  const body = `Tres imagenes que deberian verse igual. Dime cuales cargan.

## A — referencia oms-asset (pasa por el resolver del cliente)

:::image
src: ${assetUri(assetId)}
alt: A - via resolver
caption: A
:::

## B — la misma imagen, URL firmada directa (NO pasa por el resolver)

:::image
src: ${asset.url}
alt: B - URL firmada directa
caption: B
:::

## C — imagen publica en otro dominio

:::image
src: https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png
alt: C - dominio externo
caption: C
:::
`;

  const { brain } = buildCore();
  const config = await getUserConfig(spaceId);
  await brain.upsertNote(
    spaceId,
    NOTE_PATH,
    { title: "Media diagnostic", body, type: "note", visibility: "private" },
    config,
    ["public", "private", "secret"],
  );

  // The editor renders the Y.Doc, not the vault file. Leaving a room from a
  // previous run alive would show the old diagnostic and hide whatever we just
  // changed — including the signed URL in B, which expires within the hour.
  await deleteCollabState(spaceId, NOTE_PATH);

  const web = (process.env.PUBLIC_WEB_URL || "http://localhost:3000").replace(/\/+$/, "");
  console.log(`open: ${web}/app?note=${encodeURIComponent(NOTE_PATH)}`);
}

void main();
