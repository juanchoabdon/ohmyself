/**
 * The journal job (bonds ai-in-chat B2ext — keeper loop 2 of 3).
 *
 * For every machine-provisioned space with an inbox, each CLOSED day of
 * transcript deltas (pushed by the owner system) is distilled once. What gets
 * written depends on the KIND of brain:
 *
 * `self` (adenda 8 — one person's private brain, keyed by their mxid):
 *   - `journal/<yyyy>/<day>.md` — the personal journal, same path `log_journal`
 *     writes, so a day the agent logged and a day the keeper distilled are one;
 *   - `memory/log.md`           — durable facts about the person, as the dated
 *     bullets `remember` writes;
 *   - `_index.md`               — the postal, refreshed with the freshest day.
 *   No living picture: the person's identity is `identity/` and belongs to
 *   `update_identity`, never to the keeper.
 *
 * `relationship` (one room):
 *   - `journal/<day>.md` — what happened, what was decided, what stayed open;
 *   - `memory/facts.md`  — durable, attributed facts (`decided` vs `said`);
 *   - `memory/relationship.md` — the living picture: the ACCUMULATED, dated
 *     state of the relationship and of each member (see `core/picture.ts`);
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
  getSpace,
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
import {
  annotateIds,
  identityFromPicture,
  nextPicture,
  pictureWithoutIdentity,
} from "./core/picture.js";

export {
  GROUP_IDENTITY_HEADING,
  composePicture,
  identityFromPicture,
  pictureWithoutIdentity,
} from "./core/picture.js";

const JOURNAL_TIMEOUT_MS = 90_000;
/** Hard cap on transcript characters per day sent to the model. */
const MAX_TRANSCRIPT_CHARS = 60_000;
/** Days distilled per tick — a long backfill drains across ticks, not in one. */
const MAX_DAYS_PER_TICK = 24;
/** Closed days of journal headlines that ground the picture, so it is built
 *  from the month and not from the single day in front of the model. */
export const PICTURE_CONTEXT_DAYS = 14;
/** Cap on the headlines block sent to the model. */
const MAX_PICTURE_CONTEXT_CHARS = 9_000;
/** Chars of each journal's opening paragraph that make it into a headline. */
const HEADLINE_CHARS = 320;

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
  relationship_update: z.string().default(""),
  picture_drop: z.array(z.string()).default([]),
  group_identity: z.string().default(""),
});
type JournalDay = z.infer<typeof JournalDaySchema>;

/**
 * The contract of the living picture, shared by the daily keeper and by the
 * one-off rebuild (`scripts/rebuild-relationship-picture.ts`) so both hold
 * the model to the same rule: MERGE into the state on file, never rewrite it
 * from today. Before 2026-10-07 this said "FULL replacement body… anything
 * you leave out is erased" and the model did exactly that: the duo's picture
 * ended up holding one day and a month of context was gone.
 */
export const PICTURE_RULES = `- relationship_update is the ACCUMULATED state of this relationship, NOT a
  summary of today. You are handed the picture currently on file, in full,
  plus the headlines of the last ${PICTURE_CONTEXT_DAYS} days of journal. Your
  job is to return the NEXT version of it: what a friend who has followed
  this room for months would know is going on with these people right now.
- The rule is MERGE, never rewrite from today:
    · every conclusion still in force is carried forward (word for word or
      refined) — a day on which nobody mentions the marathon does not mean
      the marathon stopped mattering. When you rewrite a section, account for
      EVERY item of the version on file: it reappears (possibly refined), it
      moves to "Cerrado recientemente", or it was contradicted. Nothing just
      vanishes;
    · what today ADDS is added, dated with the day's date;
    · what today CONTRADICTS or supersedes is updated in place with the new
      date — the stale version is not kept alongside;
    · what has come to an END (a trip that happened, a deadline that passed, a
      question that got settled) moves to "Cerrado recientemente" as one
      dated line — it is not deleted silently. Keep that section to the last
      ~8 items; the oldest fall off.
  Delete something ONLY when the day shows it was wrong. Return "" when the
  day changes nothing — the picture then stays exactly as it is.
- Every bullet of the picture on file comes tagged with an id like [S2] or
  [C5]. When you return a section, tag each bullet that CONTINUES an item
  with its id ("- [S2] …"; several if you folded items: "- [S2][S4] …"); a
  new item has no tag; an item that ended goes to "Cerrado recientemente"
  WITH its id. Any item whose id appears nowhere in your answer is kept by
  the keeper exactly as it was, under its own heading — so the only way to
  remove an item as wrong or contradicted is to list its id in picture_drop.
  Nothing vanishes silently. The tags are stripped before the note is saved.
- Write the sections you are CHANGING, each one complete (merged: old + new).
  A section you leave out is kept on file exactly as it was, so do not copy a
  section just to keep it. Sections and what goes in each:
    "## Situación" — what is happening to the relationship right now (where
      each one is, whether they are together or apart, what they are in the
      middle of together, the big open fronts), every item dated with its
      evidence: "(inferido, 2026-09-17: ella mencionó el vuelo a Bogotá)".
      It is the MONTH's thread, not a log of the days: a payment made, a seat
      swap, where to meet at 12:30, a link shared — that lives in the journal
      and does NOT enter the picture unless it is still open and will matter
      next week. Keep it to the ~6-10 items that matter; when adding one,
      fold it into an existing item or drop the lesser one.
    "## Contexto de cada uno" — one "### Name" per ROSTER member (the quiet
      ones too), 3-6 items each: mood as it shows in what they say, work,
      health/body (training, an injury), the plan currently in force, each
      with evidence and date. A new day REFINES these items (the mood today
      updates the mood item), it does not append one bullet per day. The
      room's AI (bondi) is not a member: never describe it or its behavior.
    "## Dinámicas" — recurring patterns of how they talk and decide, rituals,
      likes, between the MEMBERS. Slow-moving; 3-6 items, refined over weeks,
      not one per day.
    "## En el horizonte" — only CONCRETE future things (trips, races,
      deadlines, visits, moves, decisions with a date), one bullet each, and
      every bullet STARTS with the target date as YYYY-MM-DD (YYYY-MM when
      only the month is known), then the EVENT, then its evidence:
      "- 2026-11-15 — Juandi planea renunciar (dicho, 2026-10-02)". Events,
      not reminders or chores ("revisar entradas" is a chore; "viaje a Roma"
      is the event). Something mentioned as coming up ("en noviembre nos
      vamos a Ámsterdam") belongs here even if the exact day is unknown. Past
      dates are moved to "Cerrado recientemente" by you and by the keeper.
    "## Cerrado recientemente" — what was in the picture and has ended, one
      dated line each, so the past is not mistaken for the present.
- Every conclusion is an INFERENCE with its evidence and date. Prefer updating
  or retiring a stale conclusion over piling up contradictions.
- Never produce psychological profiles or diagnoses of the members. Conclusions
  are practical and situational, never clinical or judgmental.
- Do NOT include "Qué es este grupo" in relationship_update — that is
  group_identity and the note is composed for you.`;

const SYSTEM = `You distill ONE day of a shared room's conversation into that
relationship's private journal. You are a careful archivist, not a commentator.

Rules:
- Only what actually happened in the transcript. Never invent, never pad.
- Attribute by the speaker's name exactly as given.
- "decided" is reserved for explicit agreement or resolution; everything else is "said".
- memory_facts are only DURABLE facts worth remembering months later
  (preferences, dates, commitments, life facts) — not chit-chat. Skip facts the
  existing memory already covers.
- Beyond logging, DRAW CONCLUSIONS: you maintain the living picture of this
  relationship in relationship_update — practical, grounded inferences a good
  friend would keep in mind about what is going on with these people NOW.
${PICTURE_RULES}
- group_identity is its own field: what this room IS and what it is FOR.
  Three things, in two or three sentences: how these people know each other
  (lifelong friends, a couple, siblings, people who work together, several of
  those at once), what they use THIS chat for (dividing work, sending each
  other feedback, planning, or just hanging out), and which registers live
  here (jokes and life alongside the work, or strictly one).
- It is NOT the situation. The situation is what is happening to them right
  now and it changes; this is what they ARE to each other and it barely moves.
  If it could start with "el grupo está…", it is the wrong thing. Never copy a
  sentence from relationship_update into it, and never copy a phrasing from
  these instructions: an answer that could have been written without reading
  their conversation is wrong.
- It changes SLOWLY: it is the accumulation of many days, not the mood of this
  one. One busy work day does not turn a group of friends into a work channel,
  and one night of jokes does not erase that they build something together.
  You are given the identity already on file: return "" to keep it as is, and
  only write a new one when this day genuinely contradicts it or adds
  something it was missing. If there is none on file, write the first one from
  whatever the day and the picture give you; if they give you nothing about
  what these people are to each other, return "".
- If someone STATED it outright ("este grupo es donde repartimos el trabajo"),
  that is evidence stronger than any inference of yours: keep it.
- Go by the ROSTER, not by who happened to talk. A member who said nothing
  today, or nothing all week, is still in this room: never describe the group
  as if only the speakers were in it, and never leave a member out of
  group_identity or of "Contexto de cada uno" because they are quiet.
- Write in the conversation's dominant language.
- A day of pure noise (stickers, "jaja", logistics with no substance) is
  worth_keeping=false with everything else empty — but relationship_update may
  still be non-empty if the noise reveals something practical (a location, a
  plan), or if the picture is still missing "Qué es este grupo".

Answer ONLY a JSON object with keys: worth_keeping (boolean), headline (string,
one line), summary (string, one short paragraph), moments (string[]),
decisions ({text, kind: "decided"|"said"}[]), open_threads (string[]),
memory_facts ({fact, attribution, kind: "decided"|"said"}[]),
relationship_update (string), picture_drop (string[] of ids), group_identity (string).`;

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

function journalBody(day: Pick<JournalDay, "summary" | "moments" | "decisions" | "open_threads">): string {
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

export async function readNoteOrNull(
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

/** The living picture, written as the keeper. Shared with the rebuild script. */
export async function writePicture(
  brain: Brain,
  spaceId: string,
  config: UserConfig,
  allowed: Visibility[],
  body: string,
  summary: string,
): Promise<void> {
  await writeNote(brain, spaceId, config, allowed, {
    path: "memory/relationship.md",
    type: "memory",
    title: "La relación",
    body,
    summary,
  });
}

function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function firstParagraph(body: string): string {
  const para = body.trim().split(/\n\s*\n/)[0] ?? "";
  return para.replace(/\s+/g, " ").trim();
}

/**
 * The headlines of the journals of the last PICTURE_CONTEXT_DAYS closed days
 * before `day`, oldest first — one line per day, from each journal's opening
 * paragraph. This is what lets the picture be built from the month: without
 * it the model sees one day and the picture on file, and when the picture is
 * already thin it has nothing to recover the month from.
 */
export async function recentJournalHeadlines(
  brain: Brain,
  spaceId: string,
  day: string,
  allowed: Visibility[],
): Promise<string> {
  const from = shiftDay(day, -PICTURE_CONTEXT_DAYS);
  const rows = await brain.listNotes(spaceId, { prefix: "journal/", allowed, limit: 500 });
  const days = rows
    .map((r) => /^journal\/(\d{4}-\d{2}-\d{2})\.md$/.exec(r.path)?.[1])
    .filter((d): d is string => Boolean(d) && (d as string) >= from && (d as string) < day)
    .sort()
    .reverse(); // newest first, so a tight budget drops the oldest
  const lines: string[] = [];
  let total = 0;
  for (const d of days) {
    const note = await readNoteOrNull(brain, spaceId, `journal/${d}.md`, allowed);
    if (!note) continue;
    const line = `- ${d}: ${firstParagraph(note.body).slice(0, HEADLINE_CHARS)}`;
    if (total + line.length > MAX_PICTURE_CONTEXT_CHARS) break;
    lines.push(line);
    total += line.length;
  }
  return lines.reverse().join("\n");
}

/** The grounding block about the picture, shared with the rebuild script so
 *  the model sees the same framing in both paths. */
export function pictureContextBlock(input: {
  picture: string | null;
  roster: string | null;
  headlines: string;
}): string[] {
  const identity = input.picture ? identityFromPicture(input.picture) : "";
  const rest = input.picture ? pictureWithoutIdentity(input.picture) : "";
  return [
    `Who is in this room (roster — the transcript only shows who SPOKE today):`,
    input.roster ?? "(unknown — go by the transcript)",
    ``,
    `Identity already on file for this room (group_identity; it is composed into the note for you):`,
    identity || "(none yet — write the first one if the day gives you enough)",
    ``,
    `Picture currently on file (memory/relationship.md minus the identity), every bullet tagged with its id. relationship_update MERGES into this: sections you do not return are kept as they are; in a section you return, tag the bullets you continue with their ids — any id missing from your whole answer is kept verbatim by the keeper; to remove one, name it in picture_drop:`,
    rest ? annotateIds(rest) : "(empty — write the first picture if the day gives you enough)",
    ``,
    `What the last ${PICTURE_CONTEXT_DAYS} days looked like (journal headlines, oldest first — build the picture from the month, not from today alone):`,
    input.headlines || "(no earlier journals)",
  ];
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
    `Where to look: \`journal/\` for the day-by-day, \`memory/facts.md\` for durable facts, \`memory/relationship.md\` for the living picture (situation, contexts, dynamics), \`projects/\` and \`docs/\` for the shared zone.`,
  ].join("\n");
  await writeNote(brain, spaceId, config, allowed, {
    path: "_index.md",
    type: "note",
    title: title ?? "Postal",
    body,
    summary: `postal after ${day}`,
  });
}

// ── Personal brains (self, machine-provisioned) ──────────────────────────────

const PersonalJournalSchema = z.object({
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
        kind: z.enum(["decided", "said"]).default("said"),
      }),
    )
    .default([]),
});
type PersonalJournalDay = z.infer<typeof PersonalJournalSchema>;

const PERSONAL_SYSTEM = `You distill ONE day of a person's conversations (with
their assistant, or in chats they take part in) into THEIR private journal.
This is the person's own second brain: everything is from their point of view.
You are a careful archivist, not a commentator.

Rules:
- Only what actually happened in the transcript. Never invent, never pad.
- The person is the owner of this brain (their name is given). Other speakers
  are people in their life: attribute what THEY said by their name, but write
  the journal about the owner's day.
- "decided" is reserved for something the owner explicitly decided or agreed
  to; everything else is "said".
- memory_facts are only DURABLE facts about the owner worth remembering months
  later (preferences, people in their life and who they are to them, dates,
  commitments, life facts, how they like things done) — not chit-chat. Skip
  facts the existing memory already covers. Each fact is a standalone
  statement that makes sense out of context ("Prefers to train in the
  morning", "Her sister Vale lives in Medellín").
- Never produce psychological profiles or diagnoses. Facts are practical.
- Write in the conversation's dominant language.
- A day of pure noise (stickers, "jaja", logistics with no substance) is
  worth_keeping=false with everything else empty.

Answer ONLY a JSON object with keys: worth_keeping (boolean), headline (string,
one line), summary (string, one short paragraph), moments (string[]),
decisions ({text, kind: "decided"|"said"}[]), open_threads (string[]),
memory_facts ({fact, kind: "decided"|"said"}[]).`;

/** The personal journal lives where `log_journal` writes it. */
export function personalJournalPath(day: string): string {
  return `journal/${day.slice(0, 4)}/${day}.md`;
}

/** Durable facts of a personal brain, in the dated-bullet form `remember` uses. */
export function personalMemoryLines(day: string, facts: PersonalJournalDay["memory_facts"]): string {
  return facts
    .map((f) => `- ${day} — ${f.fact.trim()} _(#keeper #${f.kind})_`)
    .join("\n");
}

async function appendPersonalMemory(
  brain: Brain,
  spaceId: string,
  config: UserConfig,
  allowed: Visibility[],
  day: string,
  facts: PersonalJournalDay["memory_facts"],
): Promise<void> {
  if (facts.length === 0) return;
  const lines = personalMemoryLines(day, facts);
  await brain.upsertNote(
    spaceId,
    "memory/log.md",
    { type: "note", title: "Memory log", body: lines, append: true, visibility: "private", tags: ["memory"] },
    config,
    allowed,
    { ...KEEPER_ATTRIBUTION, summary: `memory ${day}` },
  );
}

async function refreshPersonalPostal(
  brain: Brain,
  spaceId: string,
  config: UserConfig,
  allowed: Visibility[],
  name: string,
  day: string,
  distilled: PersonalJournalDay,
): Promise<void> {
  const headline = distilled.headline.trim() || distilled.summary.trim().slice(0, 140);
  const open = distilled.open_threads.length
    ? `\n\nOpen threads:\n${distilled.open_threads.map((t) => `- ${t}`).join("\n")}`
    : "";
  const path = personalJournalPath(day).replace(/\.md$/, "");
  const body = [
    `Postal of ${name}'s brain — regenerated by the keeper.`,
    ``,
    `**Last journal:** [[${path}]] — ${headline}`,
    ``,
    `${distilled.summary.trim()}${open}`,
    ``,
    `Where to look: \`identity/\` for who this person is, \`journal/\` for the day-by-day, \`memory/log.md\` for durable facts, \`people/\`, \`projects/\` and \`goals/\` for their world.`,
  ].join("\n");
  await writeNote(brain, spaceId, config, allowed, {
    path: "_index.md",
    type: "note",
    title: name,
    body,
    summary: `postal after ${day}`,
  });
}

/** Distill one day of a PERSONAL brain. Returns whether a journal was written. */
export async function distillPersonalJournalDay(
  brain: Brain,
  spaceId: string,
  day: string,
  name: string,
): Promise<boolean> {
  const deltas = await readDeltas(spaceId, day);
  if (deltas.length === 0) {
    await markDeltasDigested(spaceId, day);
    return false;
  }
  const config = await getUserConfig(spaceId);
  const allowed = allowedVisibilities("secret");

  const memory = await readNoteOrNull(brain, spaceId, "memory/log.md", allowed);
  const memoryHead = memory ? memory.body.split("\n").slice(-60).join("\n") : "(empty)";
  const identity = await readNoteOrNull(brain, spaceId, "identity/about-me.md", allowed);
  const journalPath = personalJournalPath(day);
  const priorJournal = await readNoteOrNull(brain, spaceId, journalPath, allowed);

  const user = [
    `Owner of this brain: ${name}`,
    `Day: ${day}`,
    ``,
    `Who the owner is (identity/about-me.md):`,
    identity?.body.trim() || "(nothing on file yet)",
    ``,
    `Existing durable memory (tail of memory/log.md):`,
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
    system: PERSONAL_SYSTEM,
    user,
    timeoutMs: JOURNAL_TIMEOUT_MS,
  });
  if (raw == null) throw new Error("journal distillation returned nothing");
  const parsed = PersonalJournalSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`journal distillation shape invalid: ${parsed.error.message}`);
  const distilled = parsed.data;

  if (distilled.worth_keeping && (distilled.summary.trim() || distilled.moments.length)) {
    await writeNote(brain, spaceId, config, allowed, {
      path: journalPath,
      type: "journal",
      title: day,
      body: journalBody(distilled),
      summary: `journal ${day}`,
    });
    await appendPersonalMemory(brain, spaceId, config, allowed, day, distilled.memory_facts);
    await refreshPersonalPostal(brain, spaceId, config, allowed, name, day, distilled);
  }

  await markDeltasDigested(spaceId, day);
  return distilled.worth_keeping;
}

// ── Relationship brains (one room) ───────────────────────────────────────────

/** Distill one space+day. Returns whether a journal note was written. Routes
 *  by the KIND of brain: a personal brain gets the personal journal, a room
 *  gets the relationship journal + living picture. */
export async function distillJournalDay(
  brain: Brain,
  spaceId: string,
  day: string,
): Promise<boolean> {
  const space = await getSpace(spaceId);
  if (space?.kind === "self") {
    return distillPersonalJournalDay(brain, spaceId, day, space.name);
  }
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

  // The living picture — conclusions the keeper maintains about the
  // relationship (JD 2026-09-17: "que empiece a sacar conclusiones"). It is
  // an accumulated state the model merges into, never a rewrite of the day
  // (JD 2026-10-07: the duo's picture had shrunk to one day).
  const relationship = await readNoteOrNull(brain, spaceId, "memory/relationship.md", allowed);

  // QUIÉN está en el room, que no es lo mismo que quién habló. El día solo
  // trae a los que escribieron, así que un miembro callado desaparecía de la
  // foto: en amiwos (2026-09-22) la identidad enumeraba a los que hablaron y
  // dejaba a Vale afuera, que lleva meses en el grupo sin escribir. El roster
  // ya vive en el brain (`people.md`, lo escribe bonds), solo faltaba leerlo.
  const people = await readNoteOrNull(brain, spaceId, "people.md", allowed);

  // The month behind this day, so the picture is built from it and not from
  // the single day in front of the model.
  const headlines = await recentJournalHeadlines(brain, spaceId, day, allowed);

  // A journal already written for this day means these are LATE deltas (an
  // edit, a backfill replay): integrate with it instead of losing the morning.
  const priorJournal = await readNoteOrNull(brain, spaceId, `journal/${day}.md`, allowed);

  const user = [
    `Day: ${day}`,
    ``,
    `Existing durable memory (tail):`,
    memoryHead,
    ``,
    ...pictureContextBlock({
      picture: relationship?.body ?? null,
      roster: people?.body ?? null,
      headlines,
    }),
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

  // The living picture moves even on "noise" days — a location or a plan can
  // surface in an otherwise skippable day, and a horizon date that has passed
  // retires on its own. What the model returned is MERGED into what was on
  // file (sections it left out survive), and the identity is composed here,
  // never left to the model's diligence inside the body.
  const previousPicture = relationship?.body ?? "";
  const next = nextPicture({
    previous: previousPicture,
    identity: distilled.group_identity,
    update: distilled.relationship_update,
    drop: distilled.picture_drop,
    day,
  });
  if (next && next !== previousPicture.trim()) {
    await writePicture(brain, spaceId, config, allowed, next, `relationship picture ${day}`);
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
