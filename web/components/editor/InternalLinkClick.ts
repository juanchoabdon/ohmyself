import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { handleInternalLinkClick } from "./internalLinkNavigation";

export interface InternalLinkClickOptions {
  onOpenLink?: (path: string) => void;
}

/**
 * Opens wiki links and internal markdown links on click in the TipTap editor.
 * Falls back to ProseMirror marks when TipTap strips relative hrefs from the DOM.
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
          handleClick(view, pos, event) {
            if (!(event instanceof MouseEvent)) return false;
            return handleInternalLinkClick(view, event, pos, onOpen);
          },
        },
      }),
    ];
  },
});
