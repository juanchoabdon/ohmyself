/**
 * The relationship journal job (bonds ai-in-chat B2ext — keeper loop 2 of 3).
 *
 * For every relationship space, each CLOSED day of transcript deltas (pushed by
 * the room's owner system) is distilled once into:
 *   - `journal/<day>.md` — what happened, what was decided, what stayed open;
 *   - `memory/facts.md`  — durable, attributed facts (`decided` vs `said`);
 *   - `_index.md`        — the postal, refreshed with the freshest day.
 *
 * The deltas are then marked digested, so re-pushing the same events (replay,
 * historical backfill) never double-writes a day. Self-throttling is natural:
 * a space only appears here while it has undigested closed days.
 */

import { z } from "zod";
import type { Brain } from "./core/brain.js";
import {
  allowedVisibilities,
  buildCore,
  getUserConfig,
  markDeltasDigested,
  pendingJournalDays,
  readDeltas,
  KEEPER_ATTRIBUTION,
  type DeltaRow,
} from "./core/index.js";
import { chatJSON, llmEnabled } from "./core/llm.js";
import { NotFoundError } from "./core/errors.js";
import type { UserConfig } from "./core/config.js";
import type { Visibility } from "./core/types.js";

const JOURNAL_TIMEOUT_MS = 90_000;
/** Hard cap on transcript characters per day sent to the model. */
const MAX_TRANSCRIPT_CHARS = 60_000;
/** Days distilled per tick — a long backfill drains across ticks, not in one. */
const MAX_DAYS_PER_TICK = 24;

/** A day is only distilled once it is CLOSED everywhere it could be spoken:
 *  deltas carry the room's LOCAL day, so "before today UTC" would close a
 *  UTC-5 evening five hours early and a late re-distill would overwrite the
 *  journal with just the evening's messages. 14h past midnight UTC covers
 *  every inhabited timezone (UTC-12 … UTC+14). */
function closedDayCutoff(now = Date.now()): string {
  return new Date(now - 14 * 3_600_000).toISOString().slice(0, 10);
}

const JournalDaySchema = z.object({
  worth_keeping: z.boolean(),
  headline: z.string().default(""),
  summary: z.string().default(""),
  moments: z.array(z.string()).default([]),
  decisions: z
    .array(
      z.object({
        text: z.string(),
        kind: z.enum(["decided", "said"]).default("said"),
      }),
    )
    .default([]),
  open_threads: z.array(z.string()).default([]),
  memory_facts: z
    .array(
      z.object({
        fact: z.string(),
        attribution: z.string().default(""),
        kind: z.enum(["decided", "said"]).default("said"),
      }),
    )
    .default([]),
});
type JournalDay = z.infer<typeof JournalDaySchema>;

const SYSTEM = `You distill ONE day of a shared room's conversation into that
relationship's private journal. You are a careful archivist, not a commentator.

Rules:
- Only what actually happened in the transcript. Never invent, never pad.
- Attribute by the speaker's name exactly as given.
- "decided" is reserved for explicit agreement or resolution; everything else is "said".
- memory_facts are only DURABLE facts worth remembering months later
  (preferences, dates, commitments, life facts) — not chit-chat. Skip facts the
  existing memory already covers.
- Never produce psychological profiles or diagnoses of the members.
- Write in the conversation's dominant language.
- A day of pure noise (stickers, "jaja", logistics with no substance) is
  worth_keeping=false with everything else empty.

Answer ONLY a JSON object with keys: worth_keeping (boolean), headline (string,
one line), summary (string, one short paragraph), moments (string[]),
decisions ({text, kind: "decided"|"said"}[]), open_threads (string[]),
memory_facts ({fact, attribution, kind: "decided"|"said"}[]).`;

function transcriptText(deltas: DeltaRow[]): string {
  const lines = deltas.map((d) => {
    const hhmm = new Date(d.at).toISOString().slice(11, 16);
    const voice = d.kind === "text" ? "" : ` (${d.kind.replace(/_/g, " ")})`;
    return `[${hhmm}] ${d.author}${voice}: ${d.body}`;
  });
  let text = lines.join("\n");
  if (text.length > MAX_TRANSCRIPT_CHARS) text = text.slice(0, MAX_TRANSCRIPT_CHARS) + "\n[…truncated]";
  return text;
}

function journalBody(day: JournalDay): string {
  const parts: string[] = [];
  if (day.summary.trim()) parts.push(day.summary.trim());
  if (day.moments.length) {
    parts.push(`## Moments\n\n${day.moments.map((m) => `- ${m}`).join("\n")}`);
  }
  if (day.decisions.length) {
    parts.push(
      `## Decisions\n\n${day.decisions.map((d) => `- **${d.kind}** — ${d.text}`).join("\n")}`,
    );
  }
  if (day.open_threads.length) {
    parts.push(`## Open threads\n\n${day.open_threads.map((t) => `- ${t}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

async function readNoteOrNull(
  brain: Brain,
  spaceId: string,
  path: string,
  allowed: Visibility[],
): Promise<{ body: string } | null> {
  try {
    const note = await brain.readNote(spaceId, path, allowed);
    return { body: note.body };
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

/** Create-or-replace a cocina note at a fixed path. */
async function writeNote(
  brain: Brain,
  spaceId: string,
  config: UserConfig,
  allowed: Visibility[],
  input: { path: string; type: string; title: string; body: string; summary: string },
): Promise<void> {
  const existing = await readNoteOrNull(brain, spaceId, input.path, allowed);
  if (existing === null) {
    await brain.createNote(
      spaceId,
      { type: input.type, title: input.title, body: input.body, path: input.path, visibility: "secret" },
      config,
      allowed,
      { ...KEEPER_ATTRIBUTION, summary: input.summary },
    );
    return;
  }
  await brain.updateNote(
    spaceId,
    input.path,
    { body: input.body },
    allowed,
    { ...KEEPER_ATTRIBUTION, summary: input.summary },
  );
}

async function appendMemoryFacts(
  brain: Brain,
  spaceId: string,
  config: UserConfig,
  allowed: Visibility[],
  day: string,
  facts: JournalDay["memory_facts"],
): Promise<void> {
  if (facts.length === 0) return;
  const lines = facts
    .map((f) => {
      const who = f.attribution.trim() ? ` — ${f.attribution.trim()}` : "";
      return `- ${f.fact.trim()}${who} (${f.kind}, ${day})`;
    })
    .join("\n");
  const path = "memory/facts.md";
  const existing = await readNoteOrNull(brain, spaceId, path, allowed);
  if (existing === null) {
    await brain.createNote(
      spaceId,
      {
        type: "memory",
        title: "Facts",
        body: `Durable, attributed facts of this relationship. Fed by the keeper (implicit) and by explicit "remember" mandates.\n\n${lines}`,
        path,
        visibility: "secret",
      },
      config,
      allowed,
      { ...KEEPER_ATTRIBUTION, summary: `memory facts ${day}` },
    );
    return;
  }
  await brain.appendToNote(spaceId, path, lines, allowed, {
    ...KEEPER_ATTRIBUTION,
    summary: `memory facts ${day}`,
  });
}

/** Refresh the `_index.md` postal with the freshest distilled day. Deterministic
 *  (reuses the day's own headline/summary): no extra model call per day. */
async function refreshPostal(
  brain: Brain,
  spaceId: string,
  config: UserConfig,
  allowed: Visibility[],
  day: string,
  distilled: JournalDay,
): Promise<void> {
  const existing = await readNoteOrNull(brain, spaceId, "_index.md", allowed);
  const title = existing ? undefined : "Postal";
  const headline = distilled.headline.trim() || distilled.summary.trim().slice(0, 140);
  const open = distilled.open_threads.length
    ? `\n\nOpen threads:\n${distilled.open_threads.map((t) => `- ${t}`).join("\n")}`
    : "";
  const body = [
    `Postal of this relationship's brain — regenerated by the keeper.`,
    ``,
    `**Last journal:** [[journal/${day}]] — ${headline}`,
    ``,
    `${distilled.summary.trim()}${open}`,
    ``,
    `Where to look: \`journal/\` for the day-by-day, \`memory/facts.md\` for durable facts, \`projects/\` and \`docs/\` for the shared zone.`,
  ].join("\n");
  await writeNote(brain, spaceId, config, allowed, {
    path: "_index.md",
    type: "note",
    title: title ?? "Postal",
    body,
    summary: `postal after ${day}`,
  });
}

/** Distill one space+day. Returns whether a journal note was written. */
export async function distillJournalDay(
  brain: Brain,
  spaceId: string,
  day: string,
): Promise<boolean> {
  const deltas = await readDeltas(spaceId, day);
  if (deltas.length === 0) {
    await markDeltasDigested(spaceId, day);
    return false;
  }
  const config = await getUserConfig(spaceId);
  const allowed = allowedVisibilities("secret");

  // Grounding: the memory head, so the model refines instead of repeating.
  const memory = await readNoteOrNull(brain, spaceId, "memory/facts.md", allowed);
  const memoryHead = memory ? memory.body.split("\n").slice(-60).join("\n") : "(empty)";

  // A journal already written for this day means these are LATE deltas (an
  // edit, a backfill replay): integrate with it instead of losing the morning.
  const priorJournal = await readNoteOrNull(brain, spaceId, `journal/${day}.md`, allowed);

  const user = [
    `Day: ${day}`,
    ``,
    `Existing durable memory (tail):`,
    memoryHead,
    ...(priorJournal
      ? [
          ``,
          `Journal already written for this day (INTEGRATE it — the output replaces it, so keep everything still true):`,
          priorJournal.body,
        ]
      : []),
    ``,
    `Transcript of the day:`,
    transcriptText(deltas),
  ].join("\n");

  const raw = await chatJSON<unknown>({
    tier: "route",
    system: SYSTEM,
    user,
    timeoutMs: JOURNAL_TIMEOUT_MS,
  });
  if (raw == null) throw new Error("journal distillation returned nothing");
  const parsed = JournalDaySchema.safeParse(raw);
  if (!parsed.success) throw new Error(`journal distillation shape invalid: ${parsed.error.message}`);
  const distilled = parsed.data;

  if (distilled.worth_keeping && (distilled.summary.trim() || distilled.moments.length)) {
    await writeNote(brain, spaceId, config, allowed, {
      path: `journal/${day}.md`,
      type: "journal",
      title: day,
      body: journalBody(distilled),
      summary: `journal ${day}`,
    });
    await appendMemoryFacts(brain, spaceId, config, allowed, day, distilled.memory_facts);
    await refreshPostal(brain, spaceId, config, allowed, day, distilled);
  }

  await markDeltasDigested(spaceId, day);
  return distilled.worth_keeping;
}

/** One journal pass: distill up to MAX_DAYS_PER_TICK closed days, oldest first.
 *  Sequential on purpose — days of the same space must land in order so the
 *  postal ends on the freshest one. */
export async function journalTick(): Promise<{ written: number; skipped: number }> {
  if (!llmEnabled()) return { written: 0, skipped: 0 };
  const pending = await pendingJournalDays(closedDayCutoff());
  const batch = pending.slice(0, MAX_DAYS_PER_TICK);
  if (batch.length === 0) return { written: 0, skipped: 0 };

  const { brain } = buildCore();
  let written = 0;
  let skipped = 0;
  for (const { spaceId, day } of batch) {
    try {
      const kept = await distillJournalDay(brain, spaceId, day);
      if (kept) {
        written++;
        console.log(`[journal] ${spaceId}: wrote journal/${day}.md`);
      } else {
        skipped++;
      }
    } catch (err) {
      // Leave the day undigested — the next tick retries it.
      console.error(`[journal] ${spaceId} ${day} failed:`, (err as Error).message);
    }
  }
  return { written, skipped };
}
