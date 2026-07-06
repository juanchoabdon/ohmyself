import { NextRequest } from "next/server";
import { listPublicNotes } from "@/lib/brain";
import { translateTexts, type NoteLang } from "@/lib/translate";

export const runtime = "nodejs";

function normalizeLang(raw: string | null): NoteLang | null {
  return raw === "es" || raw === "en" ? raw : null;
}

/**
 * The full list of PUBLIC notes — the folder browser and the brain graph are
 * both built from this. Thin proxy: the actual scope enforcement happens in
 * ohmyself-api itself (the public token can only ever see public notes), and
 * the result is cached (see lib/brain.ts) so this is fast on every hit.
 *
 * `?lang=en|es` additionally translates each note's title and excerpt into
 * that language (batched into one cached call — see lib/translate.ts), so a
 * visitor browsing in English isn't shown a wall of Spanish note titles.
 */
export async function GET(req: NextRequest) {
  const notes = await listPublicNotes();
  const lang = normalizeLang(req.nextUrl.searchParams.get("lang"));

  if (!lang || notes.length === 0) {
    return json({ notes });
  }

  const [titles, excerpts] = await Promise.all([
    translateTexts(lang, notes.map((n) => n.title)),
    translateTexts(lang, notes.map((n) => n.excerpt ?? "")),
  ]);
  const translated = notes.map((n, i) => ({
    ...n,
    title: titles[i] || n.title,
    excerpt: n.excerpt ? excerpts[i] || n.excerpt : n.excerpt,
  }));
  return json({ notes: translated });
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
