/**
 * research_brain — the deep retrieval path.
 *
 * Where `recall`/`search_brain` do ONE hybrid retrieval and hand back evidence,
 * research_brain runs a small bounded loop: an LLM planner decomposes the
 * question into sub-queries + entities, we retrieve for each (hybrid search),
 * optionally expand one hop through backlinks, read the top notes in full, and
 * an LLM synthesizes a cited answer. Everything is budget-capped so it can't run
 * away on cost/latency, and it degrades gracefully to plain retrieval when no
 * LLM is configured.
 *
 * Model routing (llm.ts): planning uses the cheap "route" tier; synthesis uses
 * "research"; a low-coverage answer can escalate once to "escalate".
 */

import type { Brain } from "./brain.js";
import { chatJSON, llmEnabled } from "./llm.js";
import type { HybridHit, IndexedNote, Visibility } from "./types.js";

export interface ResearchSource {
  path: string;
  title: string;
  type: string;
  visibility: Visibility;
  section?: string;
  score?: number;
  similarity?: number;
  match_reasons?: string[];
  excerpt?: string;
}

export interface ResearchResult {
  question: string;
  answer: string;
  coverage: "high" | "medium" | "low";
  sources: ResearchSource[];
  suggested_followups: string[];
  /** What the agent did — for transparency/debugging. */
  trace: {
    sub_queries: string[];
    searches: number;
    notes_read: number;
    escalated: boolean;
    llm: boolean;
  };
}

export interface ResearchOptions {
  /** Max distinct hybrid searches (planner sub-queries + original). Default 5. */
  maxSearches?: number;
  /** Max notes read in full for synthesis. Default 8. */
  maxReads?: number;
  /** Per-note body cap (chars) fed to the model. Default 4000. */
  perNoteChars?: number;
  /** Follow one hop of backlinks from the top hits. Default true. */
  expand?: boolean;
}

interface Plan {
  sub_queries: string[];
  entities: string[];
}

interface Synthesis {
  answer: string;
  used_paths: string[];
  coverage: "high" | "medium" | "low";
  followups: string[];
}

const DEFAULTS: Required<ResearchOptions> = {
  maxSearches: 5,
  maxReads: 8,
  perNoteChars: 4000,
  expand: true,
};

function toSource(h: IndexedNote & Partial<HybridHit>): ResearchSource {
  return {
    path: h.path,
    title: h.title,
    type: h.type,
    visibility: h.visibility,
    section: h.section,
    score: h.score,
    similarity: h.similarity,
    match_reasons: h.matchReasons,
    excerpt: h.excerpt,
  };
}

/** Ask the planner to decompose the question. Returns a safe fallback (the raw
 *  question as a single query) if the LLM is unavailable or misbehaves. */
async function plan(question: string, maxSearches: number): Promise<Plan> {
  const fallback: Plan = { sub_queries: [question], entities: [] };
  if (!llmEnabled()) return fallback;
  const system = [
    "You plan retrieval over a person's private second-brain (notes about their",
    "identity, people, projects, goals, decisions, journal).",
    "Decompose the user's question into focused search sub-queries that, together,",
    "would surface the evidence needed to answer it. Also list the named entities",
    "(people, projects, concepts) worth looking up directly.",
    `Return STRICT JSON: {"sub_queries": string[] (max ${maxSearches}, each a short`,
    'keyword-ish query, most important first), "entities": string[]}.',
    "Keep sub_queries diverse (don't just reword the question). If the question is",
    "simple, a single sub_query is fine.",
  ].join(" ");
  const out = await chatJSON<Plan>({ tier: "route", system, user: question, timeoutMs: 20000 });
  if (!out || !Array.isArray(out.sub_queries) || out.sub_queries.length === 0) return fallback;
  return {
    sub_queries: out.sub_queries.filter((s) => typeof s === "string" && s.trim()).slice(0, maxSearches),
    entities: Array.isArray(out.entities) ? out.entities.filter((s) => typeof s === "string").slice(0, 8) : [],
  };
}

async function synthesize(
  question: string,
  notes: { path: string; title: string; body: string }[],
  tier: "research" | "escalate",
): Promise<Synthesis | null> {
  if (!llmEnabled() || notes.length === 0) return null;
  const context = notes
    .map((n, i) => `[${i + 1}] ${n.title}\n(path: ${n.path})\n${n.body}`)
    .join("\n\n---\n\n");
  const system = [
    "You answer questions about the owner using ONLY the retrieved notes below.",
    "Write a direct, concrete answer in the owner's language (match the question's",
    "language). Cite the notes you used by their path. Never invent facts not in",
    "the notes; if the evidence is thin or missing, say so honestly.",
    'Return STRICT JSON: {"answer": string (markdown, may reference notes),',
    '"used_paths": string[] (paths you actually relied on), "coverage":',
    '"high"|"medium"|"low" (your confidence the notes fully answer it),',
    '"followups": string[] (0-3 next questions worth researching)}.',
  ].join(" ");
  const user = `QUESTION:\n${question}\n\nRETRIEVED NOTES:\n${context}`;
  const out = await chatJSON<Synthesis>({ tier, system, user, timeoutMs: 60000 });
  if (!out || typeof out.answer !== "string") return null;
  return {
    answer: out.answer,
    used_paths: Array.isArray(out.used_paths) ? out.used_paths : [],
    coverage: out.coverage === "high" || out.coverage === "low" ? out.coverage : "medium",
    followups: Array.isArray(out.followups) ? out.followups.filter((s) => typeof s === "string").slice(0, 3) : [],
  };
}

/** Run the bounded research loop. */
export async function researchBrain(
  brain: Brain,
  spaceId: string,
  question: string,
  allowed: Visibility[],
  options?: ResearchOptions,
): Promise<ResearchResult> {
  const opts = { ...DEFAULTS, ...(options ?? {}) };
  const q = question.trim();
  if (!q) {
    return {
      question,
      answer: "",
      coverage: "low",
      sources: [],
      suggested_followups: [],
      trace: { sub_queries: [], searches: 0, notes_read: 0, escalated: false, llm: llmEnabled() },
    };
  }

  // 1. Plan.
  const p = await plan(q, opts.maxSearches);
  const queries = Array.from(new Set([q, ...p.sub_queries])).slice(0, opts.maxSearches);

  // 2. Retrieve (hybrid) for each sub-query; merge, keeping the best hit per note.
  const byPath = new Map<string, IndexedNote & Partial<HybridHit>>();
  let searches = 0;
  const perQuery = Math.max(4, Math.ceil((opts.maxReads * 2) / queries.length));
  for (const query of queries) {
    searches++;
    const hits = (await brain.search(spaceId, query, { allowed, limit: perQuery })) as (IndexedNote &
      Partial<HybridHit>)[];
    for (const h of hits) {
      const prev = byPath.get(h.path);
      if (!prev || (h.score ?? 0) > (prev.score ?? 0)) byPath.set(h.path, h);
    }
  }

  // Look up named entities directly (their canonical page + backlinks).
  for (const name of p.entities.slice(0, 3)) {
    try {
      const { entity, mentions } = await brain.searchByEntity(spaceId, name, allowed, { limit: 4 });
      const extra = [
        ...(entity ? [{ path: entity.path, title: entity.title, type: entity.type } as IndexedNote] : []),
        ...mentions,
      ];
      for (const n of extra) if (!byPath.has(n.path)) byPath.set(n.path, n as IndexedNote & Partial<HybridHit>);
    } catch {
      /* entity lookups are best-effort */
    }
  }

  let ranked = [...byPath.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  // 3. Expand one hop: pull backlinks of the top hits (they often hold the "why").
  if (opts.expand && ranked.length) {
    for (const top of ranked.slice(0, 3)) {
      try {
        const bl = await brain.getBacklinks(spaceId, top.path, allowed, 5);
        for (const n of bl) if (!byPath.has(n.path)) byPath.set(n.path, n as IndexedNote & Partial<HybridHit>);
      } catch {
        /* best-effort */
      }
    }
    ranked = [...byPath.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  // 4. Read the top notes in full (bounded).
  const toRead = ranked.slice(0, opts.maxReads);
  const notes: { path: string; title: string; body: string }[] = [];
  for (const h of toRead) {
    try {
      const n = await brain.readNote(spaceId, h.path, allowed);
      const body = n.body.length > opts.perNoteChars ? `${n.body.slice(0, opts.perNoteChars)}\n[...]` : n.body;
      notes.push({ path: n.path, title: n.meta.title, body });
    } catch {
      /* skip unreadable */
    }
  }

  // 5. Synthesize (research tier), escalating once if coverage is low.
  let escalated = false;
  let synth = await synthesize(q, notes, "research");
  const escalateOn = process.env.OHMY_RESEARCH_ESCALATE === "on";
  if (escalateOn && synth && synth.coverage === "low" && notes.length > 0) {
    escalated = true;
    const retry = await synthesize(q, notes, "escalate");
    if (retry) synth = retry;
  }

  // Sources: prefer the notes the model cited, else the ranked evidence.
  const usedSet = new Set(synth?.used_paths ?? []);
  const sourcesRanked = ranked.map(toSource);
  const sources = usedSet.size
    ? [
        ...sourcesRanked.filter((s) => usedSet.has(s.path)),
        ...sourcesRanked.filter((s) => !usedSet.has(s.path)),
      ].slice(0, opts.maxReads)
    : sourcesRanked.slice(0, opts.maxReads);

  // Coverage: trust the model's self-assessment, else infer from retrieval
  // (calibrated like getContext: strong top-1 or a clear winner, not just a
  // spread of medium-similar notes).
  const sims = ranked.map((h) => h.similarity ?? 0).sort((a, b) => b - a);
  const top1 = sims[0] ?? 0;
  const margin = top1 - (sims[1] ?? 0);
  let coverage: "high" | "medium" | "low";
  if (synth) coverage = synth.coverage;
  else if (ranked.length === 0) coverage = "low";
  else if (top1 >= 0.6 || (top1 >= 0.5 && margin >= 0.08)) coverage = "high";
  else if (top1 >= 0.4 || ranked.length >= 3) coverage = "medium";
  else coverage = "low";

  const answer =
    synth?.answer ??
    (notes.length
      ? `No pude sintetizar con el modelo, pero encontré ${notes.length} nota(s) relevantes:\n\n` +
        notes.map((n) => `- **${n.title}** (${n.path})`).join("\n")
      : "No encontré nada en tu brain sobre esto.");

  return {
    question: q,
    answer,
    coverage,
    sources,
    suggested_followups: synth?.followups ?? [],
    trace: {
      sub_queries: queries,
      searches,
      notes_read: notes.length,
      escalated,
      llm: llmEnabled(),
    },
  };
}
