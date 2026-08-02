import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { isInternalNoteHref, notePathFromHref } from "./wikiLinkMarkdown";

export interface InternalLinkClickOptions {
  onOpenLink?: (path: string) => void;
}

/**
 * Opens wiki links and internal markdown links on click in the TipTap editor.
 * Uses the DOM target — ProseMirror's position-based mark lookup misses clicks
 * on `<a>` boundaries when the wikiLink mark is non-inclusive.
 */
export const InternalLinkClick = Extension.create<InternalLinkClickOptions>({
  name: "internalLinkClick",
  priority: 1200,

  addOptions() {
    return { onOpenLink: undefined };
  },

  addProseMirrorPlugins() {
    const onOpen = this.options.onOpenLink;
    if (!onOpen) return [];

    return [
      new Plugin({
        props: {
          handleClick(_view, _pos, event) {
            if (!(event instanceof MouseEvent) || event.button !== 0) return false;
            const target = event.target;
            if (!(target instanceof Element)) return false;

            const wiki = target.closest("a[data-wiki-link]");
            if (wiki) {
              const path = wiki.getAttribute("data-path");
              if (path) {
                event.preventDefault();
                onOpen(path);
                return true;
              }
            }

            const anchor = target.closest("a[href]");
            if (!anchor) return false;
            const href = anchor.getAttribute("href");
            if (!href || !isInternalNoteHref(href)) return false;
            event.preventDefault();
            onOpen(notePathFromHref(href));
            return true;
          },
        },
      }),
    ];
  },
});
