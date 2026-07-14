import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { parseFencedSections, renderFencedSections } from "./fencedBlock";
import { TabView, TabsView } from "./TabsView";

export const Tab = Node.create({
  name: "tab",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      title: {
        default: "Tab",
        parseHTML: (el) => el.getAttribute("data-tab-title") ?? "Tab",
        renderHTML: (attrs) => ({ "data-tab-title": attrs.title }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-oms-tab=""]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-oms-tab": "" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TabView);
  },

  renderMarkdown: (node, helpers) => {
    const title = (node.attrs?.title as string) || "Tab";
    const body = helpers.renderChildren(node.content || []).trim();
    return `:::tab ${title}\n${body}\n:::\n`;
  },
});

export const Tabs = Node.create({
  name: "tabs",
  group: "block",
  content: "tab+",
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-oms-tabs=""]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-oms-tabs": "" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TabsView);
  },

  markdownTokenizer: {
    name: "tabs",
    level: "block",
    start: (src) => src.indexOf(":::tabs"),
    tokenize(src, _tokens, lexer) {
      const match = /^:::tabs\n([\s\S]*?)\n:::\n?/.exec(src);
      if (!match) return undefined;
      const sections = parseFencedSections(match[1]!, "tab", lexer);
      if (sections.length === 0) return undefined;
      return {
        type: "tabs",
        raw: match[0],
        sections,
      };
    },
  },

  parseMarkdown: (token, helpers) => ({
    type: "tabs",
    content: (token.sections as Array<{ title: string; tokens: unknown[] }>).map((s) => ({
      type: "tab",
      attrs: { title: s.title },
      content: helpers.parseChildren(s.tokens as Parameters<typeof helpers.parseChildren>[0]),
    })),
  }),

  renderMarkdown: (node, helpers) => {
    const sections = (node.content || []).map((child) => ({
      title: (child.attrs?.title as string) || "Tab",
      body: helpers.renderChildren(child.content || []).trim(),
    }));
    return `:::tabs\n${renderFencedSections("tab", sections)}:::\n\n`;
  },
});
