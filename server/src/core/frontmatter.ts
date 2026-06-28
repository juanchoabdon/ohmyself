import matter from "gray-matter";
import type { NoteMeta, Visibility } from "./types.js";

const KNOWN_KEYS = new Set([
  "id",
  "title",
  "type",
  "visibility",
  "tags",
  "links",
  "created",
  "updated",
]);

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string" && v.trim()) return [v];
  return [];
}

function asVisibility(v: unknown): Visibility {
  return v === "public" || v === "secret" ? v : "private";
}

function asDate(v: unknown): string | undefined {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

// YAML coerces unquoted date-like / numeric titles; coerce them back to text.
function asTitle(v: unknown, fallback: string): string {
  if (typeof v === "string" && v.trim()) return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return String(v);
  return fallback;
}

/** Parse raw markdown (with frontmatter) into structured metadata + body. */
export function parseNote(raw: string, fallbackTitle = "Untitled"): { meta: NoteMeta; body: string } {
  const { data, content } = matter(raw);
  const extra: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(data)) {
    if (!KNOWN_KEYS.has(k)) extra[k] = val;
  }
  const meta: NoteMeta = {
    id: typeof data.id === "string" ? data.id : undefined,
    title: asTitle(data.title, fallbackTitle),
    type: typeof data.type === "string" && data.type.trim() ? data.type : "note",
    visibility: asVisibility(data.visibility),
    tags: asStringArray(data.tags),
    links: asStringArray(data.links),
    created: asDate(data.created),
    updated: asDate(data.updated),
    extra: Object.keys(extra).length ? extra : undefined,
  };
  return { meta, body: content.replace(/^\n+/, "") };
}

/** Serialize metadata + body back into raw markdown with frontmatter. */
export function serializeNote(meta: NoteMeta, body: string): string {
  const fm: Record<string, unknown> = {};
  if (meta.id) fm.id = meta.id;
  fm.title = meta.title;
  fm.type = meta.type;
  fm.visibility = meta.visibility;
  fm.tags = meta.tags ?? [];
  if (meta.created) fm.created = meta.created;
  if (meta.updated) fm.updated = meta.updated;
  if (meta.links && meta.links.length) fm.links = meta.links;
  if (meta.extra) Object.assign(fm, meta.extra);
  // gray-matter stringify produces `---\n...\n---\n<body>`
  return matter.stringify(body.endsWith("\n") ? body : body + "\n", fm);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function excerptOf(body: string, max = 240): string {
  const text = body.replace(/[#>*_`\-]/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max) + "…" : text;
}
