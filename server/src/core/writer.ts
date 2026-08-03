/**
 * write_brain — the write router.
 *
 * One entry point for "save this to my brain" that figures out WHERE it belongs
 * (memory log, a person, a project, a goal period, a journal day, identity, or a
 * plain note), dedupes against what's already there, and routes to the right
 * structured write. The classification uses the cheap "route" model tier; if no
 * LLM is configured it falls back to a safe default (memory log) so a write is
 * never lost.
 *
 * Default is `apply: true` (JD's preference: capture durable info in the moment).
 * Pass `apply: false` to preview the routing + dedupe candidates without writing.
 */

import type { Brain } from "./brain.js";
import { slugify } from "./brain.js";
import { findType, folderForType, isPersonalBrain, type UserConfig } from "./config.js";
import { chatJSON, llmEnabled } from "./llm.js";
import { todayISO } from "./frontmatter.js";
import type { IndexedNote, Visibility } from "./types.js";
import type { WriteAttribution } from "./versions/types.js";

export type WriteCategory =
  | "memory"
  | "identity"
  | "person"
  | "project"
  | "goal"
  | "journal"
  | "note"
  /** A document filed under one of the space taxonomy's own types. */
  | "doc";

interface Classification {
  category: WriteCategory;
  /** Title/name/period depending on category. */
  title?: string;
  name?: string;
  period?: string;
  facet?: string;
  /** For `doc`: which note type of the space taxonomy this belongs to. */
  type?: string;
  visibility?: Visibility;
  tags?: string[];
  /** A short query to find possible existing duplicates. */
  dedupe_query?: string;
  reason?: string;
}

export interface WriteResult {
  applied: boolean;
  category: WriteCategory;
  path: string;
  operation: "append" | "upsert";
  created?: boolean;
  visibility: Visibility;
  reason?: string;
  /** Existing notes that look related (so callers can spot duplication). */
  related: { path: string; title: string; type: string; score?: number }[];
}

function goalPath(period: string): string {
  const p = period.trim().toLowerCase();
  const m = /^(\d{4})(?:[-_\s]?(q[1-4]|h[12]|\d{2}))?$/.exec(p);
  if (m) return `goals/${m[1]}/${m[2] ?? "yearly"}.md`;
  return `goals/${slugify(period)}.md`;
}

function clampVisibility(v: Visibility | undefined, allowed: Visibility[]): Visibility {
  if (v && allowed.includes(v)) return v;
  if (allowed.includes("private")) return "private";
  return allowed[0] ?? "private";
}

function brainCategories(): string[] {
  return [
    "You route a piece of content into a personal second-brain. Pick the ONE best",
    "destination category and extract the routing key.",
    "Categories:",
    '- "memory": a durable loose fact/preference/insight about the owner → memory log.',
    '- "identity": who the owner is (values, bio, health, role). Set `facet` if not the main page.',
    '- "person": a fact about another person. Set `name`.',
    '- "project": a project overview/status. Set `title` (the project name).',
    '- "goal": an objective for a period. Set `period` ("2026", "2026-q3", or "2026-06").',
    '- "journal": a reflection about how a day/moment went.',
    '- "note": anything else worth keeping. Set `title`.',
  ];
}

function wikiCategories(config: UserConfig): string[] {
  const types = config.noteTypes.filter((t) => t.folder !== "people").map((t) => `${t.id} (→ ${t.folder}/)`);
  return [
    "You file a piece of content into a COMPANY wiki. Pick the ONE best destination.",
    "Categories:",
    '- "person": a fact about a specific person (teammate, investor, candidate). Set `name`.',
    '- "doc": anything else. Set `type` to one of the wiki\'s document types below, and a',
    "  short `title` (max 6 words — it becomes the filename, so name the subject,",
    "  don't summarize the content).",
    `Document types: ${types.join(", ")}.`,
    "This wiki belongs to a company, not to a person: there is no memory log, no",
    "journal, no identity page and no `projects/` folder. A strategy, doctrine,",
    "plan or spec is a `doc` with the matching type — never a project.",
  ];
}

async function classify(
  content: string,
  hint: string | undefined,
  config: UserConfig,
): Promise<Classification> {
  const personal = isPersonalBrain(config);
  const fallback: Classification = personal
    ? { category: "memory", dedupe_query: content.slice(0, 120) }
    : { category: "doc", type: "note", dedupe_query: content.slice(0, 120) };
  if (!llmEnabled()) return fallback;
  const system = [
    ...(personal ? brainCategories() : wikiCategories(config)),
    "Set `visibility`: 'secret' for finances/health/sensitive, else 'private'.",
    "Set `dedupe_query`: a short query to find existing notes this might duplicate.",
    'Return STRICT JSON: {"category","title"?,"name"?,"period"?,"facet"?,"type"?,"visibility"?,"tags"?,"dedupe_query","reason"}.',
  ].join(" ");
  const user = hint ? `HINT: ${hint}\n\nCONTENT:\n${content}` : content;
  const out = await chatJSON<Classification>({ tier: "route", system, user, timeoutMs: 20000 });
  if (!out || !out.category) return fallback;
  return coerce(out, config, fallback);
}

/** Keep the model inside the space's taxonomy. A category whose pillar this
 *  space doesn't declare becomes a plain document — the destination is decided
 *  by the taxonomy, never by the model insisting. */
function coerce(c: Classification, config: UserConfig, fallback: Classification): Classification {
  const pillar: Partial<Record<WriteCategory, string>> = {
    memory: "identity",
    identity: "identity",
    person: "people",
    project: "projects",
    goal: "goals",
    journal: "journal",
    note: "notes",
  };
  const folder = pillar[c.category];
  if (folder && !config.noteTypes.some((t) => t.folder === folder)) {
    return { ...c, category: "doc", type: findType(config, c.type ?? "") ? c.type : "note" };
  }
  if (c.category === "doc" && !findType(config, c.type ?? "")) {
    return findType(config, "note") ? { ...c, type: "note" } : fallback;
  }
  return c;
}

/** Classify + (optionally) write. */
export async function writeBrain(
  brain: Brain,
  spaceId: string,
  content: string,
  config: UserConfig,
  allowed: Visibility[],
  options?: { hint?: string; apply?: boolean; visibility?: Visibility; attr?: WriteAttribution },
): Promise<WriteResult> {
  const text = content.trim();
  if (!text) throw new Error("write_brain: content is required");
  const apply = options?.apply ?? true;

  const c = await classify(text, options?.hint, config);
  const visibility = clampVisibility(options?.visibility ?? c.visibility, allowed);

  // Dedupe candidates (so callers/users can catch near-duplicates).
  let related: WriteResult["related"] = [];
  try {
    const hits = await brain.search(spaceId, c.dedupe_query || text.slice(0, 120), { allowed, limit: 5 });
    related = hits.map((h) => ({
      path: h.path,
      title: h.title,
      type: h.type,
      score: (h as IndexedNote & { score?: number }).score,
    }));
  } catch {
    /* dedupe is advisory */
  }

  // Resolve target path + operation.
  let path: string;
  let operation: "append" | "upsert" = "upsert";
  let type = "note";
  let append = false;
  let title = c.title?.trim() || text.slice(0, 60);
  let tags = c.tags ?? [];

  switch (c.category) {
    case "memory":
      path = "memory/log.md";
      type = "note";
      append = true;
      operation = "append";
      title = "Memory log";
      tags = ["memory", ...tags];
      break;
    case "identity":
      path = `identity/${c.facet ? slugify(c.facet) : "about-me"}.md`;
      type = "identity";
      append = true;
      operation = "append";
      title = c.facet || "About me";
      break;
    case "person":
      path = `people/${slugify(c.name || title)}.md`;
      type = "person";
      append = true;
      operation = "append";
      title = c.name || title;
      break;
    case "project":
      path = `projects/${slugify(title)}/_index.md`;
      type = "project";
      append = true;
      operation = "append";
      break;
    case "goal":
      path = goalPath(c.period || String(new Date().getFullYear()));
      type = "goal";
      append = true;
      operation = "append";
      title = `Goals ${c.period || new Date().getFullYear()}`;
      break;
    case "journal": {
      const day = todayISO().slice(0, 10);
      path = `journal/${day.slice(0, 4)}/${day}.md`;
      type = "journal";
      append = true;
      operation = "append";
      title = day;
      break;
    }
    case "doc":
      type = c.type ?? "note";
      path = `${folderForType(config, type)}/${slugify(title)}.md`;
      append = true;
      operation = "append";
      break;
    default:
      path = `notes/${slugify(title)}.md`;
      type = "note";
      break;
  }

  // Memory log entries are dated bullets; everything else keeps the raw content.
  const body =
    c.category === "memory"
      ? `- ${todayISO()} — ${text}${tags.length > 1 ? ` _(${tags.slice(1).map((t) => `#${t}`).join(" ")})_` : ""}`
      : text;

  if (!apply) {
    return {
      applied: false,
      category: c.category,
      path,
      operation,
      visibility,
      reason: c.reason,
      related,
    };
  }

  const { created } = await brain.upsertNote(
    spaceId,
    path,
    { type, title, body, append, visibility, tags: tags.length ? tags : undefined },
    config,
    allowed,
    options?.attr,
  );

  return {
    applied: true,
    category: c.category,
    path,
    operation,
    created,
    visibility,
    reason: c.reason,
    related,
  };
}
