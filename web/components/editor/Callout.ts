import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { CalloutView } from "./CalloutView";

export type CalloutType = "info" | "warning" | "error" | "tip" | "note";

/** GitHub-style alert: `> [!info] Title` + quoted body lines → custom NodeView. */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      type: {
        default: "info",
        parseHTML: (el) => el.getAttribute("data-callout-type") ?? "info",
        renderHTML: (attrs) => ({ "data-callout-type": attrs.type }),
      },
      title: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-callout-title") ?? "",
        renderHTML: (attrs) =>
          attrs.title ? { "data-callout-title": attrs.title } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout=""]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-callout": "" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },

  markdownTokenizer: {
    name: "callout",
    level: "block",
    start: (src) => src.indexOf("> [!"),
    tokenize(src, _tokens, lexer) {
      const first = /^>\s*\[!(\w+)\]\s*(.*?)(?:\n|$)/.exec(src);
      if (!first) return undefined;

      const calloutType = first[1]!.toLowerCase();
      const title = first[2]!.trim();
      let rest = src.slice(first[0].length);
      const bodyLines: string[] = [];

      while (rest.startsWith(">")) {
        const line = /^>\s?(.*?)(?:\n|$)/.exec(rest);
        if (!line) break;
        bodyLines.push(line[1] ?? "");
        rest = rest.slice(line[0].length);
      }

      const raw = src.slice(0, src.length - rest.length);
      const bodyMd = bodyLines.join("\n").trim();

      return {
        type: "callout",
        raw,
        calloutType,
        title,
        tokens: bodyMd ? lexer.blockTokens(bodyMd) : [],
      };
    },
  },

  parseMarkdown: (token, helpers) => ({
    type: "callout",
    attrs: {
      type: (token.calloutType as string) || "info",
      title: (token.title as string) || "",
    },
    content: helpers.parseChildren(token.tokens || []),
  }),

  renderMarkdown: (node, helpers) => {
    const type = (node.attrs?.type as string) || "info";
    const title = (node.attrs?.title as string) || "";
    const inner = helpers.renderChildren(node.content || []).trim();
    const head = `> [!${type}]${title ? ` ${title}` : ""}`;
    if (!inner) return `${head}\n\n`;
    const quoted = inner
      .split("\n")
      .map((line) => (line.trim() ? `> ${line}` : ">"))
      .join("\n");
    return `${head}\n${quoted}\n\n`;
  },
});
