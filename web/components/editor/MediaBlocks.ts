import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { parseFieldLines, renderFieldLines } from "./fencedBlock";
import { OmsEmbedView, OmsImageView, OmsVideoView } from "./MediaViews";

function fencedFieldTokenizer(name: string, fenceName: string) {
  return {
    name,
    level: "block" as const,
    start: (src: string) => src.indexOf(`:::${fenceName}`),
    tokenize(src: string) {
      const match = new RegExp(`^:::${fenceName}\\n([\\s\\S]*?)\\n:::\\n?`).exec(src);
      if (!match) return undefined;
      return {
        type: name,
        raw: match[0],
        fields: parseFieldLines(match[1]!),
      };
    },
  };
}

export const OmsImage = Node.create({
  name: "omsImage",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      src: { default: "" },
      alt: { default: "" },
      caption: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-oms-image=""]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["figure", mergeAttributes(HTMLAttributes, { "data-oms-image": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(OmsImageView);
  },

  markdownTokenizer: fencedFieldTokenizer("omsImage", "image"),

  parseMarkdown: (token) => ({
    type: "omsImage",
    attrs: {
      src: (token.fields as Record<string, string>).src ?? "",
      alt: (token.fields as Record<string, string>).alt ?? "",
      caption: (token.fields as Record<string, string>).caption ?? "",
    },
  }),

  renderMarkdown: (node) => {
    const body = renderFieldLines(
      {
        src: (node.attrs?.src as string) || "",
        alt: (node.attrs?.alt as string) || "",
        caption: (node.attrs?.caption as string) || "",
      },
      ["src", "alt", "caption"],
    );
    return `:::image\n${body}\n:::\n\n`;
  },
});

export const OmsVideo = Node.create({
  name: "omsVideo",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      src: { default: "" },
      title: { default: "Video" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-oms-video=""]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-oms-video": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(OmsVideoView);
  },

  markdownTokenizer: fencedFieldTokenizer("omsVideo", "video"),

  parseMarkdown: (token) => ({
    type: "omsVideo",
    attrs: {
      src: (token.fields as Record<string, string>).src ?? "",
      title: (token.fields as Record<string, string>).title ?? "Video",
    },
  }),

  renderMarkdown: (node) => {
    const body = renderFieldLines(
      {
        src: (node.attrs?.src as string) || "",
        title: (node.attrs?.title as string) || "Video",
      },
      ["src", "title"],
    );
    return `:::video\n${body}\n:::\n\n`;
  },
});

export const OmsEmbed = Node.create({
  name: "omsEmbed",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      url: { default: "" },
      title: { default: "Embed" },
      height: { default: 420 },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-oms-embed=""]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-oms-embed": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(OmsEmbedView);
  },

  markdownTokenizer: fencedFieldTokenizer("omsEmbed", "embed"),

  parseMarkdown: (token) => ({
    type: "omsEmbed",
    attrs: {
      url: (token.fields as Record<string, string>).url ?? "",
      title: (token.fields as Record<string, string>).title ?? "Embed",
      height: Number((token.fields as Record<string, string>).height) || 420,
    },
  }),

  renderMarkdown: (node) => {
    const body = renderFieldLines(
      {
        url: (node.attrs?.url as string) || "",
        title: (node.attrs?.title as string) || "Embed",
        height: String(node.attrs?.height ?? 420),
      },
      ["url", "title", "height"],
    );
    return `:::embed\n${body}\n:::\n\n`;
  },
});
