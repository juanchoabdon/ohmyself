/** Markdown starters agents and the slash menu can insert (Epic B3 / A3). */
export interface PaletteItem {
  id: string;
  label: string;
  description: string;
  /** Markdown snippet to insert at cursor. */
  markdown: string;
  tags: string[];
}

export const PALETTE_ITEMS: PaletteItem[] = [
  {
    id: "callout-info",
    label: "Callout (info)",
    description: "Highlighted info block",
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
    description: "Flow or architecture diagram",
    markdown: "```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```\n",
    tags: ["diagram", "mermaid"],
  },
  {
    id: "html-preview",
    label: "HTML preview",
    description: "Sandboxed interactive HTML block",
    markdown: '```html preview\n<div style="padding:1rem">\n  <p>Hello from HTML</p>\n</div>\n```\n',
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
