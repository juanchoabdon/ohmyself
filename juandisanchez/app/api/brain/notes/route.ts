import { listPublicNotes } from "@/lib/brain";

export const runtime = "nodejs";

/**
 * The full list of PUBLIC notes — the folder browser and the brain graph are
 * both built from this. Thin proxy: the actual scope enforcement happens in
 * ohmyself-api itself (the public token can only ever see public notes), and
 * the result is cached (see lib/brain.ts) so this is fast on every hit.
 */
export async function GET() {
  const notes = await listPublicNotes();
  return new Response(JSON.stringify({ notes }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
