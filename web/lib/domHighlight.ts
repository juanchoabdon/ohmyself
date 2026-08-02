import { resolveAnchor } from "./anchor";
import type { CommentThread } from "./types";

/**
 * Comment highlights for rendered (non-editable) markdown.
 *
 * Uses the CSS Custom Highlight API instead of wrapping matches in elements:
 * the read-only body is React-rendered, and mutating that DOM would fight
 * reconciliation. Ranges live outside the tree, so React never sees them.
 * Browsers without the API simply show no highlight — the comments panel still
 * lists every thread with its quote.
 */

const HIGHLIGHT = "oms-comment";
const HIGHLIGHT_ACTIVE = "oms-comment-active";
const STYLE_ID = "oms-comment-highlight-styles";

/**
 * `::highlight()` can't live in globals.css: Turbopack's CSS parser rejects the
 * pseudo-element and fails the production build. Injecting it at runtime hands
 * parsing to the browser, which is also the only thing that supports it.
 */
function ensureStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
::highlight(${HIGHLIGHT}) {
  background-color: color-mix(in oklab, var(--brand) 18%, transparent);
}
::highlight(${HIGHLIGHT_ACTIVE}) {
  background-color: color-mix(in oklab, var(--brand) 34%, transparent);
}`;
  document.head.appendChild(style);
}

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

type HighlightCtor = new (...ranges: Range[]) => unknown;

function registry(): HighlightRegistry | null {
  if (typeof CSS === "undefined") return null;
  const highlights = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
  const ctor = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;
  return highlights && ctor ? highlights : null;
}

/** Every text node in order, with the running offset where each one starts. */
function textNodes(container: HTMLElement): { text: string; nodes: { node: Text; start: number }[] } {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    const value = node.nodeValue ?? "";
    if (value) {
      nodes.push({ node, start: text.length });
      text += value;
    }
    current = walker.nextNode();
  }
  return { text, nodes };
}

function pointAt(
  nodes: { node: Text; start: number }[],
  offset: number,
): { node: Text; offset: number } | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const entry = nodes[i]!;
    if (offset >= entry.start) {
      const local = Math.min(offset - entry.start, entry.node.nodeValue?.length ?? 0);
      return { node: entry.node, offset: local };
    }
  }
  return null;
}

export function clearCommentHighlights(): void {
  const reg = registry();
  if (!reg) return;
  reg.delete(HIGHLIGHT);
  reg.delete(HIGHLIGHT_ACTIVE);
}

export function applyCommentHighlights(
  container: HTMLElement | null,
  threads: CommentThread[],
  activeThreadId: string | null,
): void {
  const reg = registry();
  if (!reg) return;
  if (!container) {
    clearCommentHighlights();
    return;
  }

  ensureStyles();
  const Ctor = (globalThis as unknown as { Highlight: HighlightCtor }).Highlight;
  const { text, nodes } = textNodes(container);
  const normal: Range[] = [];
  const active: Range[] = [];

  if (text) {
    for (const thread of threads) {
      if (!thread.anchor || thread.resolvedAt) continue;
      const match = resolveAnchor(text, thread.anchor);
      if (!match) continue;
      const from = pointAt(nodes, match.start);
      const to = pointAt(nodes, match.end);
      if (!from || !to) continue;
      try {
        const range = document.createRange();
        range.setStart(from.node, from.offset);
        range.setEnd(to.node, to.offset);
        (thread.id === activeThreadId ? active : normal).push(range);
      } catch {
        /* node detached mid-render */
      }
    }
  }

  if (normal.length) reg.set(HIGHLIGHT, new Ctor(...normal));
  else reg.delete(HIGHLIGHT);
  if (active.length) reg.set(HIGHLIGHT_ACTIVE, new Ctor(...active));
  else reg.delete(HIGHLIGHT_ACTIVE);
}
