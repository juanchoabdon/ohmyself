import { publicSemanticEdges } from "@/lib/brain";

export const runtime = "nodejs";

/** Embeddings-derived "idea link" edges between PUBLIC notes only — the brain
 *  graph's optional layer. Loaded lazily (only when a visitor toggles it on)
 *  since it's the priciest call in this whole feature. */
export async function GET() {
  const data = await publicSemanticEdges();
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
