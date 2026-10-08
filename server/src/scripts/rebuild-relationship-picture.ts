import "../env.js";
import { allowedVisibilities, buildCore, getUserConfig } from "../core/index.js";
import { chatJSON, llmEnabled } from "../core/llm.js";
import { GROUP_IDENTITY_HEADING, identityFromPicture, nextPicture, splitSections } from "../core/picture.js";
import {
  PICTURE_RULES,
  pictureContextBlock,
  readNoteOrNull,
  recentJournalHeadlines,
  writePicture,
} from "../journal.js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Rebuild a room's living picture (`memory/relationship.md`) from its
 * journals, one closed day at a time, under the MERGE contract of
 * `PICTURE_RULES`. The journals are only READ; nothing else in the space is
 * touched. The identity ("Qué es este grupo") on file is kept.
 *
 *   tsx src/scripts/rebuild-relationship-picture.ts --space <id> \
 *       --from 2026-09-07 --to 2026-10-06 [--dry] [--out <dir>] \
 *       [--keep-rest] [--expect "Berlín,Flimp,15 nov"]
 *
 * --dry       print the result, write nothing to the brain.
 * --out       also save before.md / after.md / <day>.md there (PR evidence).
 * --keep-rest start from the picture on file instead of the identity alone
 *             (default: identity only, so the month is rebuilt from scratch).
 * --expect    comma-separated terms the final picture must contain; the
 *             script lists which are present and which are missing.
 *
 * Why it exists (JD, 2026-10-07): the duo's picture had been rewritten day
 * after day under the old "full replacement" contract until it held only the
 * last day. This is the one-off recovery; the daily keeper now merges.
 */

function argFor(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (flag: string) => process.argv.includes(flag);

const REBUILD_SYSTEM = `You maintain the living picture of a shared room's relationship. You are
replaying its journal one closed day at a time to rebuild that picture after
it was lost. For each day you get the picture as rebuilt so far, the
headlines of the days before, and the journal of this day (what was distilled
from that day's conversation — you do not get the transcript).

Rules:
- Only what the journal and the headlines actually say. Never invent, never pad.
${PICTURE_RULES}
- Write in the journal's dominant language.
- Dates: the journal of day D describes what happened on D; date your
  inferences with D unless the journal names another date.
- The journal's "Open threads" are that day's loose ends, not the situation:
  most of them do not belong in the picture. Only what still matters next
  week enters it.

Answer ONLY a JSON object with keys: relationship_update (string),
picture_drop (string[] of ids removed as wrong or contradicted).`;

async function main(): Promise<void> {
  const spaceId = argFor("--space");
  const from = argFor("--from");
  const to = argFor("--to");
  if (!spaceId || !from || !to) {
    console.error(
      "Usage: tsx src/scripts/rebuild-relationship-picture.ts --space <id> --from YYYY-MM-DD --to YYYY-MM-DD [--dry] [--out <dir>] [--keep-rest] [--expect a,b]",
    );
    process.exit(1);
  }
  if (!llmEnabled()) throw new Error("OPENAI_API_KEY is not set — nothing to rebuild with");
  const dry = hasFlag("--dry");
  const out = argFor("--out");
  if (out) mkdirSync(out, { recursive: true });
  const save = (name: string, body: string) => {
    if (out) writeFileSync(path.join(out, name), body + "\n");
  };

  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");
  const config = await getUserConfig(spaceId);

  const before = (await readNoteOrNull(brain, spaceId, "memory/relationship.md", allowed))?.body ?? "";
  const roster = (await readNoteOrNull(brain, spaceId, "people.md", allowed))?.body ?? null;
  const facts = await readNoteOrNull(brain, spaceId, "memory/facts.md", allowed);
  const identity = identityFromPicture(before);
  save("before.md", before);
  console.log(`[rebuild] before: ${before.length} chars, identity ${identity ? "kept" : "none"}`);

  const rows = await brain.listNotes(spaceId, { prefix: "journal/", allowed, limit: 500 });
  const days = rows
    .map((r) => /^journal\/(\d{4}-\d{2}-\d{2})\.md$/.exec(r.path)?.[1])
    .filter((d): d is string => Boolean(d) && (d as string) >= from && (d as string) <= to)
    .sort();
  console.log(`[rebuild] ${days.length} journals in ${from} → ${to}`);
  if (days.length === 0) return;

  let picture = hasFlag("--keep-rest")
    ? before
    : identity
      ? `${GROUP_IDENTITY_HEADING}\n\n${identity}`
      : "";

  for (const day of days) {
    const journal = await readNoteOrNull(brain, spaceId, `journal/${day}.md`, allowed);
    if (!journal) continue;
    // Facts up to this day only, so a later fact does not leak into an earlier picture.
    const factsHead = facts
      ? facts.body
          .split("\n")
          .filter((l) => {
            const m = /\((?:decided|said), (\d{4}-\d{2}-\d{2})\)\s*$/.exec(l);
            return !m || (m[1] ?? "") <= day;
          })
          .slice(-60)
          .join("\n")
      : "(empty)";
    const headlines = await recentJournalHeadlines(brain, spaceId, day, allowed);
    const user = [
      `Day: ${day}`,
      ``,
      `Existing durable memory (tail):`,
      factsHead,
      ``,
      ...pictureContextBlock({ picture: picture || null, roster, headlines }),
      ``,
      `Journal of the day (what was distilled from that day's conversation):`,
      journal.body,
    ].join("\n");

    let raw: unknown = null;
    for (let attempt = 0; attempt < 2 && raw == null; attempt++) {
      raw = await chatJSON<unknown>({ tier: "route", system: REBUILD_SYSTEM, user, timeoutMs: 120_000 });
    }
    const update =
      raw && typeof raw === "object" && typeof (raw as { relationship_update?: unknown }).relationship_update === "string"
        ? (raw as { relationship_update: string }).relationship_update
        : "";
    const dropRaw = raw && typeof raw === "object" ? (raw as { picture_drop?: unknown }).picture_drop : undefined;
    const drop = Array.isArray(dropRaw) ? dropRaw.filter((d): d is string => typeof d === "string") : [];
    if (raw == null) console.warn(`[rebuild] ${day}: model returned nothing — day skipped, picture kept`);
    picture = nextPicture({ previous: picture, identity: "", update, drop, day });
    const sections = splitSections(picture).sections.map((s) => s.title).join(" | ");
    console.log(`[rebuild] ${day}: update ${update.length} chars, drop ${drop.length} → picture ${picture.length} chars [${sections}]`);
    save(`${day}.md`, picture);
  }

  save("after.md", picture);
  console.log(`\n===== after (${picture.length} chars)\n${picture}\n`);

  const expect = (argFor("--expect") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (expect.length) {
    const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const hay = fold(picture);
    for (const term of expect) console.log(`[expect] ${hay.includes(fold(term)) ? "ok     " : "MISSING"} ${term}`);
  }

  if (dry) {
    console.log("[rebuild] --dry: nothing written");
    return;
  }
  if (!picture.trim()) throw new Error("rebuilt picture is empty — refusing to write");
  await writePicture(brain, spaceId, config, allowed, picture, `relationship picture rebuilt ${from} → ${to}`);
  console.log("[rebuild] wrote memory/relationship.md");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
