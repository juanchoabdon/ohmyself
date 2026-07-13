/** Public notes are written verbatim, in whatever language Juan Diego wrote
 *  them in (a mix of Spanish and English) — but the Second Self / Skills
 *  views need to actually read in whichever language the visitor picked,
 *  not just have translated UI chrome around untranslated content. These
 *  helpers translate on demand and cache the result (Next's shared Data
 *  Cache) so the OpenAI round trip only ever happens once per (note,
 *  language) — every subsequent visitor gets it instantly, exactly like the
 *  intro greeting and public context elsewhere in lib/.
 *
 *  Important: the cached inner functions THROW on any failure (bad/short
 *  model output, network error) instead of falling back to the original
 *  text — `unstable_cache` never caches a thrown rejection, only a
 *  returned value. If we returned the untranslated fallback directly from
 *  inside the cached function, a single transient hiccup would get cached
 *  as "correct" for a full day. The exported wrappers below catch that
 *  error and fall back to the original text on every call instead, so a
 *  failure just means "try again next time", never "stuck wrong for 24h". */
import { unstable_cache } from "next/cache";
import { completeOnce } from "@/lib/openai";

export type NoteLang = "en" | "es";

const TRANSLATE_REVALIDATE_S = 60 * 60 * 24;

function langName(lang: NoteLang): string {
  return lang === "es" ? "Spanish" : "English";
}

const translateNoteBodyCached = unstable_cache(
  async (
    _path: string,
    _updated: string | undefined,
    lang: NoteLang,
    body: string,
  ): Promise<string> => {
    const target = langName(lang);
    const sys = `You translate a personal note from a bilingual (EN/ES) personal website. If the TEXT is already written in ${target}, return it completely unchanged, verbatim — never rephrase or "improve" text that's already in the right language. Otherwise, translate it into natural, fluent ${target}. Preserve ALL Markdown exactly as-is: headings, lists, bold/italic, links, code fences, line breaks. Inside fenced \`\`\`card\`\`\` or \`\`\`link\`\`\` blocks (single-line JSON), translate ONLY human-readable string VALUES (e.g. "desc", "highlights", "title", "cta") — never touch JSON keys, punctuation/structure, or any "href" URL. Output ONLY the resulting text — no preamble, no surrounding quotes, no extra code fence wrapping the whole thing.`;
    const out = await completeOnce(
      [
        { role: "system", content: sys },
        { role: "user", content: body },
      ],
      { temperature: 0, maxTokens: 4000 },
    );
    // A translation that comes back suspiciously short relative to the
    // source is almost certainly a truncated/failed completion, not a
    // legitimately shorter translation — treat it as a failure so it
    // doesn't get cached.
    if (!out || out.trim().length < body.trim().length * 0.4) {
      throw new Error("translateNoteBody: empty or implausibly short output");
    }
    return out.trim();
  },
  ["note-translation-body-v1"],
  { revalidate: TRANSLATE_REVALIDATE_S },
);

/** Translate one note's full Markdown body. Passes text through unchanged
 *  (verbatim) when it's already in the target language — the model decides,
 *  so this never mangles a note that's already correct. `updated` is part
 *  of the cache key purely so editing the source note (which bumps it)
 *  naturally invalidates any stale translation, without needing to track
 *  versions ourselves. Falls back to the original body on any failure. */
export async function translateNoteBody(
  path: string,
  updated: string | undefined,
  lang: NoteLang,
  body: string,
): Promise<string> {
  if (!body.trim()) return body;
  try {
    return await translateNoteBodyCached(path, updated, lang, body);
  } catch {
    return body;
  }
}

const translateTextsCached = unstable_cache(
  async (lang: NoteLang, texts: string[]): Promise<string[]> => {
    const target = langName(lang);
    const sys = `You translate a JSON array of short strings (titles/snippets from a personal website) into ${target}. Any string already written in ${target} must be returned completely unchanged. Return ONLY a JSON array of the exact same length, in the exact same order — no other text.`;
    const out = await completeOnce(
      [
        { role: "system", content: sys },
        { role: "user", content: JSON.stringify(texts) },
      ],
      { temperature: 0, maxTokens: 1600, timeoutMs: 25000 },
    );
    if (!out) throw new Error("translateTexts: empty output");
    const start = out.indexOf("[");
    const end = out.lastIndexOf("]");
    if (start === -1 || end === -1) throw new Error("translateTexts: no JSON array in output");
    const parsed = JSON.parse(out.slice(start, end + 1));
    if (!Array.isArray(parsed) || parsed.length !== texts.length) {
      throw new Error("translateTexts: shape mismatch");
    }
    return parsed.map((s, i) => (typeof s === "string" && s.trim() ? s : texts[i]));
  },
  ["note-translation-batch-v1"],
  { revalidate: TRANSLATE_REVALIDATE_S },
);

/** How many strings go into one model call. One giant call for the whole
 *  site (60+ titles/excerpts as escaped JSON) reliably blew past any sane
 *  timeout — it made /brain hang ~45s and, worse, the failure meant NOTHING
 *  got cached, so it hung again for every next visitor. Small chunks finish
 *  in a few seconds each, run in parallel, and each chunk caches
 *  independently — one slow/failed chunk degrades only its own slice to
 *  untranslated instead of sinking the whole list. */
const BATCH_CHUNK = 8;

/** Translate a batch of short strings (note titles, excerpts), chunked into
 *  small parallel calls (see BATCH_CHUNK). Falls back per-chunk to the
 *  original strings on failure, so a flaky model response degrades to
 *  "untranslated", never to broken data — and never gets stuck that way,
 *  since only genuine successes are cached. */
export async function translateTexts(lang: NoteLang, texts: string[]): Promise<string[]> {
  if (texts.length === 0) return texts;
  const chunks: string[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_CHUNK) {
    chunks.push(texts.slice(i, i + BATCH_CHUNK));
  }
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        return await translateTextsCached(lang, chunk);
      } catch {
        return chunk;
      }
    }),
  );
  return results.flat();
}
