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
import { getSpaceConfig } from "./config-store.js";
import { addCommitment, listCommitments, setCommitmentStatus } from "./actions.js";
import { listConnections } from "./connections.js";
import {
  distill,
  distillEnabled,
  type DistillResult,
  type GroundingContext,
  type IngestKind,
  type IngestMode,
  type MeetingRouting,
} from "./distill.js";
import { listSpacesForUser } from "./spaces.js";
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
  /** Space the meeting note was written to (may differ from connection space). */
  targetSpaceId?: string;
  routed?: boolean;
  routingReview?: boolean;
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
  const [identity, people, projects, concepts, openCommitments, connections, spaces] = await Promise.all([
    brain.listNotes(userId, { types: ["identity"], allowed, limit: 30 }),
    brain.listNotes(userId, { types: ["person"], allowed, limit: 500 }),
    brain.listNotes(userId, { types: ["project"], allowed, limit: 500 }),
    brain.listNotes(userId, { types: ["concept"], allowed, limit: 500 }),
    listCommitments(brain, userId, { status: "open", allowed, limit: 300 }),
    listConnections(userId).catch(() => []),
    listSpacesForUser(userId).catch(() => []),
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

  // The owner's own name(s)/email(s) — from the connected account(s) — so the
  // model (and the deterministic guard below) never mistake the owner for one
  // of the people they met with.
  const ownerNames = Array.from(
    new Set(
      connections
        .flatMap((c) => [c.accountLabel, c.accountEmail])
        .map((s) => (s ?? "").trim())
        .filter(Boolean),
    ),
  );

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

  const companySpaces = spaces
    .filter((s) => s.kind === "company" && s.slug)
    .map((s) => ({ slug: s.slug!, name: s.name }));

  return {
    owner: owner.trim() || undefined,
    ownerNames,
    people: people.map((p) => p.title),
    projects: projects.map((p) => p.title),
    concepts: concepts.map((c) => c.title),
    peopleContext,
    projectContext,
    openCommitments: openList,
    commitmentPathById,
    companySpaces: companySpaces.length ? companySpaces : undefined,
  };
}

const ROUTE_CONFIDENCE_AUTO = 0.85;
const ROUTE_CONFIDENCE_REVIEW = 0.5;

/** Resolve where the meeting note should land: self or a company space. */
async function resolveIngestTarget(
  ownerUserId: string,
  routing: MeetingRouting | undefined,
): Promise<{ spaceId: string; routed: boolean; routingReview: boolean }> {
  if (!routing || routing.target_space !== "company" || !routing.company_slug) {
    return { spaceId: ownerUserId, routed: false, routingReview: false };
  }
  if (routing.confidence < ROUTE_CONFIDENCE_REVIEW) {
    return { spaceId: ownerUserId, routed: false, routingReview: false };
  }
  const spaces = await listSpacesForUser(ownerUserId).catch(() => []);
  const company = spaces.find((s) => s.kind === "company" && s.slug === routing.company_slug);
  if (!company) {
    return { spaceId: ownerUserId, routed: false, routingReview: true };
  }
  if (routing.confidence >= ROUTE_CONFIDENCE_AUTO) {
    return { spaceId: company.id, routed: true, routingReview: false };
  }
  // Ambiguous — keep in self but flag for human review.
  return { spaceId: ownerUserId, routed: false, routingReview: true };
}

function formatMeetingBody(
  distilled: DistillResult,
  input: IngestInput,
  isOwner: (candidate: string) => boolean,
): string {
  const decisions = distilled.project_updates
    .map((p) => (p.project ? `- **${p.project}:** ${p.update}` : `- ${p.update}`))
    .filter(Boolean);
  const explicitDecisions = distilled.decisions.map((d) => {
    const tag = d.status === "decided" ? "decided" : "exploratory";
    return `- **[${tag}]** ${d.text}`;
  });
  const allDecisions = [...explicitDecisions, ...decisions];

  const actions = distilled.action_items.map((a) => {
    const owner = isOwner(a.owner) ? "Me" : a.owner.trim();
    const due = a.due ? ` _(due: ${a.due})_` : "";
    return `- **${owner}** — ${a.text}${due}`;
  });

  const models = distilled.conceptual_models.map(
    (m) => `### ${m.name}\n\n${m.description}`,
  );

  return [
    distilled.attendees.length ? `- **Attendees:** ${distilled.attendees.join(", ")}` : null,
    input.sourceUrl ? `- **Source:** ${input.sourceUrl}` : null,
    "",
    distilled.summary,
    distilled.insights.length
      ? `\n## Key insights\n${distilled.insights.map((i) => `- ${i}`).join("\n")}`
      : null,
    models.length ? `\n## Conceptual models\n${models.join("\n\n")}` : null,
    allDecisions.length ? `\n## Decisions\n${allDecisions.join("\n")}` : null,
    distilled.open_questions.length
      ? `\n## Open questions\n${distilled.open_questions.map((q) => `- ${q}`).join("\n")}`
      : null,
    actions.length ? `\n## Action items\n${actions.join("\n")}` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/** Normalize a name/email for owner matching: strip accents/punctuation, lowercase. */
function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Build a predicate that decides whether a name/slug refers to the OWNER, so we
 *  never spawn a person page for them and always attribute their tasks to "me".
 *  Conservative: matches an exact name/email, an email local-part, or a ≥2-token
 *  subset overlap (so "Juan Diego" ≈ "Juan Diego Sanchez" but bare "Juan" won't). */
function buildOwnerMatcher(ownerNames: string[]): (candidate: string) => boolean {
  const names = ownerNames.map(normName).filter(Boolean);
  const emails = names.filter((n) => n.includes("@"));
  const tokenSets = names.filter((n) => !n.includes("@")).map((n) => n.split(" ").filter(Boolean));
  return (candidate: string) => {
    const c = normName(candidate);
    if (!c) return false;
    if (c === "me") return true;
    if (names.includes(c)) return true;
    for (const e of emails) {
      if (c === e || c === e.split("@")[0]) return true;
    }
    const cTokens = c.split(" ").filter(Boolean);
    if (cTokens.length === 0) return false;
    const cSet = new Set(cTokens);
    for (const owner of tokenSets) {
      if (owner.length === 0) continue;
      const oSet = new Set(owner);
      const candSubset = cTokens.every((t) => oSet.has(t));
      const ownerSubset = owner.every((t) => cSet.has(t));
      if ((candSubset || ownerSubset) && Math.min(cTokens.length, owner.length) >= 2) return true;
    }
    return false;
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

  const { spaceId: targetSpaceId, routed, routingReview } = await resolveIngestTarget(
    userId,
    distilled.routing,
  );
  const writeConfig = routed ? await getSpaceConfig(targetSpaceId) : config;

  // Never treat the owner as one of the people they met with: drop any person
  // entity the model emitted for the owner, and re-attribute the owner's tasks
  // to "me" (belt-and-suspenders on top of the prompt instruction).
  const isOwner = buildOwnerMatcher(grounding.ownerNames ?? []);

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
      if (isOwner(u.slugOrName)) continue;
      if (u.role || u.relationship) {
        await setPersonHeadline(brain, targetSpaceId, writeConfig, allowed, u.slugOrName, {
          role: u.role,
          relationship: u.relationship,
          visibility: vis,
        });
      }
      const r = await appendPersonFact(brain, targetSpaceId, writeConfig, allowed, u.slugOrName, u.fact, {
        date,
        sourceUrl: input.sourceUrl,
        visibility: vis,
      });
      touched.push(r.path);
    } else if (u.entityType === "project") {
      const r = await upsertProject(brain, targetSpaceId, writeConfig, allowed, {
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
        targetSpaceId,
        path,
        {
          type: "concept",
          title: u.slugOrName,
          body: `- [${date}] ${u.fact}`,
          append: true,
          tags: ["concept"],
          visibility: vis,
        },
        writeConfig,
        allowed,
      );
      touched.push(note.path);
    }
  }

  // 2. Project status updates (full mode only; distill already clears these in light).
  for (const p of distilled.project_updates) {
    const r = await upsertProject(brain, targetSpaceId, writeConfig, allowed, {
      name: p.project,
      summary: `- [${date}] ${p.update}`,
      append: true,
      visibility: vis,
    });
    touched.push(r.path);
  }

  // 3. Action items -> commitments (full mode only).
  for (const a of distilled.action_items) {
    const owner = isOwner(a.owner) ? "me" : a.owner;
    const r = await addCommitment(brain, targetSpaceId, writeConfig, allowed, {
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
      await setCommitmentStatus(brain, targetSpaceId, allowed, path, "resolved", { reason: r.reason });
      resolved.push(path);
    } catch {
      /* skip if the commitment disappeared */
    }
  }

  // 5. Meeting note (full mode only) with a link back to the raw source.
  if (mode === "full" && meetingPath) {
    const body = formatMeetingBody(distilled, input, isOwner);
    const tags = ["meeting", input.kind];
    if (routingReview) tags.push("routing-review");
    const extra: Record<string, unknown> = { date };
    if (input.sourceUrl) extra.source_url = input.sourceUrl;
    if (distilled.distill_tier) extra.distill_tier = distilled.distill_tier;
    if (distilled.coverage) {
      extra.coverage_score = distilled.coverage.score;
      if (distilled.coverage.score < 0.7) extra.coverage_partial = true;
    }
    if (routed && distilled.routing?.company_slug) {
      extra.routed_space = distilled.routing.company_slug;
    } else if (routingReview && distilled.routing?.company_slug) {
      extra.suggested_space = distilled.routing.company_slug;
    }

    const { note } = await brain.upsertNote(
      targetSpaceId,
      meetingPath,
      {
        type: "meeting",
        title,
        body,
        tags,
        visibility: vis,
        extra,
      },
      writeConfig,
      allowed,
    );
    touched.push(note.path);

    for (const u of distilled.entity_updates) {
      if (u.entityType === "person") {
        if (isOwner(u.slugOrName)) continue;
        await safeLink(brain, targetSpaceId, meetingPath, personPath(u.slugOrName), allowed);
      } else if (u.entityType === "project") {
        await safeLink(brain, targetSpaceId, meetingPath, projectIndexPath(u.slugOrName), allowed);
      }
    }
    for (const p of distilled.project_updates) {
      await safeLink(brain, targetSpaceId, meetingPath, projectIndexPath(p.project), allowed);
    }
  }

  // 6. Suggested links between existing notes (best-effort).
  for (const l of distilled.suggested_links) {
    await safeLink(brain, targetSpaceId, l.a, l.b, allowed);
  }

  // 7. Log entry (Karpathy's greppable log) — always in the connection owner's space.
  const summaryLine = `${touched.length} pages touched${
    resolved.length ? `, ${resolved.length} resolved` : ""
  }${meetingPath ? `, meeting=${meetingPath}` : ""}${routed ? `, routed=${distilled.routing?.company_slug}` : ""}`;
  await appendLog(brain, userId, config, allowed, date, title, [summaryLine, ...touched.map((t) => `  - ${t}`)]);

  return {
    ok: true,
    isNoise: false,
    meetingPath,
    targetSpaceId,
    routed,
    routingReview,
    touched,
    commitments,
    resolved,
    distilled,
  };
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
