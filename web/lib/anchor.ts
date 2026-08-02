import type { CommentAnchor } from "./types";

/**
 * Client-side twin of the server's anchor resolver.
 *
 * The server anchors against the note's markdown; the browser has to highlight
 * against what's actually rendered — ProseMirror's plain text in the editor,
 * DOM text in the read-only view — and those don't share offsets. So the quote
 * travels with the comment and each surface re-finds it locally.
 *
 * Same cascade as the server: recorded offset, then quote-with-context, then
 * the quote alone (nearest occurrence), then a normalized pass that ignores
 * whitespace and markdown emphasis. Null means the text is gone.
 */

const CONTEXT = 48;

export interface AnchorMatch {
  start: number;
  end: number;
  how: "exact" | "context" | "quote" | "fuzzy";
}

interface Normalized {
  text: string;
  map: number[];
}

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

export function locateQuote(text: string, quote: string, hint = 0): AnchorMatch | null {
  const needle = quote.trim();
  if (!needle) return null;

  const direct = nearest(allIndexes(text, needle), hint);
  if (direct !== null) return { start: direct, end: direct + needle.length, how: "quote" };

  const nText = normalize(text);
  const nQuote = normalize(needle);
  if (!nQuote.text) return null;
  const nHint = nText.map.findIndex((orig) => orig >= hint);
  const at = nearest(allIndexes(nText.text, nQuote.text), nHint < 0 ? nText.text.length : nHint);
  if (at === null) return null;

  const start = nText.map[at];
  const endIdx = nText.map[at + nQuote.text.length - 1];
  if (start === undefined || endIdx === undefined) return null;
  return { start, end: endIdx + 1, how: "fuzzy" };
}

export function resolveAnchor(text: string, anchor: CommentAnchor): AnchorMatch | null {
  const quote = anchor.quote;
  if (!quote.trim()) return null;

  if (text.slice(anchor.offset, anchor.offset + quote.length) === quote) {
    return { start: anchor.offset, end: anchor.offset + quote.length, how: "exact" };
  }

  for (const width of [CONTEXT, Math.floor(CONTEXT / 2), Math.floor(CONTEXT / 4)]) {
    const prefix = anchor.prefix.slice(-width);
    const suffix = anchor.suffix.slice(0, width);
    if (!prefix && !suffix) break;
    const at = nearest(
      allIndexes(text, prefix + quote + suffix),
      Math.max(0, anchor.offset - prefix.length),
    );
    if (at !== null) {
      const start = at + prefix.length;
      return { start, end: start + quote.length, how: "context" };
    }
  }

  return locateQuote(text, quote, anchor.offset);
}
