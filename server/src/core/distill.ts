/**
 * Distill: the LLM extraction step of the ingest pipeline.
 *
 * Given a raw meeting/transcript text and grounding context (known people,
 * projects, and open commitments), extract structured signal: a summary,
 * durable entity facts, action items, project updates, and reconciliation
 * (`resolves`) of prior open commitments. The raw text is never persisted —
 * only this distilled output is written to the wiki.
 *
 * Reuses the same OPENAI_API_KEY the embeddings module uses; no new provider.
 */

import { z } from "zod";

const MODEL = () => process.env.OPENAI_MODEL || "gpt-4o-mini";
const apiKey = () => process.env.OPENAI_API_KEY ?? "";
const DISTILL_TIMEOUT_MS = 60000;
/** Hard cap on characters sent to the model (protects cost + context window). */
const MAX_INPUT_CHARS = 48000;

export function distillEnabled(): boolean {
  return Boolean(apiKey());
}

export type IngestKind = "meeting" | "workshop" | "note" | string;
export type IngestMode = "light" | "full";

export interface GroundingContext {
  /** Who the wiki owner is (role, company, focus) — anchors role inference. */
  owner?: string;
  /** Names/emails the OWNER themselves appear as in transcripts (so the model
   *  treats them as "me", never as another person). */
  ownerNames?: string[];
  people: string[];
  projects: string[];
  /** "Name — one-line role/summary" for known people, to refine not repeat. */
  peopleContext?: string[];
  /** "Name — one-line summary" for known projects. */
  projectContext?: string[];
  /** Existing concept headwords (the glossary) — match these, don't duplicate. */
  concepts?: string[];
  openCommitments: { id: string; text: string }[];
}

export const EntityUpdateSchema = z.object({
  entityType: z.enum(["person", "project", "concept"]),
  slugOrName: z.string(),
  fact: z.string(),
  /** For people: inferred role/title + org/team (e.g. "Senior PM, Checkout @ Rappi"). */
  role: z.string().optional(),
  /** For people: relationship to the owner (e.g. "my counterpart on payments"). */
  relationship: z.string().optional(),
});

export const ActionItemSchema = z.object({
  text: z.string(),
  owner: z.string().describe('"me" or a person name/slug'),
  due: z.string().optional(),
  project: z.string().optional(),
});

export const ProjectUpdateSchema = z.object({
  project: z.string(),
  update: z.string(),
});

export const ResolveSchema = z.object({
  item_id: z.string(),
  reason: z.string(),
});

export const SuggestedLinkSchema = z.object({ a: z.string(), b: z.string() });

export const DistillResultSchema = z.object({
  title: z.string(),
  date: z.string().optional(),
  attendees: z.array(z.string()).default([]),
  summary: z.string().default(""),
  entity_updates: z.array(EntityUpdateSchema).default([]),
  action_items: z.array(ActionItemSchema).default([]),
  project_updates: z.array(ProjectUpdateSchema).default([]),
  resolves: z.array(ResolveSchema).default([]),
  suggested_links: z.array(SuggestedLinkSchema).default([]),
  is_noise: z.boolean().default(false),
});

export type DistillResult = z.infer<typeof DistillResultSchema>;
export type EntityUpdate = z.infer<typeof EntityUpdateSchema>;
export type ActionItem = z.infer<typeof ActionItemSchema>;

export interface DistillInput {
  rawText: string;
  kind: IngestKind;
  mode: IngestMode;
  title?: string;
  date?: string;
  grounding: GroundingContext;
}

function kindHints(kind: IngestKind, mode: IngestMode): string {
  const meeting =
    "This is a meeting transcript / meeting notes. Extract: a concise summary, " +
    "durable facts about PEOPLE (their POV, how they work, what they care about), " +
    "decisions and project status changes, and action items (who owns each: " +
    'use "me" for the note owner, otherwise the person\'s name).';
  const light =
    " MODE=light (historical backfill): ONLY extract durable person facts and " +
    "reusable concepts. Do NOT extract action_items or project_updates (that " +
    "context is stale). Leave those arrays empty.";
  const full =
    " MODE=full: extract everything including action_items and project_updates.";
  const base = kind === "note" ? "This is a source document." : meeting;
  return base + (mode === "light" ? light : full);
}

function buildPrompt(input: DistillInput): { system: string; user: string } {
  const g = input.grounding;
  const system = [
    "You are the ingest engine of a personal LLM-Wiki (Karpathy pattern).",
    "You read a raw source and return STRICT JSON matching the provided schema.",
    "You never invent facts. Prefer matching mentions to KNOWN entities below",
    "(use their exact slug/name) instead of creating near-duplicates.",
    "Mark is_noise=true for pure status/logistics meetings with no durable signal.",
    kindHints(input.kind, input.mode),
    "",
    "PEOPLE — for every person the source is about, first work out WHO THEY ARE,",
    "not just an insight. Set `role`: their function + team/area, INFERRED from",
    "what they discuss and the meeting topic even if not stated verbatim (e.g.",
    '"Backend engineer, Search", "PM, Cashback", "Data scientist, Consumer",',
    '"EM, Mobile platform"). Add the company (e.g. @ Rappi) when the OWNER CONTEXT',
    "and WHO'S WHO make it clear. Set `relationship`: how they relate to the owner",
    'when inferable (e.g. "eng counterpart on Search", "PM peer", "the owner\'s',
    'manager", "designer on the owner\'s pod"). Only leave `role` blank if you',
    "truly cannot even guess their function. Then put the durable facts (their POV,",
    "how they work, what they care about) in `fact`.",
    "",
    "CONCEPTS — a concept is a DURABLE, glossary-worthy domain term the owner will",
    "meet again across meetings: a named system/product/service, a metric or KPI,",
    "a technical mechanism or technique, an acronym, or a market/org term (e.g.",
    '"Semantic ID", "Server-Driven UI", "GMV", "User profiling (Galileo)", "SPI",',
    '"cohort retention"). The name must be a short NOUN HEADWORD you could put in a',
    "glossary — never a sentence or a topic. DO NOT create concepts for meeting",
    "topics, discussion points, decisions, opinions, tasks, feature ideas, or phrase",
    'fragments (bad: "Visibilidad de créditos", "Uso de fotos en instrucciones",',
    '"UX top-down con deep dive", "Separación de flujos", "Transparencia en',
    'búsqueda"). Be VERY conservative: most meetings introduce ZERO new concepts.',
    "Only add one if it is a real, reusable, named term AND it is not already in",
    "KNOWN CONCEPTS below — otherwise attach the fact to the existing concept",
    "(use its exact name) or omit it. When unsure, leave it out.",
    "",
    "For `resolves`: if the source clearly indicates an OPEN COMMITMENT below is",
    "done or superseded, add its id with a short reason.",
    "",
    "OWNER CONTEXT (who the wiki belongs to — use it to place people in the org):",
    g.owner?.trim() ? g.owner.trim() : "  (unknown)",
    ...(g.ownerNames?.length
      ? [
          "",
          "THE OWNER IS \"ME\". The owner attends these meetings and appears in the",
          "source (as an attendee/speaker) under these names/emails: " +
            g.ownerNames.join(", ") +
            ". When an attendee or speaker matches the owner, that is the OWNER = " +
            'self. NEVER emit a person entity_update for the owner, and NEVER create ' +
            "a person page for them. For any action item the owner is responsible " +
            'for, set owner="me" (never the owner\'s own name).',
        ]
      : []),
    "",
    "Known people (match to these exact names): " +
      (g.people.length ? g.people.join(", ") : "(none yet)"),
    ...(g.peopleContext?.length ? ["WHO'S WHO (current knowledge):", ...g.peopleContext.map((p) => `  - ${p}`)] : []),
    "Known projects: " + (g.projects.length ? g.projects.join(", ") : "(none yet)"),
    ...(g.projectContext?.length ? ["Project notes:", ...g.projectContext.map((p) => `  - ${p}`)] : []),
    "KNOWN CONCEPTS (the existing glossary — reuse these exact names, don't dupe): " +
      (g.concepts?.length ? g.concepts.join(", ") : "(none yet)"),
    "Open commitments:",
    ...(g.openCommitments.length
      ? g.openCommitments.map((c) => `  - [${c.id}] ${c.text}`)
      : ["  (none)"]),
  ].join("\n");

  const clipped =
    input.rawText.length > MAX_INPUT_CHARS
      ? input.rawText.slice(0, MAX_INPUT_CHARS) + "\n\n[...truncated...]"
      : input.rawText;

  const user = [
    input.title ? `Title: ${input.title}` : "",
    input.date ? `Date: ${input.date}` : "",
    "",
    "Source:",
    clipped,
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}

/** The JSON shape we ask the model to return (kept in sync with the schema). */
const JSON_INSTRUCTIONS =
  'Return ONLY a JSON object with keys: title (string), date (string, ISO, optional), ' +
  "attendees (string[]), summary (string), entity_updates " +
  "({entityType:'person'|'project'|'concept', slugOrName, fact, role?, relationship?})[], " +
  "action_items ({text, owner, due?, project?})[], " +
  "project_updates ({project, update})[], resolves ({item_id, reason})[], " +
  "suggested_links ({a, b})[], is_noise (boolean).";

async function callOpenAI(system: string, user: string): Promise<unknown | null> {
  const key = apiKey();
  if (!key) return null;
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), DISTILL_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL(),
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${system}\n\n${JSON_INSTRUCTIONS}` },
          { role: "user", content: user },
        ],
      }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    return JSON.parse(content);
  } finally {
    clearTimeout(to);
  }
}

/** Run distillation. Returns a validated DistillResult, or throws if the LLM
 *  is unavailable/misconfigured (callers decide how to surface that). */
export async function distill(input: DistillInput): Promise<DistillResult> {
  if (!distillEnabled()) {
    throw new Error("distill: OPENAI_API_KEY is not configured");
  }
  const { system, user } = buildPrompt(input);
  const raw = await callOpenAI(system, user);
  if (raw == null) throw new Error("distill: empty response from model");
  const parsed = DistillResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`distill: response failed validation: ${parsed.error.message}`);
  }
  // In light mode, hard-drop action items / project updates even if the model emitted them.
  if (input.mode === "light") {
    parsed.data.action_items = [];
    parsed.data.project_updates = [];
  }
  return parsed.data;
}
