import type { EditorView } from "@tiptap/pm/view";
import { isInternalNoteHref, notePathFromHref } from "./wikiLinkMarkdown";

/** TipTap Link strips disallowed hrefs from the DOM — allow note paths + wiki: URLs. */
export function isAllowedNoteUri(url: string, defaultValidate: (value: string) => boolean): boolean {
  if (isInternalNoteHref(url)) return true;
  return defaultValidate(url);
}

function marksAt(view: EditorView, pos: number) {
  if (pos < 0 || pos > view.state.doc.content.size) return [];
  return view.state.doc.resolve(pos).marks();
}

function pathFromMarks(marks: ReturnType<typeof marksAt>): string | null {
  for (const mark of marks) {
    if (mark.type.name === "wikiLink" && mark.attrs.path) return mark.attrs.path as string;
    const href = mark.attrs.href as string | undefined;
    if (mark.type.name === "link" && href && isInternalNoteHref(href)) return notePathFromHref(href);
  }
  return null;
}

/** Resolve a note path from a click in the TipTap editor DOM or document marks. */
export function internalPathFromClick(view: EditorView, event: MouseEvent, pos: number): string | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;

  const wiki = target.closest("a[data-wiki-link]");
  if (wiki) {
    const path = wiki.getAttribute("data-path");
    if (path) return path;
  }

  const anchor = target.closest("a");
  if (anchor) {
    const href = anchor.getAttribute("href");
    if (href && isInternalNoteHref(href)) return notePathFromHref(href);
  }

  for (const offset of [0, -1, 1]) {
    const fromMarks = pathFromMarks(marksAt(view, pos + offset));
    if (fromMarks) return fromMarks;
  }

  return null;
}

export function handleInternalLinkClick(
  view: EditorView,
  event: MouseEvent,
  pos: number,
  onOpen: (path: string) => void,
): boolean {
  if (event.button !== 0) return false;
  const path = internalPathFromClick(view, event, pos);
  if (!path) return false;
  event.preventDefault();
  onOpen(path);
  return true;
}

/** Capture-phase handler for read-only markdown (`<a href>` that isn't a button yet). */
export function handleReadOnlyLinkClick(event: { target: EventTarget | null; preventDefault(): void }, onOpen: (path: string) => void): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const anchor = target.closest("a[href]");
  if (!anchor) return false;
  const href = anchor.getAttribute("href");
  if (!href || !isInternalNoteHref(href)) return false;
  event.preventDefault();
  onOpen(notePathFromHref(href));
  return true;
}
