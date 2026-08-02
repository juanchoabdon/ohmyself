import { Mark, mergeAttributes } from "@tiptap/core";

export interface WikiLinkOptions {
  HTMLAttributes: Record<string, string>;
}

/** Inline wiki link mark — serializes as `[[path]]` or `[[path|label]]`. */
export const WikiLink = Mark.create<WikiLinkOptions>({
  name: "wikiLink",
  priority: 1100,
  keepOnSplit: false,
  inclusive: false,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      path: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-path"),
        renderHTML: (attrs) => (attrs.path ? { "data-path": attrs.path } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "a[data-wiki-link]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "a",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-wiki-link": "",
        class: "oms-wiki-link",
      }),
      0,
    ];
  },

  markdownTokenizer: {
    name: "wikiLink",
    level: "inline",
    start: (src) => src.indexOf("[["),
    tokenize(src) {
      const match = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(src);
      if (!match) return undefined;
      const path = match[1]!.trim();
      const label = (match[2]?.trim() || path).trim();
      return { type: "wikiLink", raw: match[0], path, text: label };
    },
  },

  parseMarkdown: (token, helpers) => {
    return helpers.applyMark(
      "wikiLink",
      [{ type: "text", text: token.text as string }],
      { path: token.path as string },
    );
  },

  renderMarkdown: (node, h) => {
    const path = (node.attrs?.path as string) ?? "";
    const text = h.renderChildren(node);
    if (!path) return text;
    if (text && text !== path) return `[[${path}|${text}]]`;
    return `[[${path}]]`;
  },
});
