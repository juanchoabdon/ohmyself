/**
 * The PASSAGE of a note — what matched, with its surroundings — instead of the
 * whole note.
 *
 * Why (measured 2026-09-22, from the bonds room brain): one `recall` on a space
 * of real specs answered with **138,763 characters (~35k tokens)** — six whole
 * documents pasted into the caller's context, with the answer lost inside. A
 * client that trims the blob does it worse: cutting at N characters keeps the
 * first note and a half and silently drops the rest.
 *
 * Retrieval already knows WHERE it matched: every hit carries the chunk that
 * matched (`excerpt`) and its heading (`section`). This builds the passage
 * around that anchor and leaves the whole document one `read_note` away, which
 * is exactly what that tool is for.
 */

/** How much is read around the anchor. Chunks are ~1400 chars, so this covers
 *  the chunk that matched plus what sits against it. */
const BEFORE_CHARS = 900;
const AFTER_CHARS = 1_800;
/** Budget for the whole answer, and the floor/ceiling per note: every source
 *  gets a slice, none of them eats the context. */
const TOTAL_CHARS = 14_000;
const MIN_PER_NOTE = 700;
const MAX_PER_NOTE = 3_000;
/** How much of the excerpt is used to find the anchor inside the body. */
const ANCHOR_CHARS = 60;

/** Where, inside `body`, the matched text starts. -1 when it cannot be found:
 *  the excerpt comes from the chunk (raw note text), but a rewrite between
 *  indexing and reading can leave it without an anchor. */
export function anchorIn(body: string, excerpt?: string): number {
  const probe = (excerpt ?? "").trim().slice(0, ANCHOR_CHARS);
  if (!probe) return -1;
  const direct = body.indexOf(probe);
  if (direct !== -1) return direct;
  // Second pass, tolerant to different whitespace and line breaks.
  const loose = probe.replace(/\s+/g, " ").trim();
  const flat = body.replace(/\s+/g, " ");
  const at = flat.indexOf(loose);
  if (at === -1) return -1;
  let seen = 0;
  for (let i = 0; i < body.length; i += 1) {
    if (seen === at) return i;
    const isSpace = /\s/.test(body[i]!);
    if (!isSpace || !/\s/.test(body[i - 1] ?? "")) seen += 1;
  }
  return -1;
}

/** The slice of `body` around what matched, capped at `budget` and marked with
 *  … where it was cut. A note that fits comes back whole. */
export function passageOf(body: string, excerpt: string | undefined, budget: number): string {
  const text = body ?? "";
  if (text.length <= budget) return text.trim();
  const at = anchorIn(text, excerpt);
  const before = Math.min(BEFORE_CHARS, Math.floor(budget / 3));
  const from = at === -1 ? 0 : Math.max(0, at - before);
  const to = Math.min(text.length, from + Math.min(budget, BEFORE_CHARS + AFTER_CHARS));
  const slice = text.slice(from, to).trim();
  return `${from > 0 ? "…" : ""}${slice}${to < text.length ? "…" : ""}`;
}

/** How many characters each of `count` notes may spend. */
export function passageBudget(count: number, totalChars = TOTAL_CHARS): number {
  if (count <= 0) return MAX_PER_NOTE;
  return Math.min(MAX_PER_NOTE, Math.max(MIN_PER_NOTE, Math.floor(totalChars / count)));
}

/** The piece of `content` around the first word of `query` that appears in it,
 *  for the lexical path — where the stored excerpt is the note's OPENING, not
 *  what matched. Falls back to the opening when no token is found. */
export function matchExcerpt(content: string, query: string, max = 240): string {
  const text = content ?? "";
  if (!text) return "";
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3);
  const haystack = text.toLowerCase();
  let at = -1;
  for (const token of tokens) {
    const found = haystack.indexOf(token);
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  if (at === -1) return text.slice(0, max);
  const from = Math.max(0, at - Math.floor(max / 3));
  const slice = text.slice(from, from + max).trim();
  return `${from > 0 ? "…" : ""}${slice}${from + max < text.length ? "…" : ""}`;
}
