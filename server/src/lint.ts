/**
 * Wiki-lint — the third operation of Karpathy's LLM-Wiki pattern.
 *
 * Ingest appends cheaply and, over time, the wiki accrues duplicates,
 * near-duplicates and drift. Lint is the periodic, offline compaction pass: the
 * LLM re-reads the WIKI (never the raw sources — those are gone/immutable) and
 * consolidates it. Memory-consolidation-during-sleep for the system.
 *
 * Passes, grouped by safety:
 *   SAFE / additive (run always — never destroy a fact):
 *     - link hygiene: drop links to notes that no longer exist; add the obvious
 *       missing ones (an entity page that literally names another entity).
 *     - headline backfill: give people with no role headline an inferred one.
 *   DESTRUCTIVE / opinionated (only when LINT_APPLY=high, else proposed):
 *     - merge: fold duplicate person/concept pages into one.
 *     - concept cull: demote non-glossary "concepts" to plain notes (content
 *       preserved — nothing deleted).
 *     - rehome: move a misfiled `notes/` page to its real pillar
 *       (person/project/concept).
 *   REPORT-ONLY:
 *     - orphans/thin: flag pages with no links or almost no content.
 *
 * Everything (applied + proposed) is logged to a dated `lint/<date>.md` report.
 * Disable safe writes with LINT_SAFE=off (pure observation).
 */

import {
  allowedVisibilities,
  buildCore,
  getUserConfig,
  listActiveConnectionsForProvider,
  listConnections,
  personPath,
  projectIndexPath,
  setCommitmentOwner,
  setPersonHeadline,
  slugify,
  type Brain,
  type IndexedNote,
  type Note,
  type UserConfig,
  type Visibility,
} from "./core/index.js";
import { GOOGLE_DRIVE_MEETINGS_PROVIDER } from "./connectors/google-auth.js";
import { cosine, embeddingsEnabled, embedTexts } from "./core/embeddings.js";

const MIN_SIM = Number(process.env.LINT_MIN_SIM ?? "0.82") || 0.82;
const APPLY_CONF = Number(process.env.LINT_APPLY_CONF ?? "0.85") || 0.85;
const MAX_PAIRS = Number(process.env.LINT_MAX_PAIRS ?? "40") || 40;
const MAX_HEADLINES = Number(process.env.LINT_MAX_HEADLINES ?? "20") || 20;
const MAX_REHOME = Number(process.env.LINT_MAX_REHOME ?? "20") || 20;
/** Below this many chars of real body, a page is "thin" (report-only flag). */
const THIN_CHARS = 40;

const MODEL = () => process.env.OPENAI_MODEL || "gpt-4o-mini";
const apiKey = () => process.env.OPENAI_API_KEY ?? "";
const JUDGE_TIMEOUT_MS = 60000;

export type LintApplyMode = "propose" | "high";

export function scheduledApplyMode(): LintApplyMode {
  return process.env.LINT_APPLY === "high" ? "high" : "propose";
}
const safeWritesEnabled = () => process.env.LINT_SAFE !== "off";

export interface MergeOutcome {
  type: string;
  keep: string;
  drop: string;
  score: number;
  confidence: number;
  reason: string;
  applied: boolean;
}
export interface LinkFix {
  note: string;
  removed: string[];
  added: string[];
}
export interface CullOutcome {
  path: string;
  to?: string;
  reason: string;
  applied: boolean;
}
export interface HeadlineOutcome {
  path: string;
  headline: string;
  applied: boolean;
}
export interface RehomeOutcome {
  from: string;
  to: string;
  home: string;
  reason: string;
  applied: boolean;
}
export interface SelfFixOutcome {
  kind: "person-page" | "commitment";
  path: string;
  detail: string;
  applied: boolean;
}

export interface LintReport {
  ranAt: string;
  apply: LintApplyMode;
  pagesScanned: number;
  candidatesConsidered: number;
  merges: MergeOutcome[];
  links: LinkFix[];
  culled: CullOutcome[];
  headlines: HeadlineOutcome[];
  rehomed: RehomeOutcome[];
  selfFixes: SelfFixOutcome[];
  orphans: { path: string; why: string }[];
}

const today = () => new Date().toISOString().slice(0, 10);
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

/** Distinctive name tokens of a title (drop particles + very short tokens). */
const NAME_STOP = new Set(["de", "del", "la", "el", "los", "las", "van", "von", "da", "dos", "di", "y", "the"]);
function nameTokens(title: string): Set<string> {
  return new Set(
    norm(title)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2 && !NAME_STOP.has(t)),
  );
}
/** Name-overlap candidate score, independent of embeddings — catches
 *  "Amalia Arango" vs "Amalia Arango Cardenas" whose bodies (and thus vectors)
 *  diverge. Requires ≥2 shared distinctive tokens to avoid pairing mere
 *  first-name twins ("Laura Rico" vs "Laura Cruz"). The LLM judge is still the
 *  final gate. */
function nameCandidate(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  if (inter < 2) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  const subset = [...small].every((t) => big.has(t));
  return subset ? 0.9 : 0.83; // one name contains the other, else strong overlap
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Real body content sans the leading blockquote headline + markdown bullets. */
function contentLen(body: string): number {
  return body
    .split("\n")
    .filter((l) => !l.trim().startsWith(">"))
    .join(" ")
    .replace(/[#*_>\-\s]/g, "")
    .length;
}

// ── OpenAI helpers ──────────────────────────────────────────────────────────

async function chatJSON(system: string, user: string): Promise<unknown | null> {
  const key = apiKey();
  if (!key) return null;
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), JUDGE_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL(),
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: ac.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    return content ? JSON.parse(content) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

interface JudgeResult {
  same: boolean;
  confidence: number;
  canonicalTitle: string;
  mergedBody: string;
  reason: string;
}
export async function judgeMerge(
  type: string,
  a: { title: string; body: string },
  b: { title: string; body: string },
  nameHint?: string,
): Promise<JudgeResult | null> {
  const noun = type === "person" ? "person" : "concept/term";
  const system = [
    "You maintain a personal LLM-Wiki (Karpathy pattern). You are the LINT pass.",
    `Decide whether two ${noun} pages describe the SAME real-world ${noun} and`,
    "should be merged into one. same=true when they are literally the same",
    "(aliases, nicknames, spelling/casing/accent variants, first-name vs full or",
    "legal name of one individual; for concepts: the same term or an exact",
    "synonym/acronym). If merely related or broader/narrower, same=false.",
    ...(type === "person"
      ? [
          "",
          "CRITICAL for people: role/title/team/company lines on these pages are",
          "INFERRED from meetings and are NOISY — the same person is often described",
          "with different roles/pods across meetings. Differing or evolving inferred",
          "roles are NOT evidence of different people; do NOT reject a merge over them.",
          "When one name is a strict SUPERSET of the other (e.g. \"Ana Ruiz\" vs",
          "\"Ana Ruiz Díaz\") or a clear nickname/first-name variant, AND they",
          "plausibly operate in the same organization/context, treat them as the",
          "SAME person. Only answer same=false if there is a HARD disqualifier: an",
          "explicit statement they are different individuals, a different stated",
          "employer/company, a shared FIRST name but clearly different last names",
          "(twins, not a superset), or an explicit 'not to be confused with' note.",
        ]
      : []),
    "When same=true, produce the merged page: most complete canonical title, and",
    "mergedBody preserving EVERY durable fact from BOTH, de-duplicated and concise;",
    "keep a leading '>' headline if either has one (the most specific). Never invent.",
    "Return STRICT JSON {same:boolean, confidence:number, canonicalTitle:string, mergedBody:string, reason:string}.",
  ].join("\n");
  const user = [
    nameHint ? `NAME RELATIONSHIP: ${nameHint}` : "",
    `PAGE A — title: ${a.title}`,
    a.body.trim() || "(empty)",
    "",
    `PAGE B — title: ${b.title}`,
    b.body.trim() || "(empty)",
  ]
    .filter(Boolean)
    .join("\n");
  const parsed = (await chatJSON(system, user)) as Partial<JudgeResult> | null;
  if (!parsed || typeof parsed.same !== "boolean") return null;
  return {
    same: parsed.same,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0))),
    canonicalTitle: String(parsed.canonicalTitle ?? a.title),
    mergedBody: String(parsed.mergedBody ?? ""),
    reason: String(parsed.reason ?? ""),
  };
}

/** One batched call: which concept titles are NOT glossary-worthy headwords. */
async function classifyConcepts(titles: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>(); // title -> why-not-glossary
  if (!titles.length) return out;
  const system = [
    "You maintain a personal LLM-Wiki. A CONCEPT page must be a durable,",
    "glossary-worthy domain term: a named system/product/service, a metric/KPI, a",
    "technique/mechanism, an acronym, or a market/org term — a short NOUN HEADWORD",
    "you'd put in a glossary. NOT glossary-worthy: meeting topics, discussion",
    "points, decisions, opinions, tasks, feature ideas, or sentence/phrase",
    "fragments. Given a list of concept titles, return STRICT JSON",
    '{bad:[{title:string, reason:string}]} listing ONLY the ones that are NOT',
    "glossary-worthy headwords. Be strict but do not flag legitimate named terms.",
  ].join("\n");
  const user = titles.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const parsed = (await chatJSON(system, user)) as { bad?: { title: string; reason: string }[] } | null;
  for (const b of parsed?.bad ?? []) {
    if (b?.title) out.set(norm(b.title), b.reason || "not a glossary headword");
  }
  return out;
}

async function inferHeadline(page: Note): Promise<{ role: string; relationship: string } | null> {
  const system = [
    "You maintain a personal LLM-Wiki about its owner. Given a PERSON page,",
    "infer their `role` (function + team/area, add company if clear) and their",
    "`relationship` to the owner, from the facts on the page. Return STRICT JSON",
    "{role:string, relationship:string}. Leave a field empty ONLY if truly unknowable.",
  ].join("\n");
  const parsed = (await chatJSON(system, `title: ${page.meta.title}\n${page.body.trim()}`)) as {
    role?: string;
    relationship?: string;
  } | null;
  if (!parsed) return null;
  const role = String(parsed.role ?? "").trim();
  const relationship = String(parsed.relationship ?? "").trim();
  if (!role && !relationship) return null;
  return { role, relationship };
}

interface HomeResult {
  home: "person" | "project" | "concept" | "note";
  title: string;
  confidence: number;
  reason: string;
}
async function bestHome(page: Note): Promise<HomeResult | null> {
  const system = [
    "You maintain a personal LLM-Wiki with pillars: person, project, concept, note.",
    "Given a page currently filed under generic `notes/`, decide its BEST home.",
    "person = a page about an individual; project = an initiative/workstream;",
    "concept = a durable glossary term; note = anything else (keep as note).",
    "Only recommend moving off `note` when you're confident. Return STRICT JSON",
    "{home:'person'|'project'|'concept'|'note', title:string, confidence:number, reason:string}.",
  ].join("\n");
  const parsed = (await chatJSON(system, `title: ${page.meta.title}\n${page.body.trim()}`)) as Partial<HomeResult> | null;
  if (!parsed || !parsed.home) return null;
  return {
    home: (["person", "project", "concept", "note"].includes(parsed.home) ? parsed.home : "note") as HomeResult["home"],
    title: String(parsed.title ?? page.meta.title),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0))),
    reason: String(parsed.reason ?? ""),
  };
}

// ── Write helpers ───────────────────────────────────────────────────────────

/** Re-point every inbound link from `from` to `to` across the whole brain. */
async function repointLinks(
  brain: Brain,
  userId: string,
  allowed: Visibility[],
  from: string,
  to: string,
): Promise<void> {
  const all = await brain.listNotes(userId, { allowed, limit: 100000 });
  for (const n of all) {
    if (n.path === from || n.path === to || !n.links?.includes(from)) continue;
    const relinked = Array.from(new Set(n.links.map((l) => (l === from ? to : l)).filter((l) => l !== n.path)));
    await brain.updateNote(userId, n.path, { links: relinked }, allowed).catch(() => {});
  }
}

function homePath(home: HomeResult["home"], title: string): string {
  if (home === "person") return personPath(title);
  if (home === "project") return projectIndexPath(title);
  if (home === "concept") return `concepts/${slugify(title)}.md`;
  return `notes/${slugify(title)}.md`;
}

/** Move a note to a new pillar/type, collision-safe, re-pointing inbound links.
 *  Content-preserving: nothing is lost, the page just changes home/type. */
async function moveNoteTo(
  brain: Brain,
  userId: string,
  config: UserConfig,
  allowed: Visibility[],
  from: string,
  toType: string,
  toPath: string,
  extraTags: string[] = [],
): Promise<string> {
  const src = await brain.readNote(userId, from, allowed);
  let dest = toPath;
  if (dest !== from) {
    let i = 2;
    while (await brain.readNote(userId, dest, allowed).catch(() => null)) {
      dest = toPath.replace(/\.md$/, `-${i}.md`);
      if (++i > 9) break;
    }
  }
  await brain.upsertNote(
    userId,
    dest,
    {
      type: toType,
      title: src.meta.title,
      body: src.body,
      tags: Array.from(new Set([...src.meta.tags, ...extraTags])),
      links: src.meta.links,
      visibility: src.meta.visibility,
      extra: src.meta.extra,
    },
    config,
    allowed,
  );
  if (dest !== from) {
    await repointLinks(brain, userId, allowed, from, dest);
    await brain.deleteNote(userId, from, allowed);
  }
  return dest;
}

async function applyMerge(
  brain: Brain,
  userId: string,
  allowed: Visibility[],
  keepPath: string,
  dropPath: string,
  canonicalTitle: string,
  mergedBody: string,
): Promise<void> {
  const keep = await brain.readNote(userId, keepPath, allowed);
  const drop = await brain.readNote(userId, dropPath, allowed);
  const tags = Array.from(new Set([...keep.meta.tags, ...drop.meta.tags]));
  const links = Array.from(
    new Set([...keep.meta.links, ...drop.meta.links].filter((l) => l !== keepPath && l !== dropPath)),
  );
  await brain.updateNote(
    userId,
    keepPath,
    { title: canonicalTitle.trim() || keep.meta.title, body: mergedBody.trim() + "\n", tags, links },
    allowed,
  );
  await repointLinks(brain, userId, allowed, dropPath, keepPath);
  await brain.deleteNote(userId, dropPath, allowed);
}

// ── Passes ──────────────────────────────────────────────────────────────────

/** Load person/project/concept pages with bodies (bounded — a few hundred). */
async function loadEntities(brain: Brain, userId: string, allowed: Visibility[]): Promise<Note[]> {
  const idx = await brain.listNotes(userId, { types: ["person", "project", "concept"], allowed, limit: 5000 });
  const out: Note[] = [];
  for (const e of idx) {
    const n = await brain.readNote(userId, e.path, allowed).catch(() => null);
    if (n) out.push(n);
  }
  return out;
}

async function mergePass(
  brain: Brain,
  userId: string,
  allowed: Visibility[],
  apply: LintApplyMode,
  report: LintReport,
): Promise<void> {
  type Pair = { type: string; a: IndexedNote; b: IndexedNote; score: number };
  const pairs: Pair[] = [];
  for (const type of ["person", "concept"] as const) {
    const pages = await brain.listNotes(userId, { types: [type], allowed, limit: 5000, includeContent: true });
    report.pagesScanned += pages.length;
    if (pages.length < 2) continue;
    const vecs = await embedTexts(pages.map((p) => `${p.title}\n${p.excerpt ?? ""}`));
    const toks = pages.map((p) => nameTokens(p.title));
    for (let i = 0; i < pages.length; i++) {
      for (let j = i + 1; j < pages.length; j++) {
        const cos = vecs[i] && vecs[j] ? cosine(vecs[i]!, vecs[j]!) : 0;
        const name = nameCandidate(toks[i]!, toks[j]!);
        const score = Math.max(cos, name);
        // Candidate if semantically close OR a clear name variant.
        if (score >= MIN_SIM || name > 0) pairs.push({ type, a: pages[i]!, b: pages[j]!, score });
      }
    }
  }
  pairs.sort((x, y) => y.score - x.score);

  const gone = new Set<string>();
  let judged = 0;
  for (const p of pairs) {
    if (judged >= MAX_PAIRS) break;
    if (gone.has(p.a.path) || gone.has(p.b.path)) continue;
    report.candidatesConsidered++;
    judged++;
    let a: Note, b: Note;
    try {
      a = await brain.readNote(userId, p.a.path, allowed);
      b = await brain.readNote(userId, p.b.path, allowed);
    } catch {
      continue;
    }
    const ta = nameTokens(a.meta.title);
    const tb = nameTokens(b.meta.title);
    const aSub = [...ta].every((t) => tb.has(t));
    const bSub = [...tb].every((t) => ta.has(t));
    const nameHint =
      p.type === "person" && (aSub || bSub)
        ? `one name is a strict superset of the other ("${aSub ? a.meta.title : b.meta.title}" ⊂ "${aSub ? b.meta.title : a.meta.title}") — likely the same person's short vs fuller name.`
        : undefined;
    const v = await judgeMerge(
      p.type,
      { title: a.meta.title, body: a.body },
      { title: b.meta.title, body: b.body },
      nameHint,
    );
    if (!v || !v.same) continue;

    const ct = norm(v.canonicalTitle);
    let keepPath = p.a.path;
    let dropPath = p.b.path;
    if (ct && norm(b.meta.title) === ct && norm(a.meta.title) !== ct) {
      [keepPath, dropPath] = [p.b.path, p.a.path];
    } else if ((!ct || (norm(a.meta.title) !== ct && norm(b.meta.title) !== ct)) && b.body.length > a.body.length) {
      [keepPath, dropPath] = [p.b.path, p.a.path];
    }

    const willApply = apply === "high" && v.confidence >= APPLY_CONF;
    if (willApply) {
      try {
        await applyMerge(brain, userId, allowed, keepPath, dropPath, v.canonicalTitle, v.mergedBody);
        gone.add(dropPath);
      } catch (err) {
        report.merges.push({ type: p.type, keep: keepPath, drop: dropPath, score: +p.score.toFixed(3), confidence: v.confidence, reason: `apply failed: ${(err as Error).message}`, applied: false });
        continue;
      }
    }
    report.merges.push({ type: p.type, keep: keepPath, drop: dropPath, score: +p.score.toFixed(3), confidence: v.confidence, reason: v.reason, applied: willApply });
  }
}

/** Drop links to non-existent notes; add obvious missing entity↔entity links. */
async function linkPass(
  brain: Brain,
  userId: string,
  allowed: Visibility[],
  entities: Note[],
  report: LintReport,
): Promise<void> {
  const canWrite = safeWritesEnabled();
  const all = await brain.listNotes(userId, { allowed, limit: 100000 });
  const paths = new Set(all.map((n) => n.path));
  const byPath = new Map(entities.map((e) => [e.path, e]));

  // Precompute title matchers for entities with sufficiently distinctive names.
  const matchers = entities
    .filter((e) => e.meta.title.trim().length >= 5)
    .map((e) => ({ path: e.path, title: e.meta.title, re: new RegExp(`\\b${escapeRe(e.meta.title)}\\b`, "i") }));

  for (const n of all) {
    const removed = (n.links ?? []).filter((l) => !paths.has(l) && l !== n.path);
    let added: string[] = [];

    if (byPath.has(n.path)) {
      const e = byPath.get(n.path)!;
      const have = new Set(e.meta.links);
      for (const m of matchers) {
        if (added.length >= 5) break;
        if (m.path === n.path || have.has(m.path)) continue;
        if (m.re.test(e.body)) added.push(m.path);
      }
    }
    if (!removed.length && !added.length) continue;

    if (canWrite) {
      const next = Array.from(
        new Set([...(n.links ?? []).filter((l) => paths.has(l) && l !== n.path), ...added]),
      );
      await brain.updateNote(userId, n.path, { links: next }, allowed).catch(() => {});
      // Backlink the newly added targets.
      for (const t of added) {
        const tn = await brain.readNote(userId, t, allowed).catch(() => null);
        if (tn && !tn.meta.links.includes(n.path)) {
          await brain.updateNote(userId, t, { links: [...tn.meta.links, n.path] }, allowed).catch(() => {});
        }
      }
    }
    report.links.push({ note: n.path, removed, added });
  }
}

async function headlinePass(
  brain: Brain,
  userId: string,
  config: UserConfig,
  allowed: Visibility[],
  entities: Note[],
  report: LintReport,
): Promise<void> {
  const canWrite = safeWritesEnabled();
  const headless = entities.filter((e) => {
    if (e.meta.type !== "person") return false;
    const lines = e.body.split("\n");
    let i = 0;
    while (i < lines.length && lines[i]!.trim() === "") i++;
    return !lines[i]?.startsWith(">");
  });
  let done = 0;
  for (const p of headless) {
    if (done >= MAX_HEADLINES) break;
    const inf = await inferHeadline(p);
    if (!inf) continue;
    done++;
    const headline = [inf.role, inf.relationship].filter(Boolean).join(" · ");
    if (canWrite) {
      await setPersonHeadline(brain, userId, config, allowed, p.meta.title, {
        role: inf.role || undefined,
        relationship: inf.relationship || undefined,
        visibility: p.meta.visibility,
      }).catch(() => {});
    }
    report.headlines.push({ path: p.path, headline, applied: canWrite });
  }
}

async function conceptCullPass(
  brain: Brain,
  userId: string,
  config: UserConfig,
  allowed: Visibility[],
  entities: Note[],
  apply: LintApplyMode,
  report: LintReport,
): Promise<void> {
  const concepts = entities.filter(
    (e) => e.meta.type === "concept" && !e.meta.tags.includes("glossary-seed"),
  );
  if (!concepts.length) return;
  const bad = await classifyConcepts(concepts.map((c) => c.meta.title));
  for (const c of concepts) {
    const reason = bad.get(norm(c.meta.title));
    if (!reason) continue;
    let to: string | undefined;
    const willApply = apply === "high";
    if (willApply) {
      try {
        to = await moveNoteTo(brain, userId, config, allowed, c.path, "note", `notes/${slugify(c.meta.title)}.md`, ["archived-concept"]);
      } catch (err) {
        report.culled.push({ path: c.path, reason: `demote failed: ${(err as Error).message}`, applied: false });
        continue;
      }
    }
    report.culled.push({ path: c.path, to, reason, applied: willApply });
  }
}

async function rehomePass(
  brain: Brain,
  userId: string,
  config: UserConfig,
  allowed: Visibility[],
  apply: LintApplyMode,
  report: LintReport,
): Promise<void> {
  const notes = await brain.listNotes(userId, { types: ["note"], allowed, prefix: "notes/", limit: 5000 });
  let done = 0;
  for (const idx of notes) {
    if (done >= MAX_REHOME) break;
    const page = await brain.readNote(userId, idx.path, allowed).catch(() => null);
    if (!page) continue;
    if (contentLen(page.body) < 20) continue; // too thin to classify meaningfully
    done++;
    const h = await bestHome(page);
    if (!h || h.home === "note" || h.confidence < APPLY_CONF) continue;
    const to = homePath(h.home, h.title);
    if (to === page.path) continue;
    let applied = false;
    if (apply === "high") {
      try {
        await moveNoteTo(brain, userId, config, allowed, page.path, h.home, to);
        applied = true;
      } catch (err) {
        report.rehomed.push({ from: page.path, to, home: h.home, reason: `move failed: ${(err as Error).message}`, applied: false });
        continue;
      }
    }
    report.rehomed.push({ from: page.path, to, home: h.home, reason: h.reason, applied });
  }
}

/** Predicate: does a name/slug refer to the OWNER? Uses the connected account's
 *  name/email. Conservative: exact email/local-part, or ≥2 shared distinctive
 *  name tokens where the smaller set is fully contained in the larger. */
function buildOwnerMatcher(ownerNames: string[]): (candidate: string) => boolean {
  const emails = ownerNames.map((n) => norm(n)).filter((n) => n.includes("@"));
  const tokenSets = ownerNames.filter((n) => !n.includes("@")).map((n) => nameTokens(n));
  return (candidate: string) => {
    const c = norm(candidate);
    if (!c) return false;
    if (c === "me") return true;
    for (const e of emails) if (c === e || c === e.split("@")[0]) return true;
    const ct = nameTokens(candidate);
    if (ct.size === 0) return false;
    for (const owner of tokenSets) {
      if (owner.size === 0) continue;
      let inter = 0;
      for (const t of ct) if (owner.has(t)) inter++;
      if (inter >= 2 && inter === Math.min(ct.size, owner.size)) return true;
    }
    return false;
  };
}

/** Fix the "owner treated as another person" drift: delete self person-pages the
 *  ingester wrongly created, and re-attribute commitments owned by the owner (by
 *  name) back to "me". Person-page deletion is destructive → only when apply=high. */
async function ownerPass(
  brain: Brain,
  userId: string,
  allowed: Visibility[],
  apply: LintApplyMode,
  report: LintReport,
): Promise<void> {
  const conns = await listConnections(userId).catch(() => []);
  const ownerNames = Array.from(
    new Set(conns.flatMap((c) => [c.accountLabel, c.accountEmail]).map((s) => (s ?? "").trim()).filter(Boolean)),
  );
  if (!ownerNames.length) return;
  const isOwner = buildOwnerMatcher(ownerNames);

  // 1. Person pages that are actually the owner.
  const people = await brain.listNotes(userId, { types: ["person"], allowed, limit: 5000 });
  const selfPages = people.filter((p) => isOwner(p.title));
  for (const p of selfPages) {
    const willApply = apply === "high";
    if (willApply) {
      try {
        const all = await brain.listNotes(userId, { allowed, limit: 100000 });
        for (const n of all) {
          if (n.path !== p.path && n.links?.includes(p.path)) {
            await brain
              .updateNote(userId, n.path, { links: n.links.filter((l) => l !== p.path) }, allowed)
              .catch(() => {});
          }
        }
        await brain.deleteNote(userId, p.path, allowed);
      } catch (err) {
        report.selfFixes.push({ kind: "person-page", path: p.path, detail: `delete failed: ${(err as Error).message}`, applied: false });
        continue;
      }
    }
    report.selfFixes.push({
      kind: "person-page",
      path: p.path,
      detail: `owner's own page ("${p.title}") — ${willApply ? "deleted" : "would delete"}`,
      applied: willApply,
    });
  }

  // 2. Commitments the ingester attributed to the owner by name → "me". This is a
  //    metadata fix (nothing destroyed), so it runs whenever safe writes are on.
  const canWrite = safeWritesEnabled();
  const commits = await brain.listNotes(userId, { types: ["commitment"], allowed, limit: 5000 });
  let fixed = 0;
  for (const c of commits) {
    const tag = c.tags.find((t) => t.startsWith("owner:"))?.slice("owner:".length) ?? "";
    if (!tag || tag === "me") continue;
    if (!isOwner(tag.replace(/-/g, " "))) continue;
    if (fixed >= 300) break;
    fixed++;
    if (canWrite) await setCommitmentOwner(brain, userId, allowed, c.path, "me").catch(() => {});
    report.selfFixes.push({ kind: "commitment", path: c.path, detail: `owner "${tag}" → me`, applied: canWrite });
  }
}

function orphanPass(entities: Note[], report: LintReport): void {
  for (const e of entities) {
    const thin = contentLen(e.body) < THIN_CHARS;
    const orphan = (e.meta.links?.length ?? 0) === 0;
    if (thin || orphan) {
      report.orphans.push({ path: e.path, why: [orphan ? "no links" : "", thin ? "thin" : ""].filter(Boolean).join(" · ") });
    }
  }
}

// ── Orchestration ───────────────────────────────────────────────────────────

export async function runWikiLint(
  userId: string,
  opts: { apply?: LintApplyMode } = {},
): Promise<LintReport> {
  const apply = opts.apply ?? "propose";
  const { brain } = buildCore();
  const config = await getUserConfig(userId);
  const allowed = allowedVisibilities("secret");

  const report: LintReport = {
    ranAt: new Date().toISOString(),
    apply,
    pagesScanned: 0,
    candidatesConsidered: 0,
    merges: [],
    links: [],
    culled: [],
    headlines: [],
    rehomed: [],
    selfFixes: [],
    orphans: [],
  };
  if (!embeddingsEnabled()) return report;

  // Owner cleanup first (may delete self person-pages), then merge, then the rest.
  await ownerPass(brain, userId, allowed, apply, report);
  await mergePass(brain, userId, allowed, apply, report);
  const entities = await loadEntities(brain, userId, allowed);

  await linkPass(brain, userId, allowed, entities, report);
  await headlinePass(brain, userId, config, allowed, entities, report);
  await conceptCullPass(brain, userId, config, allowed, entities, apply, report);
  await rehomePass(brain, userId, config, allowed, apply, report);
  orphanPass(entities, report);

  await writeReport(brain, userId, config, allowed, report);
  return report;
}

async function writeReport(
  brain: Brain,
  userId: string,
  config: UserConfig,
  allowed: Visibility[],
  report: LintReport,
): Promise<void> {
  const mergeLine = (m: MergeOutcome) =>
    `- ${m.applied ? "✅" : "•"} **${m.keep}** ⟵ ${m.drop} · sim ${m.score} · conf ${m.confidence.toFixed(2)}${m.reason ? `\n  - ${m.reason}` : ""}`;
  const appliedM = report.merges.filter((m) => m.applied);
  const proposedM = report.merges.filter((m) => !m.applied);
  const linksWith = report.links.filter((l) => l.removed.length || l.added.length);

  const body = [
    `> Wiki-lint · ${report.apply === "high" ? "auto-apply high-confidence" : "propose-only"}`,
    "",
    `Scanned **${report.pagesScanned}** pages · **${report.candidatesConsidered}** merge candidates.`,
    "",
    `### Merges — applied ${appliedM.length}, proposed ${proposedM.length}`,
    report.merges.length ? report.merges.map(mergeLine).join("\n") : "_none_",
    "",
    `### Link hygiene (${linksWith.length})`,
    linksWith.length
      ? linksWith
          .map((l) => `- ${l.note}${l.removed.length ? ` · removed ${l.removed.length} dangling` : ""}${l.added.length ? ` · +${l.added.length} link(s)` : ""}`)
          .join("\n")
      : "_none_",
    "",
    `### Headlines backfilled (${report.headlines.length})`,
    report.headlines.length ? report.headlines.map((h) => `- ${h.applied ? "✅" : "•"} ${h.path} → _${h.headline}_`).join("\n") : "_none_",
    "",
    `### Concept cull (${report.culled.length})`,
    report.culled.length
      ? report.culled.map((c) => `- ${c.applied ? "✅ demoted" : "• would demote"} ${c.path}${c.to ? ` → ${c.to}` : ""} — ${c.reason}`).join("\n")
      : "_none_",
    "",
    `### Rehomed (${report.rehomed.length})`,
    report.rehomed.length
      ? report.rehomed.map((r) => `- ${r.applied ? "✅" : "•"} ${r.from} → **${r.home}** ${r.to} — ${r.reason}`).join("\n")
      : "_none_",
    "",
    `### Owner self-fixes (${report.selfFixes.length})`,
    report.selfFixes.length
      ? report.selfFixes.map((s) => `- ${s.applied ? "✅" : "•"} [${s.kind}] ${s.path} — ${s.detail}`).join("\n")
      : "_none_",
    "",
    `### Orphan / thin pages (${report.orphans.length}) — review`,
    report.orphans.length ? report.orphans.map((o) => `- ${o.path} · ${o.why}`).join("\n") : "_none_",
    report.apply !== "high" ? "\n_Set `LINT_APPLY=high` to auto-apply merges, culls and rehomes._" : "",
  ].join("\n");

  await brain.upsertNote(
    userId,
    `lint/${today()}.md`,
    { type: "note", title: `Wiki-lint · ${today()}`, body, tags: ["lint"], visibility: "secret", extra: { date: today() } },
    config,
    allowed,
  );
}

// ── Approve → apply (the human-in-the-loop hook, called from MCP) ────────────
//
// The scheduled lint auto-applies only high-confidence, mechanical fixes. The
// judgment calls (ambiguous merges, culls, rehomes) are proposed in the report;
// a client-side review skill lets JD approve them and calls back here so the
// destructive work always runs through the SAME tested, non-destructive path —
// never reimplemented by hand in a skill.

export interface ApplyLintResult {
  op: "merge" | "cull" | "rehome";
  applied: boolean;
  detail: string;
  to?: string;
  keep?: string;
  drop?: string;
}

/** Fetch the most recent (or a specific dated) lint report body. */
export async function getLintReport(
  userId: string,
  allowed: Visibility[],
  date?: string,
): Promise<{ found: boolean; path?: string; date?: string; body?: string }> {
  const { brain } = buildCore();
  let path = date ? `lint/${date}.md` : "";
  if (!path) {
    const rows = await brain.listNotes(userId, { prefix: "lint/", allowed, limit: 400 });
    if (!rows.length) return { found: false };
    rows.sort((a, b) => (a.path < b.path ? 1 : -1)); // YYYY-MM-DD sorts lexically → latest first
    path = rows[0]!.path;
  }
  const note = await brain.readNote(userId, path, allowed).catch(() => null);
  if (!note) return { found: false };
  return { found: true, path, date: path.slice(5, 15), body: note.body };
}

/** Apply one approved merge. The report only stores paths, so we re-judge the
 *  pair to regenerate the canonical title + merged body, then fold via the
 *  tested non-destructive path (facts preserved, inbound links repointed). */
export async function applyLintMerge(
  userId: string,
  keep: string,
  drop: string,
  allowed: Visibility[],
): Promise<ApplyLintResult> {
  const { brain } = buildCore();
  const a = await brain.readNote(userId, keep, allowed);
  const b = await brain.readNote(userId, drop, allowed);
  const type = a.meta.type === "concept" || b.meta.type === "concept" ? "concept" : "person";
  const v = await judgeMerge(type, { title: a.meta.title, body: a.body }, { title: b.meta.title, body: b.body });
  if (!v || !v.same) {
    return { op: "merge", applied: false, keep, drop, detail: v ? `re-judge says not the same: ${v.reason}` : "judge unavailable" };
  }
  await applyMerge(brain, userId, allowed, keep, drop, v.canonicalTitle, v.mergedBody);
  return { op: "merge", applied: true, keep, drop, detail: `${drop} folded into ${keep} (“${v.canonicalTitle}”)` };
}

/** Apply one approved concept cull: demote a non-glossary concept to a plain
 *  note. Content-preserving (nothing deleted; the page just changes pillar). */
export async function applyLintCull(userId: string, path: string, allowed: Visibility[]): Promise<ApplyLintResult> {
  const { brain } = buildCore();
  const config = await getUserConfig(userId);
  const page = await brain.readNote(userId, path, allowed);
  const to = await moveNoteTo(brain, userId, config, allowed, path, "note", `notes/${slugify(page.meta.title)}.md`, ["archived-concept"]);
  return { op: "cull", applied: true, to, detail: `demoted concept → ${to}` };
}

/** Apply one approved rehome: move a misfiled note to its real pillar. */
export async function applyLintRehome(
  userId: string,
  from: string,
  home: HomeResult["home"],
  allowed: Visibility[],
  title?: string,
): Promise<ApplyLintResult> {
  const { brain } = buildCore();
  const config = await getUserConfig(userId);
  const page = await brain.readNote(userId, from, allowed);
  const to = homePath(home, title ?? page.meta.title);
  const dest = await moveNoteTo(brain, userId, config, allowed, from, home, to);
  return { op: "rehome", applied: true, to: dest, detail: `moved ${from} → ${home} ${dest}` };
}

/** Daily entry point: lint every user with an active meetings connection, once
 *  per calendar day (guarded by today's report existing). */
export async function lintAllUsers(): Promise<{ linted: number }> {
  if (!embeddingsEnabled()) return { linted: 0 };
  const conns = await listActiveConnectionsForProvider(GOOGLE_DRIVE_MEETINGS_PROVIDER);
  const userIds = Array.from(new Set(conns.map((c) => c.userId)));
  const allowed = allowedVisibilities("secret");
  const apply = scheduledApplyMode();
  let linted = 0;
  for (const userId of userIds) {
    const { brain } = buildCore();
    const done = await brain.readNote(userId, `lint/${today()}.md`, allowed).catch(() => null);
    if (done) continue;
    try {
      await runWikiLint(userId, { apply });
      linted++;
    } catch (err) {
      console.error(`[lint] user ${userId} failed:`, (err as Error).message);
    }
  }
  return { linted };
}
