import { Node, mergeAttributes } from "@tiptap/core";
import CodeBlock from "@tiptap/extension-code-block";
import {
  findStandaloneFenceLine,
  parseFieldLines,
  parseNestedFencedContainer,
  renderFencedSections,
  renderFieldLines,
  type FencedField,
} from "./fencedBlock.js";

function fencedFieldTokenizer(name: string, fenceName: string) {
  return {
    name,
    level: "block" as const,
    start: (src: string) => src.indexOf(`:::${fenceName}`),
    tokenize(src: string) {
      const match = new RegExp(`^:::${fenceName}\\n([\\s\\S]*?)\\n:::\\n?`).exec(src);
      if (!match) return undefined;
      return { type: name, raw: match[0], fields: parseFieldLines(match[1]!) };
    },
  };
}

/** Markdown-only extensions aligned with web editor (no React NodeViews). */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      type: { default: "info" },
      title: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-callout=""]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-callout": "" }), 0];
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
    attrs: { type: (token.calloutType as string) || "info", title: (token.title as string) || "" },
    content: helpers.parseChildren(token.tokens || []),
  }),
  renderMarkdown: (node, helpers) => {
    const type = (node.attrs?.type as string) || "info";
    const title = (node.attrs?.title as string) || "";
    const inner = helpers.renderChildren(node.content || []).trim();
    const head = `> [!${type}]${title ? ` ${title}` : ""}`;
    if (!inner) return `${head}\n\n`;
    const quoted = inner.split("\n").map((line) => (line.trim() ? `> ${line}` : ">")).join("\n");
    return `${head}\n${quoted}\n\n`;
  },
});

export const Tab = Node.create({
  name: "tab",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { title: { default: "Tab" } };
  },
  parseHTML() {
    return [{ tag: 'div[data-oms-tab=""]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-oms-tab": "" }), 0];
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
  markdownTokenizer: {
    name: "tabs",
    level: "block",
    start: (src) => src.indexOf(":::tabs"),
    tokenize(src, _tokens, lexer) {
      const parsed = parseNestedFencedContainer(src, "tabs", "tab", lexer);
      if (!parsed) return undefined;
      return { type: "tabs", raw: parsed.raw, sections: parsed.sections };
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

export const AccordionItem = Node.create({
  name: "accordionItem",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { title: { default: "Section" } };
  },
  parseHTML() {
    return [{ tag: 'div[data-oms-accordion-item=""]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-oms-accordion-item": "" }), 0];
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
  markdownTokenizer: {
    name: "accordion",
    level: "block",
    start: (src) => src.indexOf(":::accordion"),
    tokenize(src, _tokens, lexer) {
      const parsed = parseNestedFencedContainer(src, "accordion", "accordion-item", lexer);
      if (!parsed) return undefined;
      return { type: "accordion", raw: parsed.raw, sections: parsed.sections };
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

function mediaNode(
  name: string,
  fence: string,
  attrs: string[],
  parseAttrs: (fields: FencedField) => Record<string, unknown>,
) {
  return Node.create({
    name,
    group: "block",
    atom: true,
    addAttributes() {
      return Object.fromEntries(attrs.map((a) => [a, { default: a === "height" ? 420 : "" }]));
    },
    parseHTML() {
      return [{ tag: `div[data-oms-${fence}=""]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { [`data-oms-${fence}`]: "" })];
    },
    markdownTokenizer: fencedFieldTokenizer(name, fence),
    parseMarkdown: (token) => ({ type: name, attrs: parseAttrs(token.fields as FencedField) }),
    renderMarkdown: (node) => {
      const fields = Object.fromEntries(
        attrs.map((a) => [a, String(node.attrs?.[a] ?? (a === "height" ? 420 : ""))]),
      );
      return `:::${fence}\n${renderFieldLines(fields, attrs)}\n:::\n\n`;
    },
  });
}

export const OmsImage = mediaNode("omsImage", "image", ["src", "alt", "caption"], (f) => ({
  src: f.src ?? "",
  alt: f.alt ?? "",
  caption: f.caption ?? "",
}));

export const OmsVideo = mediaNode("omsVideo", "video", ["src", "title"], (f) => ({
  src: f.src ?? "",
  title: f.title ?? "Video",
}));

export const OmsEmbed = mediaNode("omsEmbed", "embed", ["url", "title", "height"], (f) => ({
  url: f.url ?? "",
  title: f.title ?? "Embed",
  height: Number(f.height) || 420,
}));

export const OmsCodeBlock = CodeBlock.configure({
  HTMLAttributes: { class: "oms-code-block" },
});

export const richMarkdownExtensions = [
  OmsCodeBlock,
  Callout,
  Tabs,
  Tab,
  Accordion,
  AccordionItem,
  OmsImage,
  OmsVideo,
  OmsEmbed,
];
