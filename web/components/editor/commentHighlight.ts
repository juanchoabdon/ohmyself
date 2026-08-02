import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { resolveAnchor } from "@/lib/anchor";
import type { CommentThread } from "@/lib/types";

/**
 * Paints comment anchors as inline decorations.
 *
 * Anchors are stored as quotes, not positions, so every render re-finds the
 * quote in the live document. That costs a scan per thread but means a comment
 * follows its sentence while someone else edits around it — and never needs the
 * markdown to carry comment markup.
 */

export const commentHighlightKey = new PluginKey<PluginState>("commentHighlight");

interface Range {
  threadId: string;
  from: number;
  to: number;
}

interface PluginState {
  threads: CommentThread[];
  activeThreadId: string | null;
  ranges: Range[];
  decorations: DecorationSet;
}

/** Flatten the doc to plain text with a position for every character. */
function textIndex(doc: PMNode): { text: string; pos: number[] } {
  let text = "";
  const pos: number[] = [];
  doc.descendants((node, p) => {
    if (node.isText) {
      const t = node.text ?? "";
      for (let i = 0; i < t.length; i++) {
        text += t[i];
        pos.push(p + i);
      }
      return false;
    }
    // Block boundaries become newlines so a quote can't silently span them.
    if (node.isBlock && text.length > 0 && !text.endsWith("\n")) {
      text += "\n";
      pos.push(p);
    }
    return true;
  });
  return { text, pos };
}

function computeRanges(doc: PMNode, threads: CommentThread[]): Range[] {
  if (threads.length === 0) return [];
  const { text, pos } = textIndex(doc);
  if (!text) return [];

  const ranges: Range[] = [];
  for (const thread of threads) {
    if (!thread.anchor || thread.resolvedAt) continue;
    const match = resolveAnchor(text, thread.anchor);
    if (!match) continue;
    let { start, end } = match;
    while (start < end && text[start] === "\n") start++;
    while (end > start && text[end - 1] === "\n") end--;
    const from = pos[start];
    const to = pos[end - 1];
    if (from === undefined || to === undefined) continue;
    ranges.push({ threadId: thread.id, from, to: to + 1 });
  }
  return ranges;
}

function buildDecorations(doc: PMNode, ranges: Range[], activeThreadId: string | null): DecorationSet {
  if (ranges.length === 0) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    ranges.map((r) =>
      Decoration.inline(r.from, r.to, {
        class: `oms-comment-mark${r.threadId === activeThreadId ? " is-active" : ""}`,
        "data-thread-id": r.threadId,
      }),
    ),
  );
}

export interface CommentHighlightOptions {
  /** Called when the reader clicks inside a highlighted span. */
  onSelectThread: ((threadId: string) => void) | null;
}

export const CommentHighlight = Extension.create<CommentHighlightOptions>({
  name: "commentHighlight",

  addOptions() {
    return { onSelectThread: null };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<PluginState>({
        key: commentHighlightKey,
        state: {
          init: () => ({
            threads: [],
            activeThreadId: null,
            ranges: [],
            decorations: DecorationSet.empty,
          }),
          apply(tr, value, _old, newState) {
            const meta = tr.getMeta(commentHighlightKey) as
              | { threads?: CommentThread[]; activeThreadId?: string | null }
              | undefined;
            if (!meta && !tr.docChanged) return value;

            const threads = meta?.threads ?? value.threads;
            const activeThreadId =
              meta && "activeThreadId" in meta ? (meta.activeThreadId ?? null) : value.activeThreadId;
            const ranges = computeRanges(newState.doc, threads);
            return {
              threads,
              activeThreadId,
              ranges,
              decorations: buildDecorations(newState.doc, ranges, activeThreadId),
            };
          },
        },
        props: {
          decorations(state) {
            return commentHighlightKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
          handleClick(view, pos) {
            const state = commentHighlightKey.getState(view.state);
            if (!state || !options.onSelectThread) return false;
            const hit = state.ranges.find((r) => pos >= r.from && pos <= r.to);
            if (!hit) return false;
            options.onSelectThread(hit.threadId);
            return false;
          },
        },
      }),
    ];
  },
});

/** Push the current threads into the running editor. */
export function syncCommentHighlights(
  view: EditorView | null | undefined,
  threads: CommentThread[],
  activeThreadId: string | null,
): void {
  if (!view) return;
  view.dispatch(view.state.tr.setMeta(commentHighlightKey, { threads, activeThreadId }));
}
