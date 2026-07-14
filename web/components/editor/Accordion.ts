import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { parseFencedSections, renderFencedSections } from "./fencedBlock";
import { AccordionItemView, AccordionView } from "./AccordionView";

export const AccordionItem = Node.create({
  name: "accordionItem",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      title: {
        default: "Section",
        parseHTML: (el) => el.getAttribute("data-accordion-title") ?? "Section",
        renderHTML: (attrs) => ({ "data-accordion-title": attrs.title }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-oms-accordion-item=""]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-oms-accordion-item": "" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AccordionItemView);
  },

  renderMarkdown: (node, helpers) => {
    const title = (node.attrs?.title as string) || "Section";
    const body = helpers.renderChildren(node.content || []).trim();
    return `:::accordion-item ${title}\n${body}\n:::\n`;
  },
});

export const Accordion = Node.create({
  name: "accordion",
  group: "block",
  content: "accordionItem+",
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-oms-accordion=""]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-oms-accordion": "" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AccordionView);
  },

  markdownTokenizer: {
    name: "accordion",
    level: "block",
    start: (src) => src.indexOf(":::accordion"),
    tokenize(src, _tokens, lexer) {
      const match = /^:::accordion\n([\s\S]*?)\n:::\n?/.exec(src);
      if (!match) return undefined;
      const sections = parseFencedSections(match[1]!, "accordion-item", lexer);
      if (sections.length === 0) return undefined;
      return { type: "accordion", raw: match[0], sections };
    },
  },

  parseMarkdown: (token, helpers) => ({
    type: "accordion",
    content: (token.sections as Array<{ title: string; tokens: unknown[] }>).map((s) => ({
      type: "accordionItem",
      attrs: { title: s.title },
      content: helpers.parseChildren(s.tokens as Parameters<typeof helpers.parseChildren>[0]),
    })),
  }),

  renderMarkdown: (node, helpers) => {
    const sections = (node.content || []).map((child) => ({
      title: (child.attrs?.title as string) || "Section",
      body: helpers.renderChildren(child.content || []).trim(),
    }));
    return `:::accordion\n${renderFencedSections("accordion-item", sections)}:::\n\n`;
  },
});
