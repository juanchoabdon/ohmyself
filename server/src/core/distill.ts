/**
 * Distill: the LLM extraction step of the ingest pipeline.
 *
 * Given a raw meeting/transcript text and grounding context (known people,
 * projects, and open commitments), extract structured signal: summary,
 * insights, decisions, conceptual models, durable entity facts, action items,
 * project updates, and reconciliation (`resolves`) of prior open commitments.
 * The raw text is never persisted — only this distilled output is written.
 *
 * Two tiers:
 * - standard (mini, 48k chars): routine meetings — entity facts + tasks.
 * - rich (escalate, 200k chars): long/strategic sessions — full synthesis +
 *   coverage check + company-space routing hints.
 */

import { z } from "zod";
import { chatJSON, modelForTier } from "./llm.js";

const DISTILL_TIMEOUT_MS = 60000;
const RICH_DISTILL_TIMEOUT_MS = 120000;
const COVERAGE_TIMEOUT_MS = 45000;
/** Hard cap on characters sent to the standard model. */
const MAX_INPUT_CHARS = 48000;
/** Rich pass can use more context for long transcripts. */
const MAX_RICH_INPUT_CHARS = 200000;

export function distillEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY ?? "");
}

export type IngestKind = "meeting" | "workshop" | "note" | string;
export type IngestMode = "light" | "full";
export type DistillTier = "standard" | "rich";

export interface CompanySpaceHint {
  slug: string;
  name: string;
  /** One-line description to help routing (e.g. "AI-native messaging company"). */
  blurb?: string;
}

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
  /** Company spaces the owner belongs to — used for meeting routing. */
  companySpaces?: CompanySpaceHint[];
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

export const DecisionSchema = z.object({
  text: z.string(),
  status: z.enum(["decided", "exploratory"]),
});

export const ConceptualModelSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export const RoutingSchema = z.object({
  target_space: z.enum(["self", "company"]),
  company_slug: z.string().optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export const CoverageSchema = z.object({
  score: z.number().min(0).max(1),
  missing_topics: z.array(z.string()).default([]),
});

export const DistillResultSchema = z.object({
  title: z.string(),
  date: z.string().optional(),
  attendees: z.array(z.string()).default([]),
  summary: z.string().default(""),
  insights: z.array(z.string()).default([]),
  decisions: z.array(DecisionSchema).default([]),
  open_questions: z.array(z.string()).default([]),
  conceptual_models: z.array(ConceptualModelSchema).default([]),
  entity_updates: z.array(EntityUpdateSchema).default([]),
  action_items: z.array(ActionItemSchema).default([]),
  project_updates: z.array(ProjectUpdateSchema).default([]),
  resolves: z.array(ResolveSchema).default([]),
  suggested_links: z.array(SuggestedLinkSchema).default([]),
  is_noise: z.boolean().default(false),
  routing: RoutingSchema.optional(),
  coverage: CoverageSchema.optional(),
  /** Which tier produced the synthesis fields (insights/decisions/models). */
  distill_tier: z.enum(["standard", "rich"]).default("standard"),
});

export type DistillResult = z.infer<typeof DistillResultSchema>;
export type EntityUpdate = z.infer<typeof EntityUpdateSchema>;
export type ActionItem = z.infer<typeof ActionItemSchema>;
export type MeetingRouting = z.infer<typeof RoutingSchema>;
export type DistillCoverage = z.infer<typeof CoverageSchema>;

export interface DistillInput {
  rawText: string;
  kind: IngestKind;
  mode: IngestMode;
  title?: string;
  date?: string;
  grounding: GroundingContext;
  /** Force rich tier (eval / reprocess). */
  forceRich?: boolean;
}

/** Long or strategic meetings get the rich synthesis pass. */
export function shouldRichDistill(input: DistillInput): boolean {
  if (input.mode === "light") return false;
  if (input.forceRich) return true;
  if (input.rawText.length >= 25000) return true;
  const title = (input.title ?? "").toLowerCase();
  if (/\b(design|strategy|thesis|architecture|planning|review|wow|dw|workshop|offsite)\b/i.test(title)) {
    return true;
  }
  return false;
}

function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n\n[...truncated...]";
}

function kindHints(kind: IngestKind, mode: IngestMode, tier: DistillTier): string {
  const meeting =
    "This is a meeting transcript / meeting notes. Extract durable signal — not just a generic recap.";
  const light =
    " MODE=light (historical backfill): ONLY extract durable person facts and " +
    "reusable concepts. Do NOT extract action_items, project_updates, insights, " +
    "decisions, open_questions, or conceptual_models. Leave those arrays empty.";
  const full =
    " MODE=full: extract everything including action_items and project_updates.";
  const rich =
    tier === "rich"
      ? "\n\nRICH SYNTHESIS (required for this meeting): go beyond a generic summary.\n" +
        "- `summary`: 2-4 paragraphs capturing the arc of the conversation, not bullet fluff.\n" +
        "- `insights`: durable takeaways, thesis shifts, and 'aha' moments (each a complete sentence).\n" +
        "- `decisions`: explicit or strongly aligned choices. status=decided when committed; " +
        "status=exploratory when still being explored.\n" +
        "- `open_questions`: unresolved product/strategy questions worth revisiting.\n" +
        "- `conceptual_models`: named frameworks or interaction models discussed (e.g. " +
        "'three-surface model: human chat / private AI / shared multiplayer interface', " +
        "'relationship world', 'private intent → share → shared state → recall'). " +
        "Include models even if not labeled as such — infer the architecture the team is designing.\n" +
        "- Do NOT reduce the meeting to action items only — capture the thinking.\n" +
        "- `routing`: if COMPANY SPACES are listed below and the meeting content clearly " +
        "belongs to one company wiki (product/design/strategy for that company), set " +
        "target_space=company with the slug and confidence 0-1. Use self when personal/mixed " +
        "or confidence < 0.85. Never guess a company without clear signals."
      : "\n\nFor short routine meetings: insights/decisions/conceptual_models may be empty. " +
        "Still separate summary from action items.";
  const base = kind === "note" ? "This is a source document." : meeting;
  return base + (mode === "light" ? light : full + rich);
}

function buildPrompt(input: DistillInput, tier: DistillTier): { system: string; user: string } {
  const g = input.grounding;
  const system = [
    "You are the ingest engine of a personal LLM-Wiki (Karpathy pattern).",
    "You read a raw source and return STRICT JSON matching the provided schema.",
    "You never invent facts. Prefer matching mentions to KNOWN entities below",
    "(use their exact slug/name) instead of creating near-duplicates.",
    "Mark is_noise=true for pure status/logistics meetings with no durable signal.",
    kindHints(input.kind, input.mode, tier),
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
    ...(g.companySpaces?.length
      ? [
          "",
          "COMPANY SPACES (route meetings here when content is clearly about that company):",
          ...g.companySpaces.map(
            (s) => `  - slug=${s.slug} name=${s.name}${s.blurb ? ` — ${s.blurb}` : ""}`,
          ),
        ]
      : []),
    "Open commitments:",
    ...(g.openCommitments.length
      ? g.openCommitments.map((c) => `  - [${c.id}] ${c.text}`)
      : ["  (none)"]),
  ].join("\n");

  const maxChars = tier === "rich" ? MAX_RICH_INPUT_CHARS : MAX_INPUT_CHARS;
  const user = [
    input.title ? `Title: ${input.title}` : "",
    input.date ? `Date: ${input.date}` : "",
    "",
    "Source:",
    clipText(input.rawText, maxChars),
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}

const JSON_INSTRUCTIONS =
  'Return ONLY a JSON object with keys: title (string), date (string, ISO, optional), ' +
  "attendees (string[]), summary (string), insights (string[]), " +
  "decisions ({text, status:'decided'|'exploratory'})[], open_questions (string[]), " +
  "conceptual_models ({name, description})[], entity_updates " +
  "({entityType:'person'|'project'|'concept', slugOrName, fact, role?, relationship?})[], " +
  "action_items ({text, owner, due?, project?})[], " +
  "project_updates ({project, update})[], resolves ({item_id, reason})[], " +
  "suggested_links ({a, b})[], is_noise (boolean), " +
  "routing ({target_space:'self'|'company', company_slug?, confidence, reason}) optional.";

async function callDistillModel(
  system: string,
  user: string,
  tier: DistillTier,
): Promise<unknown | null> {
  return chatJSON({
    tier: tier === "rich" ? "escalate" : "route",
    system: `${system}\n\n${JSON_INSTRUCTIONS}`,
    user,
    timeoutMs: tier === "rich" ? RICH_DISTILL_TIMEOUT_MS : DISTILL_TIMEOUT_MS,
  });
}

/** Cheap second pass: did we miss major themes from the transcript? */
async function checkCoverage(
  rawText: string,
  result: DistillResult,
): Promise<DistillCoverage | null> {
  const excerpt = clipText(rawText, 12000);
  const distilled = [
    result.summary,
    ...result.insights,
    ...result.decisions.map((d) => d.text),
    ...result.conceptual_models.map((m) => `${m.name}: ${m.description}`),
    ...result.action_items.map((a) => a.text),
  ]
    .filter(Boolean)
    .join("\n");

  const system = [
    "You audit meeting distillation quality. Compare the transcript excerpt to the",
    "distilled note. Return JSON: score (0-1, how well major themes are captured),",
    "missing_topics (string[] of important themes/decisions/models in the source",
    "but absent or too thin in the distill). Be strict on strategic meetings —",
    "action items alone is NOT sufficient coverage.",
  ].join("\n");

  const user = [`TRANSCRIPT EXCERPT:\n${excerpt}`, "", `DISTILLED OUTPUT:\n${distilled.slice(0, 8000)}`].join(
    "\n",
  );

  const raw = await chatJSON<{ score?: number; missing_topics?: string[] }>({
    tier: "route",
    system,
    user,
    timeoutMs: COVERAGE_TIMEOUT_MS,
  });
  if (!raw || typeof raw.score !== "number") return null;
  const parsed = CoverageSchema.safeParse({
    score: raw.score,
    missing_topics: raw.missing_topics ?? [],
  });
  return parsed.success ? parsed.data : null;
}

/** Run distillation. Returns a validated DistillResult, or throws if the LLM
 *  is unavailable/misconfigured (callers decide how to surface that). */
export async function distill(input: DistillInput): Promise<DistillResult> {
  if (!distillEnabled()) {
    throw new Error("distill: OPENAI_API_KEY is not configured");
  }

  const tier: DistillTier = shouldRichDistill(input) ? "rich" : "standard";
  const { system, user } = buildPrompt(input, tier);
  const raw = await callDistillModel(system, user, tier);
  if (raw == null) throw new Error("distill: empty response from model");

  const parsed = DistillResultSchema.safeParse({ ...(raw as object), distill_tier: tier });
  if (!parsed.success) {
    throw new Error(`distill: response failed validation: ${parsed.error.message}`);
  }

  // In light mode, hard-drop ephemeral fields even if the model emitted them.
  if (input.mode === "light") {
    parsed.data.action_items = [];
    parsed.data.project_updates = [];
    parsed.data.insights = [];
    parsed.data.decisions = [];
    parsed.data.open_questions = [];
    parsed.data.conceptual_models = [];
    parsed.data.routing = undefined;
  }

  // Coverage check on rich passes (skip noise).
  if (tier === "rich" && !parsed.data.is_noise && input.mode === "full") {
    const coverage = await checkCoverage(input.rawText, parsed.data);
    if (coverage) parsed.data.coverage = coverage;
  }

  return parsed.data;
}

/** Expose model id used for a tier (eval scripts / logging). */
export function distillModelForTier(tier: DistillTier): string {
  return modelForTier(tier === "rich" ? "escalate" : "route");
}
