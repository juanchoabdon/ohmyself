/**
 * Text-quote anchors for inline comments.
 *
 * A comment thread points at a span of a note by quoting it plus a bit of
 * surrounding context, not by storing a position. Positions rot on every edit
 * and can't survive the markdown round-trip the collab server does on each
 * store; a quote re-anchors itself as long as the text is still there, and
 * degrades to "orphaned" (rather than pointing at the wrong sentence) once it
 * isn't.
 *
 * Resolution cascade, most to least confident:
 *   1. the quote is still at the recorded offset
 *   2. prefix + quote + suffix matches somewhere (survives text moving around)
 *   3. the quote alone matches — nearest occurrence to the recorded offset wins
 *   4. same as 3 but on normalized text, so an agent quoting "the plan" still
 *      matches a body that says "the **plan**"
 */

/** How much surrounding text we keep to disambiguate repeated quotes. */
const CONTEXT = 48;
/** Quotes longer than this are truncated — anchors are for spans, not essays. */
export const MAX_QUOTE = 2000;

export interface CommentAnchor {
  quote: string;
  prefix: string;
  suffix: string;
  /** Character offset of the quote in the body when the anchor was created. */
  offset: number;
}

export interface AnchorMatch {
  start: number;
  end: number;
  /** How the match was found — surfaced so the UI can flag shaky anchors. */
  how: "exact" | "context" | "quote" | "fuzzy";
}

interface Normalized {
  text: string;
  /** map[i] is the index in the original string of normalized char i. */
  map: number[];
}

/**
 * Collapse whitespace and drop inline markdown emphasis markers. Applied to
 * both haystack and needle, so dropping `_` inside snake_case is harmless: it
 * disappears on both sides.
 */
function normalize(input: string): Normalized {
  const out: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === "*" || ch === "_" || ch === "`" || ch === "~") continue;
    if (/\s/.test(ch)) {
      if (out.length > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      out.push(" ");
      map.push(i);
      pendingSpace = false;
    }
    out.push(ch);
    map.push(i);
  }
  return { text: out.join(""), map };
}

/** All indexes of `needle` in `haystack` (non-overlapping, left to right). */
function allIndexes(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const found: number[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    found.push(at);
    from = at + needle.length;
  }
  return found;
}

function nearest(candidates: number[], target: number): number | null {
  if (candidates.length === 0) return null;
  let best = candidates[0]!;
  let bestDist = Math.abs(best - target);
  for (const c of candidates.slice(1)) {
    const d = Math.abs(c - target);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/** Find a quote in the body, preferring the occurrence closest to `hint`. */
export function locateQuote(body: string, quote: string, hint = 0): AnchorMatch | null {
  const needle = quote.trim();
  if (!needle) return null;

  const direct = nearest(allIndexes(body, needle), hint);
  if (direct !== null) {
    return { start: direct, end: direct + needle.length, how: "quote" };
  }

  const nBody = normalize(body);
  const nQuote = normalize(needle);
  if (!nQuote.text) return null;
  // Translate the raw hint into normalized space so "nearest" stays meaningful.
  const nHint = nBody.map.findIndex((orig) => orig >= hint);
  const at = nearest(allIndexes(nBody.text, nQuote.text), nHint < 0 ? nBody.text.length : nHint);
  if (at === null) return null;

  const start = nBody.map[at];
  const endIdx = nBody.map[at + nQuote.text.length - 1];
  if (start === undefined || endIdx === undefined) return null;
  return { start, end: endIdx + 1, how: "fuzzy" };
}

/**
 * Build an anchor for `quote` against the current body. Returns null when the
 * quote isn't in the note — callers turn that into an explicit error so an
 * agent can retry with text that actually exists.
 */
export function buildAnchor(body: string, quote: string, hint?: number): CommentAnchor | null {
  const trimmed = quote.trim().slice(0, MAX_QUOTE);
  const match = locateQuote(body, trimmed, hint ?? 0);
  if (!match) return null;
  return {
    quote: body.slice(match.start, match.end),
    prefix: body.slice(Math.max(0, match.start - CONTEXT), match.start),
    suffix: body.slice(match.end, match.end + CONTEXT),
    offset: match.start,
  };
}

/** Re-anchor a stored anchor against the current body. Null means orphaned. */
export function resolveAnchor(body: string, anchor: CommentAnchor): AnchorMatch | null {
  const quote = anchor.quote;
  if (!quote.trim()) return null;

  if (body.slice(anchor.offset, anchor.offset + quote.length) === quote) {
    return { start: anchor.offset, end: anchor.offset + quote.length, how: "exact" };
  }

  // Context match: try full context first, then progressively less of it, so a
  // thread survives an edit that touched only one side of the quote.
  for (const width of [CONTEXT, Math.floor(CONTEXT / 2), Math.floor(CONTEXT / 4)]) {
    const prefix = anchor.prefix.slice(-width);
    const suffix = anchor.suffix.slice(0, width);
    if (!prefix && !suffix) break;
    const at = nearest(allIndexes(body, prefix + quote + suffix), Math.max(0, anchor.offset - prefix.length));
    if (at !== null) {
      const start = at + prefix.length;
      return { start, end: start + quote.length, how: "context" };
    }
  }

  return locateQuote(body, quote, anchor.offset);
}

/** Shape guard for anchors coming back out of jsonb. */
export function parseAnchor(value: unknown): CommentAnchor | null {
  if (!value || typeof value !== "object") return null;
  const a = value as Record<string, unknown>;
  if (typeof a.quote !== "string" || !a.quote) return null;
  return {
    quote: a.quote,
    prefix: typeof a.prefix === "string" ? a.prefix : "",
    suffix: typeof a.suffix === "string" ? a.suffix : "",
    offset: typeof a.offset === "number" && Number.isFinite(a.offset) ? a.offset : 0,
  };
}
