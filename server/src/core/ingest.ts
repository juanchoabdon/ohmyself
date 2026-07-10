/**
 * Ingest: the orchestration step of the LLM-Wiki pipeline.
 *
 * Reads ONE raw source (a meeting transcript, workshop, pasted note) and
 * touches many wiki pages in a single pass: person facts, project updates,
 * concept notes, commitments, a short meeting note (with a link back to the
 * raw source), reconciliation of prior open commitments, and a log entry.
 *
 * The raw text is a parameter only — it is never written to the vault.
 */

import type { Brain } from "./brain.js";
import { slugify } from "./brain.js";
import type { UserConfig } from "./config.js";
import { addCommitment, listCommitments, setCommitmentStatus } from "./actions.js";
import {
  distill,
  distillEnabled,
  type DistillResult,
  type GroundingContext,
  type IngestKind,
  type IngestMode,
} from "./distill.js";
import { todayISO } from "./frontmatter.js";
import { appendPersonFact, personPath, setPersonHeadline } from "./people.js";
import { projectIndexPath, upsertProject } from "./projects.js";
import type { Visibility } from "./types.js";

export interface IngestInput {
  kind: IngestKind;
  rawText: string;
  title?: string;
  date?: string;
  sourceUrl?: string;
  mode?: IngestMode;
  visibility?: Visibility;
}

export interface IngestResult {
  ok: true;
  isNoise: boolean;
  meetingPath?: string;
  touched: string[];
  commitments: string[];
  resolved: string[];
  /** The distilled result, for callers that want to inspect/preview it. */
  distilled?: DistillResult;
}

export { distillEnabled };

/** Build grounding context so the model matches mentions to existing entities
 *  and can reconcile open commitments. */
/** First meaningful line of a note body/excerpt, cleaned of markdown noise. */
function firstLine(text: string | undefined, max = 140): string {
  if (!text) return "";
  const line = text
    .split("\n")
    .map((l) => l.replace(/^[>\-*#\s]+/, "").trim())
    .find((l) => l.length > 0);
  if (!line) return "";
  return line.length > max ? line.slice(0, max) + "…" : line;
}

async function buildGrounding(
  brain: Brain,
  userId: string,
  allowed: Visibility[],
): Promise<GroundingContext & { commitmentPathById: Map<string, string> }> {
  const [identity, people, projects, concepts, openCommitments] = await Promise.all([
    brain.listNotes(userId, { types: ["identity"], allowed, limit: 30 }),
    brain.listNotes(userId, { types: ["person"], allowed, limit: 500 }),
    brain.listNotes(userId, { types: ["project"], allowed, limit: 500 }),
    brain.listNotes(userId, { types: ["concept"], allowed, limit: 500 }),
    listCommitments(brain, userId, { status: "open", allowed, limit: 300 }),
  ]);

  // Owner identity: a compact "who I am" block so the model can place people in
  // the org relative to the owner. Capped to protect the context window.
  let owner = "";
  for (const n of identity) {
    const line = firstLine(n.excerpt, 220);
    if (!line) continue;
    owner += `  - ${n.title}: ${line}\n`;
    if (owner.length > 1600) break;
  }

  const commitmentPathById = new Map<string, string>();
  const openList = openCommitments.map((c) => {
    const id = slugify(c.title).slice(0, 40) || c.path;
    commitmentPathById.set(id, c.path);
    return { id, text: c.title };
  });

  // Who's-who / project context: the most-recently-touched entities with a
  // one-liner each, so the model refines existing knowledge instead of repeating.
  const peopleContext = people
    .slice(0, 60)
    .map((p) => `${p.title} — ${firstLine(p.excerpt) || "(no notes yet)"}`);
  const projectContext = projects
    .slice(0, 30)
    .map((p) => `${p.title} — ${firstLine(p.excerpt) || "(no notes yet)"}`);

  return {
    owner: owner.trim() || undefined,
    people: people.map((p) => p.title),
    projects: projects.map((p) => p.title),
    concepts: concepts.map((c) => c.title),
    peopleContext,
    projectContext,
    openCommitments: openList,
    commitmentPathById,
  };
}

function meetingPathFor(date: string, title: string): string {
  return `meetings/${date.slice(0, 10)}-${slugify(title).slice(0, 60)}.md`;
}

async function safeLink(brain: Brain, userId: string, a: string, b: string, allowed: Visibility[]) {
  try {
    await brain.linkNotes(userId, a, b, allowed);
  } catch {
    /* best-effort: skip links to notes that don't exist / aren't visible */
  }
}

/** Ingest a raw source into the wiki. `mode=light` (backfill) writes only
 *  person facts + concept notes; `mode=full` writes everything. */
export async function ingest(
  brain: Brain,
  userId: string,
  config: UserConfig,
  allowed: Visibility[],
  input: IngestInput,
): Promise<IngestResult> {
  const mode: IngestMode = input.mode ?? "full";
  const grounding = await buildGrounding(brain, userId, allowed);

  const distilled = await distill({
    rawText: input.rawText,
    kind: input.kind,
    mode,
    title: input.title,
    date: input.date,
    grounding,
  });

  const touched: string[] = [];
  const commitments: string[] = [];
  const resolved: string[] = [];
  const date = (distilled.date ?? input.date ?? todayISO()).slice(0, 10);
  const title = distilled.title || input.title || `${input.kind} ${date}`;
  const vis = input.visibility;
  // Deterministic meeting-note path (full mode only). Computed up front so
  // commitments can point their `source` at it before it's written below.
  const meetingPath = mode === "full" ? meetingPathFor(date, title) : undefined;

  if (distilled.is_noise) {
    await appendLog(brain, userId, config, allowed, date, title, ["noise — nothing written"]);
    return { ok: true, isNoise: true, touched: [], commitments: [], resolved: [], distilled };
  }

  // 1. Entity updates: person facts, project notes, concept notes.
  for (const u of distilled.entity_updates) {
    if (u.entityType === "person") {
      // Keep the person's identity headline (role · relationship) current, then
      // accrue the durable fact below it.
      if (u.role || u.relationship) {
        await setPersonHeadline(brain, userId, config, allowed, u.slugOrName, {
          role: u.role,
          relationship: u.relationship,
          visibility: vis,
        });
      }
      const r = await appendPersonFact(brain, userId, config, allowed, u.slugOrName, u.fact, {
        date,
        sourceUrl: input.sourceUrl,
        visibility: vis,
      });
      touched.push(r.path);
    } else if (u.entityType === "project") {
      // Backfill (light) only enriches projects that already exist; it never
      // spawns new project pages from stale mentions. Full mode creates freely.
      const r = await upsertProject(brain, userId, config, allowed, {
        name: u.slugOrName,
        summary: `- [${date}] ${u.fact}`,
        append: true,
        visibility: vis,
        createIfMissing: mode !== "light",
      });
      if (!r.skipped) touched.push(r.path);
    } else {
      const path = `concepts/${slugify(u.slugOrName)}.md`;
      const { note } = await brain.upsertNote(
        userId,
        path,
        {
          type: "concept",
          title: u.slugOrName,
          body: `- [${date}] ${u.fact}`,
          append: true,
          tags: ["concept"],
          visibility: vis,
        },
        config,
        allowed,
      );
      touched.push(note.path);
    }
  }

  // 2. Project status updates (full mode only; distill already clears these in light).
  for (const p of distilled.project_updates) {
    const r = await upsertProject(brain, userId, config, allowed, {
      name: p.project,
      summary: `- [${date}] ${p.update}`,
      append: true,
      visibility: vis,
    });
    touched.push(r.path);
  }

  // 3. Action items -> commitments (full mode only).
  for (const a of distilled.action_items) {
    const owner = a.owner.trim().toLowerCase() === "me" ? "me" : a.owner;
    const r = await addCommitment(brain, userId, config, allowed, {
      text: a.text,
      owner,
      due: a.due,
      date,
      source: meetingPath,
      sourceUrl: input.sourceUrl,
      visibility: vis,
    });
    commitments.push(r.path);
    touched.push(r.path);
  }

  // 4. Reconciliation: close open commitments the source marks as done.
  for (const r of distilled.resolves) {
    const path = grounding.commitmentPathById.get(r.item_id);
    if (!path) continue;
    try {
      await setCommitmentStatus(brain, userId, allowed, path, "resolved", { reason: r.reason });
      resolved.push(path);
    } catch {
      /* skip if the commitment disappeared */
    }
  }

  // 5. Meeting note (full mode only) with a link back to the raw source.
  if (mode === "full" && meetingPath) {
    const body = [
      distilled.attendees.length ? `- **Attendees:** ${distilled.attendees.join(", ")}` : null,
      input.sourceUrl ? `- **Source:** ${input.sourceUrl}` : null,
      "",
      distilled.summary,
    ]
      .filter((l) => l !== null)
      .join("\n");
    const { note } = await brain.upsertNote(
      userId,
      meetingPath,
      {
        type: "meeting",
        title,
        body,
        tags: ["meeting", input.kind],
        visibility: vis,
        extra: input.sourceUrl ? { source_url: input.sourceUrl, date } : { date },
      },
      config,
      allowed,
    );
    touched.push(note.path);

    // Link the meeting to the people/projects it touched.
    for (const u of distilled.entity_updates) {
      if (u.entityType === "person") {
        await safeLink(brain, userId, meetingPath, personPath(u.slugOrName), allowed);
      } else if (u.entityType === "project") {
        await safeLink(brain, userId, meetingPath, projectIndexPath(u.slugOrName), allowed);
      }
    }
    for (const p of distilled.project_updates) {
      await safeLink(brain, userId, meetingPath, projectIndexPath(p.project), allowed);
    }
  }

  // 6. Suggested links between existing notes (best-effort).
  for (const l of distilled.suggested_links) {
    await safeLink(brain, userId, l.a, l.b, allowed);
  }

  // 7. Log entry (Karpathy's greppable log).
  const summaryLine = `${touched.length} pages touched${
    resolved.length ? `, ${resolved.length} resolved` : ""
  }${meetingPath ? `, meeting=${meetingPath}` : ""}`;
  await appendLog(brain, userId, config, allowed, date, title, [summaryLine, ...touched.map((t) => `  - ${t}`)]);

  return { ok: true, isNoise: false, meetingPath, touched, commitments, resolved, distilled };
}

async function appendLog(
  brain: Brain,
  userId: string,
  config: UserConfig,
  allowed: Visibility[],
  date: string,
  title: string,
  lines: string[],
): Promise<void> {
  const body = [`## [${date}] ingest | ${title}`, ...lines].join("\n");
  try {
    await brain.upsertNote(
      userId,
      "memory/log.md",
      { type: "note", title: "Memory log", body, append: true },
      config,
      allowed,
    );
  } catch {
    /* logging must never break an ingest */
  }
}
