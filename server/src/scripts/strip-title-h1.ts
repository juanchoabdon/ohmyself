/**
 * One-time cleanup: remove a leading `# Title` H1 from note bodies when it just
 * duplicates the frontmatter title (which the app already renders as the
 * header). New writes are handled centrally in brain.createNote/updateNote.
 *
 * Usage:
 *   npx tsx src/scripts/strip-title-h1.ts --dry-run
 *   npx tsx src/scripts/strip-title-h1.ts --space=<uuid>
 *   npx tsx src/scripts/strip-title-h1.ts
 */
import "../env.js";
import { buildCore, allowedVisibilities } from "../core/index.js";
import { stripRedundantTitleH1 } from "../core/titleBody.js";
import { serviceClient } from "../core/supabase.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const spaceArg = args.find((a) => a.startsWith("--space="))?.slice("--space=".length);

async function listSpaces(): Promise<Array<{ id: string; slug: string; name: string }>> {
  const { data, error } = await serviceClient().from("spaces").select("id,slug,name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; slug: string; name: string }>;
}

async function listAllNotePaths(
  spaceId: string,
  allowed: ReturnType<typeof allowedVisibilities>,
): Promise<string[]> {
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
  const spaces = spaceArg ? [{ id: spaceArg, slug: "?", name: "?" }] : await listSpaces();

  let fixed = 0;
  let scanned = 0;
  for (const space of spaces) {
    const notePaths = await listAllNotePaths(space.id, allowed);
    console.log(`\n[${space.slug ?? space.name}] ${notePaths.length} notes`);

    for (const notePath of notePaths) {
      scanned++;
      if (scanned % 200 === 0) process.stdout.write(`  scanned ${scanned}...\n`);
      let note;
      try {
        note = await brain.readNote(space.id, notePath, allowed);
      } catch {
        continue;
      }
      const stripped = stripRedundantTitleH1(note.body, note.meta.title);
      if (stripped === note.body) continue;

      console.log(
        dryRun ? "WOULD STRIP" : "STRIP",
        `${space.slug ?? space.name}:${notePath}`,
        `${note.body.length} -> ${stripped.length}`,
      );
      if (!dryRun) {
        await brain.updateNote(space.id, notePath, { body: stripped }, allowed, {
          author: "ohmyself",
          summary: "strip redundant title H1",
        });
      }
      fixed++;
    }
  }

  console.log(`\n${dryRun ? "would strip" : "stripped"} ${fixed} / ${scanned} scanned`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
