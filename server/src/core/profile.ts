/**
 * Person profiling — a synthesized "Read" of who a person is and how to work
 * with them, inferred from the dated facts accrued on their page. This is the
 * roll-up half of the LLM-Wiki: raw observations stay as the log; this distills
 * them into a durable, regenerable character/working-style read.
 *
 * The read is written between invisible markers right under the identity
 * headline, so it can be regenerated idempotently as new facts arrive without
 * clobbering the raw log below it.
 */
import type { Brain } from "./brain.js";
import { slugify } from "./brain.js";
import type { UserConfig } from "./config.js";
import { todayISO } from "./frontmatter.js";
import { personPath } from "./people.js";
import type { Visibility } from "./types.js";

const MODEL = () => process.env.OPENAI_MODEL || "gpt-4o-mini";
const apiKey = () => process.env.OPENAI_API_KEY ?? "";
const TIMEOUT_MS = 60000;
const MAX_INPUT_CHARS = 24000;

export const READ_START = "<!-- oms:read:start -->";
export const READ_END = "<!-- oms:read:end -->";

export interface ProfilePersonResult {
  ok: boolean;
  path: string;
  skipped?: "no-note" | "too-thin" | "up-to-date" | "no-llm";
  facts?: number;
}

/** Count dated fact bullets: lines like "- [2026-07-09] …". */
function countFacts(body: string): number {
  return (body.match(/^\s*-\s*\[\d{4}-\d{2}-\d{2}\]/gm) ?? []).length;
}

/** Split a person body into { headline, read, log }. The headline is the leading
 *  blockquote block; `read` is the current profile between markers (if any);
 *  `log` is everything else (the dated facts). */
function splitBody(body: string): { headline: string; log: string } {
  // Pull out any existing read block first.
  let rest = body;
  const s = rest.indexOf(READ_START);
  const e = rest.indexOf(READ_END);
  if (s !== -1 && e !== -1 && e > s) {
    rest = (rest.slice(0, s) + rest.slice(e + READ_END.length)).replace(/\n{3,}/g, "\n\n");
  }
  // Peel the leading blockquote headline.
  const lines = rest.split("\n");
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  const head: string[] = [];
  while (i < lines.length && lines[i]!.startsWith(">")) head.push(lines[i++]!);
  while (i < lines.length && lines[i]!.trim() === "") i++;
  return { headline: head.join("\n"), log: lines.slice(i).join("\n").trim() };
}

async function callOpenAIJSON(system: string, user: string): Promise<{ headline?: string; read?: string } | null> {
  const key = apiKey();
  if (!key) return null;
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL(),
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return null;
    try {
      const parsed = JSON.parse(content) as { headline?: unknown; read?: unknown };
      return {
        headline: typeof parsed.headline === "string" ? parsed.headline.trim() : undefined,
        read: typeof parsed.read === "string" ? parsed.read.trim() : undefined,
      };
    } catch {
      return null;
    }
  } finally {
    clearTimeout(to);
  }
}

function buildPrompt(headline: string, log: string, ownerContext?: string): { system: string; user: string } {
  const system = [
    "Eres el motor de perfilado de un LLM-Wiki personal (patrón Karpathy).",
    "A partir de observaciones fechadas de reuniones, sintetizas una LECTURA breve",
    "y honesta de una persona: cómo es y cómo trabajar con ella. Es un perfil",
    "psicológico/operativo INFERIDO — patrones de conducta, no chismes ni datos",
    "sensibles. Reglas:",
    "- Escribe en español, en segunda persona hacia el dueño del wiki cuando des consejos.",
    "- Fundaméntate SOLO en las observaciones. No inventes hechos concretos.",
    "- Infiere patrones (estilo, motivaciones, sesgos) pero marca lo especulativo con",
    "  hedging ('parece', 'tiende a'). Si la evidencia es delgada, sé breve.",
    "- Sé candido y útil, no un halago genérico. Señala fricciones de forma constructiva.",
    "- NO repitas la lista de hechos; destílalos.",
    "",
    "Devuelve SOLO un objeto JSON con dos claves: \"headline\" y \"read\".",
    "",
    '"headline": UNA sola línea de identidad, re-inferida desde TODAS las',
    "  observaciones (no solo la primera): rol/función + equipo/área y, si es claro,",
    "  la empresa, más la relación con el dueño. Debe reflejar lo más actual/completo",
    '  que se sepa. Ej: "PM de Checkout @ Rappi · contraparte del dueño en pagos".',
    '  Sin markdown, sin comillas, sin ">". Cadena vacía "" solo si es imposible inferir.',
    "",
    '"read": el perfil en markdown con esta forma (omite una sección si no hay evidencia):',
    "",
    "**En una línea:** <esencia en una frase>",
    "",
    "**Cómo opera:** <estilo de trabajo/comunicación/decisión>",
    "",
    "**Qué le importa:** <motivaciones, lo que optimiza>",
    "",
    "**Fortalezas:** <...>",
    "",
    "**Ojo con:** <fricciones, sesgos, dónde empuja — constructivo>",
    "",
    "**Cómo trabajar con esta persona:** <2–3 tips concretos para el dueño>",
    "",
    "En \"read\" no incluyas encabezados de nivel #, ni preámbulo, ni cierre.",
  ].join("\n");

  const user = [
    ownerContext ? `CONTEXTO DEL DUEÑO: ${ownerContext}` : "",
    headline ? `IDENTIDAD (headline): ${headline.replace(/^>\s?/gm, "").trim()}` : "",
    "",
    "OBSERVACIONES FECHADAS:",
    log.slice(0, MAX_INPUT_CHARS),
  ]
    .filter(Boolean)
    .join("\n");
  return { system, user };
}

export interface ProfileOptions {
  /** Minimum dated facts required to bother profiling. Default 3. */
  minFacts?: number;
  /** Regenerate even if the fact count hasn't changed since last profile. */
  force?: boolean;
  visibility?: Visibility;
  ownerContext?: string;
}

/** Generate/refresh the "Read" for one person. Idempotent: replaces the block
 *  between markers, preserves the headline and the dated log. */
export async function profilePerson(
  brain: Brain,
  userId: string,
  config: UserConfig,
  allowed: Visibility[],
  nameOrSlug: string,
  opts: ProfileOptions = {},
): Promise<ProfilePersonResult> {
  if (!apiKey()) return { ok: false, path: personPath(nameOrSlug), skipped: "no-llm" };
  const path = nameOrSlug.startsWith("people/") ? nameOrSlug : personPath(nameOrSlug);
  const note = await brain.readNote(userId, path, allowed).catch(() => null);
  if (!note) return { ok: false, path, skipped: "no-note" };

  const facts = countFacts(note.body);
  const minFacts = opts.minFacts ?? 3;
  if (facts < minFacts) return { ok: false, path, skipped: "too-thin", facts };

  const already = Number(note.meta.extra?.profile_facts ?? 0);
  const hasRead = note.body.includes(READ_START);
  if (!opts.force && hasRead && already === facts) return { ok: true, path, skipped: "up-to-date", facts };

  const { headline, log } = splitBody(note.body);
  const { system, user } = buildPrompt(headline, log, opts.ownerContext);
  const result = await callOpenAIJSON(system, user);
  const read = result?.read;
  if (!read) return { ok: false, path, skipped: "no-llm", facts };

  // Re-read right before writing: the ingest pipeline may have appended new facts
  // during the LLM call. Rebuild from the FRESH headline+log so a full-body write
  // never drops a concurrently-appended fact. (We keep the read even if a touch
  // newer fact landed — the scheduler will re-profile it.)
  const fresh = await brain.readNote(userId, path, allowed).catch(() => note);
  const { headline: h2, log: log2 } = splitBody(fresh.body);
  const freshFacts = countFacts(fresh.body) || facts;

  // Re-infer the identity headline from ALL facts (not just whatever the first
  // meeting happened to state). Fall back to the existing one if the model
  // couldn't infer a fresh line, so we never blank out a good headline.
  const inferred = result?.headline?.replace(/^>\s*/, "").trim();
  const headlineBlock = inferred ? `> ${inferred}` : h2;

  const block = [
    READ_START,
    "## Read",
    `_Lectura inferida de ${freshFacts} observaciones · actualizado ${todayISO()}_`,
    "",
    read,
    READ_END,
  ].join("\n");

  const body =
    [headlineBlock, block, log2].filter((s) => s && s.trim()).join("\n\n").replace(/\s+$/, "") + "\n";

  await brain.updateNote(userId, path, { body, extra: { profile_facts: freshFacts, profiled_at: todayISO() } }, allowed);
  return { ok: true, path, facts: freshFacts };
}

export interface ProfileBatchResult {
  scanned: number;
  profiled: number;
  skipped: number;
  errors: number;
  people: { path: string; facts: number; status: string }[];
}

/** Profile all people with enough facts whose read is stale (fact count changed)
 *  or missing. Concurrency-limited; caller can cap how many to (re)generate. */
export async function profileStalePeople(
  brain: Brain,
  userId: string,
  config: UserConfig,
  allowed: Visibility[],
  opts: ProfileOptions & { limit?: number; concurrency?: number } = {},
): Promise<ProfileBatchResult> {
  const minFacts = opts.minFacts ?? 3;
  const people = await brain.listNotes(userId, { prefix: "people/", allowed, limit: 5000 });
  const out: ProfileBatchResult = { scanned: people.length, profiled: 0, skipped: 0, errors: 0, people: [] };

  // Cheap pre-filter using the index rows would miss fact counts, so read notes
  // and decide. We stop once we hit the limit of actual (re)generations.
  const limit = opts.limit ?? Infinity;
  const conc = opts.concurrency ?? 4;
  const queue = [...people];
  let generated = 0;

  async function worker(): Promise<void> {
    while (queue.length && generated < limit) {
      const p = queue.shift();
      if (!p) break;
      try {
        const r = await profilePerson(brain, userId, config, allowed, p.path, opts);
        if (r.ok && !r.skipped) {
          generated++;
          out.profiled++;
          out.people.push({ path: r.path, facts: r.facts ?? 0, status: "profiled" });
        } else {
          out.skipped++;
        }
      } catch {
        out.errors++;
      }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  return out;
}

/** Slug helper re-export for callers that only import this module. */
export { slugify };
