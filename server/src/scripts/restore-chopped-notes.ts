/**
 * EMERGENCY RESTORE — undo damage from the bad dedupeStackedSuffix heuristic
 * (deployed ~2026-07-16T03:47Z, removed same night). It chopped legitimate
 * notes on collab open via "repair duplicated vault on collab load" writes.
 *
 * Every write records a full version in note_versions, so we restore each
 * damaged note from the version immediately BEFORE the damaging write.
 *
 * Usage:
 *   npx tsx src/scripts/restore-chopped-notes.ts --dry-run
 *   npx tsx src/scripts/restore-chopped-notes.ts
 */
import "../env.js";
import { buildCore, allowedVisibilities, parseNote } from "../core/index.js";
import { stripRedundantTitleH1 } from "../core/titleBody.js";
import { deleteCollabState } from "../collab/state-store.js";
import { serviceClient } from "../core/supabase.js";

const dryRun = process.argv.includes("--dry-run");

// First deploy that contained dedupeStackedSuffix.
const CUTOFF = "2026-07-16T03:40:00Z";

const DAMAGING_SUMMARIES = [
  "repair duplicated vault on collab load",
  "repair duplicated collab body",
];

interface VersionRow {
  id: number;
  space_id: string;
  path: string;
  title: string;
  author: string;
  summary: string | null;
  op: string;
  raw: string | null;
  created_at: string;
}

async function findDamagingVersions(): Promise<VersionRow[]> {
  const { data, error } = await serviceClient()
    .from("note_versions")
    .select("id, space_id, path, title, author, summary, op, raw, created_at")
    .gte("created_at", CUTOFF)
    .in("summary", DAMAGING_SUMMARIES)
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as VersionRow[];
}

async function versionBefore(spaceId: string, path: string, beforeId: number): Promise<VersionRow | null> {
  const { data, error } = await serviceClient()
    .from("note_versions")
    .select("id, space_id, path, title, author, summary, op, raw, created_at")
    .eq("space_id", spaceId)
    .eq("path", path)
    .lt("id", beforeId)
    .not("raw", "is", null)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as VersionRow) ?? null;
}

async function main(): Promise<void> {
  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");

  const damaging = await findDamagingVersions();
  console.log(`found ${damaging.length} damaging writes since ${CUTOFF}\n`);

  // Restore from before the FIRST damaging write per note.
  const firstByNote = new Map<string, VersionRow>();
  for (const v of damaging) {
    const key = `${v.space_id}:${v.path}`;
    if (!firstByNote.has(key)) firstByNote.set(key, v);
  }

  let restored = 0;
  let skipped = 0;
  for (const [key, dmg] of firstByNote) {
    const prev = await versionBefore(dmg.space_id, dmg.path, dmg.id);
    if (!prev?.raw) {
      console.log(`SKIP (no prior version) ${key}`);
      skipped++;
      continue;
    }
    const prevParsed = parseNote(prev.raw, dmg.path);
    // Keep the harmless title-H1 normalization on the restored body.
    const goodBody = stripRedundantTitleH1(prevParsed.body, prevParsed.meta.title);

    const current = await brain.readNote(dmg.space_id, dmg.path, allowed).catch(() => null);
    if (!current) {
      console.log(`SKIP (unreadable now) ${key}`);
      skipped++;
      continue;
    }
    if (current.body.trim() === goodBody.trim()) {
      console.log(`OK (already matches pre-damage) ${key}`);
      skipped++;
      continue;
    }
    // Only restore if current is SHORTER than the pre-damage body (i.e. still
    // chopped). If someone made real edits after, flag for manual review.
    if (current.body.length > goodBody.length) {
      console.log(`REVIEW (current longer than pre-damage) ${key} current=${current.body.length} pre=${goodBody.length}`);
      skipped++;
      continue;
    }

    console.log(
      dryRun ? "WOULD RESTORE" : "RESTORE",
      key,
      `${current.body.length} -> ${goodBody.length} (from v${prev.id} @ ${prev.created_at})`,
    );
    if (!dryRun) {
      await brain.updateNote(dmg.space_id, dmg.path, { body: goodBody }, allowed, {
        author: "ohmyself",
        summary: "restore body chopped by bad dedupe heuristic",
      });
      await deleteCollabState(dmg.space_id, dmg.path).catch(() => {});
    }
    restored++;
  }

  console.log(`\n${dryRun ? "would restore" : "restored"} ${restored}, skipped/ok ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
