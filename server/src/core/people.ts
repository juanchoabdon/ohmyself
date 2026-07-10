import type { Brain } from "./brain.js";
import { slugify } from "./brain.js";
import type { UserConfig } from "./config.js";
import type { Visibility } from "./types.js";

export interface UpsertPersonInput {
  name: string;
  /** e.g. friend, cofounder, sister — rendered as a leading blockquote. */
  relationship?: string;
  /** Free-form markdown notes about them. */
  notes?: string;
  append?: boolean;
  visibility?: Visibility;
  tags?: string[];
}

export interface PersonWriteResult {
  ok: true;
  path: string;
  created: boolean;
  visibility: Visibility;
}

/** Path to a person's page. */
export function personPath(name: string): string {
  return `people/${slugify(name)}.md`;
}

/** Create or update a person note at people/<slug>.md. Shared by the MCP
 *  `add_person` tool and the ingest pipeline. */
export async function upsertPerson(
  brain: Brain,
  userId: string,
  config: UserConfig,
  allowed: Visibility[],
  input: UpsertPersonInput,
): Promise<PersonWriteResult> {
  const rel = input.relationship ? `> ${input.relationship}\n\n` : "";
  const body =
    input.notes !== undefined || input.relationship ? `${rel}${input.notes ?? ""}` : undefined;
  const { note, created } = await brain.upsertNote(
    userId,
    personPath(input.name),
    {
      type: "person",
      title: input.name,
      body,
      append: input.append,
      visibility: input.visibility,
      tags: input.tags,
    },
    config,
    allowed,
  );
  return { ok: true, path: note.path, created, visibility: note.meta.visibility };
}

/** Maintain a person's identity headline — a leading blockquote of
 *  "role · relationship" that the ingest pipeline keeps current (latest wins),
 *  above the accruing dated facts. No-op if there's nothing to set. */
export async function setPersonHeadline(
  brain: Brain,
  userId: string,
  config: UserConfig,
  allowed: Visibility[],
  name: string,
  opts: { role?: string; relationship?: string; visibility?: Visibility },
): Promise<void> {
  // Dedupe overlapping parts (the model sometimes echoes role into relationship).
  const parts: string[] = [];
  for (const raw of [opts.role, opts.relationship]) {
    const p = raw?.trim();
    if (!p) continue;
    const low = p.toLowerCase();
    if (parts.some((u) => u.toLowerCase().includes(low) || low.includes(u.toLowerCase()))) continue;
    parts.push(p);
  }
  if (!parts.length) return;
  const headline = `> ${parts.join(" · ")}`;
  const path = personPath(name);

  const existing = await brain.readNote(userId, path, allowed).catch(() => null);
  if (!existing) {
    await upsertPerson(brain, userId, config, allowed, {
      name,
      notes: headline,
      append: false,
      visibility: opts.visibility,
    });
    return;
  }

  // Non-destructive: if the note already opens with a blockquote (a curated or
  // previously-inferred identity line), respect it and don't clobber it. Only
  // add a headline when there's none yet.
  const lines = existing.body.split("\n");
  let start = 0;
  while (start < lines.length && lines[start]!.trim() === "") start++;
  if (lines[start]?.startsWith(">")) return;
  const rest = existing.body.replace(/^\s+/, "");
  const body = `${headline}${rest ? `\n\n${rest}` : ""}`.replace(/\s+$/, "") + "\n";
  await brain.updateNote(userId, path, { body }, allowed);
}

/** Append a dated fact bullet to a person's page (used by ingest to accrue
 *  durable facts learned from meetings). Creates the person if missing. */
export async function appendPersonFact(
  brain: Brain,
  userId: string,
  config: UserConfig,
  allowed: Visibility[],
  name: string,
  fact: string,
  opts?: { date?: string; sourceUrl?: string; visibility?: Visibility },
): Promise<PersonWriteResult> {
  const date = (opts?.date ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  const src = opts?.sourceUrl ? ` ([source](${opts.sourceUrl}))` : "";
  const bullet = `- [${date}] ${fact.trim()}${src}`;
  return upsertPerson(brain, userId, config, allowed, {
    name,
    notes: bullet,
    append: true,
    visibility: opts?.visibility,
  });
}
