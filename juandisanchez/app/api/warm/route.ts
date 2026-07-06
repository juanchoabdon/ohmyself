import { getCachedIntro } from "@/lib/intro";
import { listPublicNotes, publicSemanticEdges, readPublicNote } from "@/lib/brain";
import { translateNoteBody, translateTexts, type NoteLang } from "@/lib/translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Warm the translated notes list (titles + excerpts) for one language. */
async function warmNotesList(lang: NoteLang): Promise<void> {
  const notes = await listPublicNotes();
  await Promise.all([
    translateTexts(lang, notes.map((n) => n.title)),
    translateTexts(lang, notes.map((n) => n.excerpt ?? "")),
  ]);
}

/** Warm the translated bio note (the default landing note on /brain) for
 *  one language, so switching languages there is instant too. */
async function warmBio(lang: NoteLang): Promise<void> {
  const bio = await readPublicNote("identity/bio.md");
  if (!bio) return;
  await Promise.all([
    translateTexts(lang, [bio.title]),
    translateNoteBody(bio.path, bio.updated, lang, bio.body),
  ]);
}

/** Proactively refresh every cache that gates "first paint" for a visitor,
 *  instead of waiting for whichever unlucky person happens to be the one
 *  whose request recomputes it after it expires. Ping this on a schedule
 *  (see .github/workflows/warm-cache.yml) at an interval shorter than the
 *  shortest revalidate window below it, so the cache is *always* warm by
 *  the time a real visitor arrives — first-time or not.
 *
 *  Cheap and side-effect-free (no secrets required): every call here just
 *  re-populates Next's shared Data Cache with the same data any visitor
 *  would have triggered anyway. Safe to expose publicly and safe to call
 *  concurrently / redundantly. */
export async function GET() {
  const started = Date.now();
  const results = await Promise.allSettled([
    getCachedIntro("en"),
    getCachedIntro("es"),
    listPublicNotes(),
    publicSemanticEdges(),
    readPublicNote("identity/bio.md"),
    warmNotesList("en"),
    warmNotesList("es"),
    warmBio("en"),
    warmBio("es"),
  ]);

  const labels = [
    "intro:en",
    "intro:es",
    "notes",
    "semantic",
    "bio",
    "notes-translated:en",
    "notes-translated:es",
    "bio-translated:en",
    "bio-translated:es",
  ];
  const status = results.map((r, i) => ({
    task: labels[i],
    ok: r.status === "fulfilled",
    error: r.status === "rejected" ? String(r.reason) : undefined,
  }));

  return Response.json(
    { ok: status.every((s) => s.ok), ms: Date.now() - started, warmed: status },
    { headers: { "Cache-Control": "no-store" } },
  );
}
