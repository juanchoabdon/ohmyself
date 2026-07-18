/**
 * Repair vault bodies duplicated N times by the collab race, and wipe the
 * matching collab_docs row so the next open hydrates from the clean vault.
 *
 * Usage:
 *   npx tsx src/scripts/fix-collab-dupes.ts --dry-run
 *   npx tsx src/scripts/fix-collab-dupes.ts --space <uuid>
 *   npx tsx src/scripts/fix-collab-dupes.ts --path strategy/foo.md --space <uuid>
 */
import "../env.js";
import { buildCore, allowedVisibilities } from "../core/index.js";
import { repairCollabBody } from "../core/dedupeBody.js";
import { serviceClient } from "../core/supabase.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const spaceArg = args.find((a) => a.startsWith("--space="))?.slice("--space=".length);
const pathArg = args.find((a) => a.startsWith("--path="))?.slice("--path=".length);

async function deleteCollabState(spaceId: string, path: string): Promise<void> {
  const { error } = await serviceClient()
    .from("collab_docs")
    .delete()
    .eq("space_id", spaceId)
    .eq("path", path);
  if (error) throw new Error(error.message);
}

async function listSpaceIds(): Promise<Array<{ id: string; slug: string; name: string }>> {
  const { data, error } = await serviceClient().from("spaces").select("id,slug,name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; slug: string; name: string }>;
}

async function listAllNotePaths(spaceId: string, allowed: ReturnType<typeof allowedVisibilities>): Promise<string[]> {
  const paths: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await serviceClient()
      .from("note_index")
      .select("path")
      .eq("space_id", spaceId)
      .in("visibility", allowed)
      .order("path", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as Array<{ path: string }>;
    paths.push(...batch.map((r) => r.path));
    if (batch.length < PAGE) break;
  }
  return paths;
}

async function main(): Promise<void> {
  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");
  const spaces = spaceArg
    ? [{ id: spaceArg, slug: "?", name: "?" }]
    : await listSpaceIds();

  let fixed = 0;
  let scanned = 0;
  for (const space of spaces) {
    const notePaths = pathArg ? [pathArg] : await listAllNotePaths(space.id, allowed);
    console.log(`\n[${space.slug ?? space.name}] ${notePaths.length} notes`);

    for (const notePath of notePaths) {
      scanned++;
      if (scanned % 100 === 0) process.stdout.write(`  scanned ${scanned}...\n`);
      let note;
      try {
        note = await brain.readNote(space.id, notePath, allowed);
      } catch {
        continue;
      }
      const { body, deduped } = repairCollabBody(note.body);
      if (!deduped) continue;

      console.log(
        dryRun ? "WOULD FIX" : "FIX",
        `${space.slug ?? space.name}:${notePath}`,
        `${note.body.length} -> ${body.length}`,
      );
      if (!dryRun) {
        await brain.updateNote(space.id, notePath, { body }, allowed, {
          author: "ohmyself",
          summary: "repair duplicated collab body",
        });
        await deleteCollabState(space.id, notePath).catch(() => {
          /* row may not exist */
        });
      }
      fixed++;
    }
  }

  console.log(`\n${dryRun ? "would fix" : "fixed"} ${fixed} / ${scanned} scanned`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
