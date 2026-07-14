/** Markdown starters agents and the slash menu can insert (Epic A4 / B3). */
export interface PaletteItem {
  id: string;
  label: string;
  description: string;
  /** Markdown snippet to insert at cursor. */
  markdown: string;
  tags: string[];
}

export interface PaletteComponentProp {
  name: string;
  type: string;
  required?: boolean;
  enum?: string[];
  description?: string;
}

export interface PaletteComponent {
  id: string;
  label: string;
  description: string;
  /** Markdown syntax the editor registry understands. */
  markdownSyntax: string;
  /** Example starter (same as palette item when applicable). */
  example: string;
  props: PaletteComponentProp[];
  tags: string[];
}

export interface PaletteTheme {
  cssVars: Record<string, string>;
  /** How to inject theme into HTML preview embeds. */
  htmlPreviewBridge: {
    postMessageType: "oms-html-preview:theme";
    resizeMessageType: "oms-html-preview:resize";
  };
}

export interface PaletteResponse {
  items: PaletteItem[];
  components?: PaletteComponent[];
  theme?: PaletteTheme;
}

export const PALETTE_THEME: PaletteTheme = {
  cssVars: {
    "--ink": "oklch(0.23 0.02 55)",
    "--muted": "oklch(0.53 0.025 55)",
    "--border": "oklch(0.92 0.008 70)",
    "--brand": "oklch(0.66 0.19 38)",
    "--surface": "oklch(1 0 0)",
  },
  htmlPreviewBridge: {
    postMessageType: "oms-html-preview:theme",
    resizeMessageType: "oms-html-preview:resize",
  },
};

export const PALETTE_ITEMS: PaletteItem[] = [
  {
    id: "callout-info",
    label: "Callout (info)",
    description: "Highlighted info block — renders as Callout NodeView in the editor",
    markdown: "> [!info] Title\n> Body text here.\n",
    tags: ["callout", "block"],
  },
  {
    id: "callout-warning",
    label: "Callout (warning)",
    description: "Warning / caution block",
    markdown: "> [!warning] Watch out\n> Explain the risk or constraint.\n",
    tags: ["callout", "block"],
  },
  {
    id: "mermaid",
    label: "Mermaid diagram",
    description: "Flow or architecture diagram — renders live in the editor",
    markdown: "```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```\n",
    tags: ["diagram", "mermaid"],
  },
  {
    id: "html-preview",
    label: "HTML preview",
    description: "Sandboxed interactive HTML block with theme tokens + postMessage resize bridge",
    markdown:
      '```html preview\n<div style="padding:1rem;border:1px solid var(--border);border-radius:8px;">\n  <p style="margin:0;color:var(--muted)">Hello from HTML</p>\n</div>\n```\n',
    tags: ["html", "embed"],
  },
  {
    id: "task-list",
    label: "Task list",
    description: "Checkbox tasks",
    markdown: "- [ ] First task\n- [ ] Second task\n",
    tags: ["tasks", "list"],
  },
  {
    id: "table",
    label: "Table",
    description: "Simple markdown table",
    markdown: "| Column A | Column B |\n| --- | --- |\n| | |\n",
    tags: ["table"],
  },
  {
    id: "wiki-link",
    label: "Wiki link",
    description: "Link to another note by path",
    markdown: "[[notes/example]]",
    tags: ["link", "wiki"],
  },
  {
    id: "tabs",
    label: "Tabs",
    description: "Tabbed sections with rich markdown per tab",
    markdown:
      ":::tabs\n:::tab Overview\nFirst tab content.\n:::\n:::tab Details\nSecond tab content.\n:::\n:::\n",
    tags: ["tabs", "layout"],
  },
  {
    id: "accordion",
    label: "Accordion",
    description: "Collapsible sections",
    markdown:
      ":::accordion\n:::accordion-item Section 1\nContent here.\n:::\n:::accordion-item Section 2\nMore content.\n:::\n:::\n",
    tags: ["accordion", "layout"],
  },
  {
    id: "image",
    label: "Image (zoom)",
    description: "Image with caption and click-to-zoom",
    markdown:
      ":::image\nsrc: https://example.com/image.png\nalt: Description\ncaption: Optional caption\n:::\n",
    tags: ["image", "media"],
  },
  {
    id: "video",
    label: "Video",
    description: "YouTube or Vimeo embed",
    markdown:
      ":::video\nsrc: https://www.youtube.com/watch?v=VIDEO_ID\ntitle: Video title\n:::\n",
    tags: ["video", "media"],
  },
  {
    id: "embed",
    label: "Embed",
    description: "Generic iframe embed (Figma, Loom, etc.)",
    markdown: ":::embed\nurl: https://example.com/embed\ntitle: Embed\nheight: 420\n:::\n",
    tags: ["embed", "iframe"],
  },
];

export const PALETTE_COMPONENTS: PaletteComponent[] = [
  {
    id: "callout",
    label: "Callout",
    description: "GitHub-style alert block with icon, title, and colored border",
    markdownSyntax: "> [!{type}] {title}\n> {body lines…}",
    example: "> [!info] Decision\n> Ship vault hydration before collab.\n",
    props: [
      { name: "type", type: "string", required: true, enum: ["info", "note", "tip", "warning", "error"] },
      { name: "title", type: "string", required: false, description: "Short heading on the first line" },
      { name: "body", type: "markdown", required: true, description: "Quoted lines after the header" },
    ],
    tags: ["callout", "block"],
  },
  {
    id: "mermaid",
    label: "Mermaid diagram",
    description: "Rendered flow/architecture diagram in a fenced code block",
    markdownSyntax: "```mermaid\n{diagram source}\n```",
    example: "```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```\n",
    props: [{ name: "source", type: "string", required: true, description: "Mermaid diagram DSL" }],
    tags: ["diagram", "mermaid"],
  },
  {
    id: "html-preview",
    label: "HTML preview",
    description: "Sandboxed iframe embed; use palette theme css vars (var(--brand), etc.)",
    markdownSyntax: '```html preview\n{html fragment}\n```',
    example:
      '```html preview\n<div style="padding:1rem">Hello</div>\n```\n',
    props: [
      { name: "html", type: "string", required: true, description: "HTML fragment injected into sandboxed iframe" },
    ],
    tags: ["html", "embed"],
  },
  {
    id: "wiki-link",
    label: "Wiki link",
    description: "Internal link to another note by vault path",
    markdownSyntax: "[[{path}]] or [[{path}|{label}]]",
    example: "[[projects/ohmyself/specs/example]]",
    props: [
      { name: "path", type: "string", required: true },
      { name: "label", type: "string", required: false },
    ],
    tags: ["link", "wiki"],
  },
  {
    id: "tabs",
    label: "Tabs",
    description: "Tabbed layout; each tab holds block markdown",
    markdownSyntax: ":::tabs\n:::tab {title}\n{body}\n:::\n:::\n",
    example:
      ":::tabs\n:::tab Overview\nSummary here.\n:::\n:::tab Spec\nDetails.\n:::\n:::\n",
    props: [
      { name: "tabs", type: "array", required: true, description: "Array of { title, body }" },
    ],
    tags: ["tabs", "layout"],
  },
  {
    id: "accordion",
    label: "Accordion",
    description: "Collapsible sections",
    markdownSyntax: ":::accordion\n:::accordion-item {title}\n{body}\n:::\n:::\n",
    example:
      ":::accordion\n:::accordion-item FAQ\nAnswer here.\n:::\n:::\n",
    props: [{ name: "items", type: "array", required: true, description: "Array of { title, body }" }],
    tags: ["accordion", "layout"],
  },
  {
    id: "image",
    label: "Image",
    description: "Image block with alt, caption, zoom on click",
    markdownSyntax: ":::image\nsrc: {url}\nalt: {text}\ncaption: {text}\n:::\n",
    example: ":::image\nsrc: https://example.com/diagram.png\nalt: Architecture\ncaption: System overview\n:::\n",
    props: [
      { name: "src", type: "string", required: true },
      { name: "alt", type: "string", required: false },
      { name: "caption", type: "string", required: false },
    ],
    tags: ["image", "media"],
  },
  {
    id: "video",
    label: "Video",
    description: "YouTube or Vimeo player embed",
    markdownSyntax: ":::video\nsrc: {youtube_or_vimeo_url}\ntitle: {text}\n:::\n",
    example: ":::video\nsrc: https://www.youtube.com/watch?v=xxx\ntitle: Demo walkthrough\n:::\n",
    props: [
      { name: "src", type: "string", required: true },
      { name: "title", type: "string", required: false },
    ],
    tags: ["video", "media"],
  },
  {
    id: "embed",
    label: "Embed",
    description: "Sandboxed iframe for external tools",
    markdownSyntax: ":::embed\nurl: {embed_url}\ntitle: {text}\nheight: {px}\n:::\n",
    example: ":::embed\nurl: https://www.figma.com/embed/...\ntitle: Design\nheight: 480\n:::\n",
    props: [
      { name: "url", type: "string", required: true },
      { name: "title", type: "string", required: false },
      { name: "height", type: "number", required: false },
    ],
    tags: ["embed", "iframe"],
  },
];

export function searchPalette(query?: string, limit = 20): PaletteItem[] {
  const q = query?.trim().toLowerCase();
  if (!q) return PALETTE_ITEMS.slice(0, limit);
  return PALETTE_ITEMS.filter(
    (item) =>
      item.id.includes(q) ||
      item.label.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.tags.some((t) => t.includes(q)),
  ).slice(0, limit);
}

export function searchPaletteComponents(query?: string, ids?: string[]): PaletteComponent[] {
  let list = PALETTE_COMPONENTS;
  if (ids?.length) {
    const want = new Set(ids.map((id) => id.toLowerCase()));
    list = list.filter((c) => want.has(c.id.toLowerCase()));
  }
  const q = query?.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (c) =>
      c.id.includes(q) ||
      c.label.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.tags.some((t) => t.includes(q)),
  );
}

export function buildPaletteResponse(opts?: {
  query?: string;
  limit?: number;
  components?: boolean | string[];
  includeTheme?: boolean;
}): PaletteResponse {
  const response: PaletteResponse = {
    items: searchPalette(opts?.query, opts?.limit ?? 20),
  };
  if (opts?.components) {
    const ids = Array.isArray(opts.components) ? opts.components : undefined;
    response.components = searchPaletteComponents(opts.query, ids);
  }
  if (opts?.includeTheme !== false && opts?.components) {
    response.theme = PALETTE_THEME;
  }
  return response;
}
