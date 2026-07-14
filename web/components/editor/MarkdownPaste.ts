import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { looksLikeMarkdownPaste } from "./markdownRichContent";

/** Parse pasted markdown fragments into NodeViews instead of plain paragraphs. */
export const MarkdownPaste = Extension.create({
  name: "markdownPaste",

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          handlePaste(_view, event) {
            const text = event.clipboardData?.getData("text/plain");
            if (!text?.trim() || !looksLikeMarkdownPaste(text)) return false;
            event.preventDefault();
            return editor.commands.insertContent(text, { contentType: "markdown" });
          },
        },
      }),
    ];
  },
});
