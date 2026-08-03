/**
 * Build a throwaway note that exercises every rich block, with a real uploaded
 * image, so the rendering can be eyeballed in the web app.
 *
 * The image goes through createAsset — the same path add_media and the web
 * uploader use — so this also proves upload, the sharp dimension probe and the
 * oms-asset round trip against the real bucket.
 *
 *   npx tsx src/scripts/seed-media-demo.ts
 *
 * Delete the note when done; nothing else depends on it.
 */
import "../env.js";
import sharp from "sharp";
import { serviceClient } from "../core/supabase.js";
import { createAsset, assetUri, resolveAssets, agentImage } from "../core/assets.js";
import { buildCore, getUserConfig } from "../core/index.js";
import { deleteCollabState } from "../collab/state-store.js";

const NOTE_PATH = "notes/media-demo.md";

/** A diagram of the media path itself, drawn in the product's palette. */
function diagramSvg(): string {
  const ink = "#2b2620";
  const muted = "#7a6f62";
  const border = "#e6e0d6";
  const amber = "#f0b429";
  const sky = "#5aa9e6";
  const mint = "#5fcfa8";

  const box = (x: number, y: number, w: number, label: string, sub: string, tint: string) => `
    <rect x="${x}" y="${y}" width="${w}" height="96" rx="14" fill="#ffffff" stroke="${border}" stroke-width="2"/>
    <rect x="${x}" y="${y}" width="6" height="96" rx="3" fill="${tint}"/>
    <text x="${x + 24}" y="${y + 40}" font-family="Inter,Helvetica,Arial,sans-serif" font-size="21" font-weight="600" fill="${ink}">${label}</text>
    <text x="${x + 24}" y="${y + 68}" font-family="Inter,Helvetica,Arial,sans-serif" font-size="15" fill="${muted}">${sub}</text>`;

  const arrow = (x: number, y: number) => `
    <path d="M ${x} ${y} L ${x + 44} ${y}" stroke="${border}" stroke-width="3" stroke-linecap="round"/>
    <path d="M ${x + 34} ${y - 7} L ${x + 45} ${y} L ${x + 34} ${y + 7}" fill="none" stroke="${border}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="520" viewBox="0 0 1600 520">
    <rect width="1600" height="520" fill="#fdfcfa"/>
    <text x="80" y="92" font-family="Inter,Helvetica,Arial,sans-serif" font-size="38" font-weight="700" fill="${ink}">Media en ohmyself</text>
    <text x="80" y="130" font-family="Inter,Helvetica,Arial,sans-serif" font-size="19" fill="${muted}">El markdown solo guarda una referencia. Los bytes nunca son publicos.</text>

    ${box(80, 190, 300, "Agente / Web", "pega o sube un archivo", amber)}
    ${arrow(396, 238)}
    ${box(456, 190, 300, "add_media", "valida, mide, guarda", sky)}
    ${arrow(772, 238)}
    ${box(832, 190, 320, "Bucket privado", "note-assets, sin acceso directo", mint)}

    <rect x="80" y="360" width="1072" height="96" rx="14" fill="#ffffff" stroke="${border}" stroke-width="2"/>
    <rect x="80" y="360" width="6" height="96" rx="3" fill="${amber}"/>
    <text x="104" y="400" font-family="Inter,Helvetica,Arial,sans-serif" font-size="21" font-weight="600" fill="${ink}">La nota guarda solo:  oms-asset:&lt;id&gt;</text>
    <text x="104" y="428" font-family="Inter,Helvetica,Arial,sans-serif" font-size="15" fill="${muted}">La web lo resuelve a una signed URL al renderizar. get_media lo entrega reescalado para que el modelo lo vea.</text>
  </svg>`;
}

async function main() {
  // Explicit: this database holds many people's brains, and picking one by
  // position writes a demo note into a stranger's vault.
  const spaceId = process.argv[2];
  if (!spaceId) throw new Error("usage: seed-media-demo.ts <spaceId>");

  const sb = serviceClient();
  const { data: listed } = await sb.storage.from("brain").list(spaceId, { limit: 5 });
  if (!listed?.length) throw new Error(`no vault at ${spaceId} — wrong space id?`);
  const space = { id: spaceId };
  console.log(`space: ${spaceId}`);

  const png = await sharp(Buffer.from(diagramSvg())).png().toBuffer();
  const asset = await createAsset({
    spaceId: space.id,
    path: NOTE_PATH,
    mime: "image/png",
    bytes: new Uint8Array(png),
    originalName: "media-pipeline.png",
    createdBy: space.id,
  });
  console.log(`uploaded: ${assetUri(asset.id)} — ${asset.width}x${asset.height}, ${Math.round(asset.sizeBytes / 1024)} KB`);

  const body = `Nota de prueba para ver como se ven los bloques ricos. Borrable.

> [!info] Que estamos mirando
> La imagen de abajo se subio de verdad al bucket privado. El markdown de esta nota no contiene ninguna URL — solo la referencia \`${assetUri(asset.id)}\`.

## Imagen subida

:::image
src: ${assetUri(asset.id)}
alt: Diagrama del flujo de media
caption: Click para hacer zoom. Los bytes viven en un bucket privado.
:::

## Callouts

> [!warning] Limite de tamano
> Imagenes hasta 10 MB, video hasta 50 MB. Para algo mas largo, un link a Loom o YouTube.

> [!tip] Para agentes
> \`get_media\` devuelve la imagen reescalada a 1568px, asi que leerla es barato.

## Tabs

:::tabs
:::tab Como se guarda
El archivo va a un bucket privado y la fila a \`note_assets\`. El cuerpo de la nota solo referencia el id.
:::
:::tab Como se lee
La web pide una signed URL de corta vida. Un agente llama \`get_media\` y recibe la imagen como contenido visual.
:::
:::tab Limites
PNG, JPEG, WEBP, GIF y AVIF hasta 10 MB. MP4, WEBM y MOV hasta 50 MB.
:::
:::

## Accordion

:::accordion
:::accordion-item Por que un bucket privado
Un screenshot pegado en una nota secret es tan sensible como la nota. Con bucket publico bastaria adivinar la URL.
:::
:::accordion-item Por que no guardar la URL en el markdown
Una signed URL expira. Si viviera en el cuerpo de la nota, la nota se romperia sola con el tiempo.
:::
:::

## Video embebido

:::video
src: https://www.youtube.com/watch?v=dQw4w9WgXcQ
title: Un embed de YouTube sigue funcionando igual
:::

## Graficas (Mermaid)

No hay un widget de chart aparte — Mermaid es el camino. Pie, barras y flujos se renderizan en editor y en lectura.

\`\`\`mermaid
pie title Donde vive cada cosa
  "Bucket privado" : 45
  "Markdown (oms-asset)" : 25
  "Signed URL (efimera)" : 20
  "Derivado agente" : 10
\`\`\`

\`\`\`mermaid
xychart-beta
  title "Tamano tipico por tipo"
  x-axis [PNG, JPEG, WEBP, MP4]
  y-axis "MB" 0 --> 50
  bar [2, 3, 1, 28]
\`\`\`

\`\`\`mermaid
flowchart LR
  A[Pega / sube] --> B[add_media]
  B --> C[Bucket privado]
  C --> D[oms-asset:id]
  D --> E[Web: signed URL]
  D --> F[Agente: get_media]
\`\`\`

## HTML preview

\`\`\`html preview
<div style="font:600 18px/1.4 system-ui;padding:16px;border-radius:12px;background:linear-gradient(135deg,#f0b42922,#5aa9e622);border:1px solid #e6e0d6">
  Widget HTML sandboxed — util para mockups rapidos.
</div>
\`\`\`

## Tabla y checklist

| Bloque | Sube archivo | Lo ve un agente |
| --- | --- | --- |
| Imagen | si | si, via get_media |
| Video subido | si | solo metadata + URL |
| Embed externo | no | no |

- [x] Bucket privado creado
- [x] Subida real probada
- [x] Deploy a Railway

\`\`\`ts
const { base64, mime } = await agentImage(spaceId, id);
\`\`\`
`;

  const { brain } = buildCore();
  const config = await getUserConfig(space.id);
  const { created } = await brain.upsertNote(
    space.id,
    NOTE_PATH,
    { title: "Media demo", body, type: "note", visibility: "private" },
    config,
    ["public", "private", "secret"],
  );
  console.log(`note ${created ? "created" : "updated"}: ${NOTE_PATH}`);
  // Drop any stale Y.Doc so the editor rehydrates from this markdown.
  await deleteCollabState(space.id, NOTE_PATH);

  const [signed] = await resolveAssets(space.id, [asset.id]);
  console.log(`signed url: ${signed?.url ? "ok" : "FAILED"}`);
  const vision = await agentImage(space.id, asset.id);
  console.log(
    `agent copy: ${vision.mime}, ${Math.round(vision.base64.length / 1024)} KB base64${vision.downscaled ? " (downscaled)" : ""}`,
  );
  const web = (process.env.PUBLIC_WEB_URL || "http://localhost:3000").replace(/\/+$/, "");
  console.log(`\nopen: ${web}/app?note=${encodeURIComponent(NOTE_PATH)}&space=${space.id}`);
}

void main();
