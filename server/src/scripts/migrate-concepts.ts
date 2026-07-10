import "../env.js";
import { buildCore } from "../core/index.js";
import { parseNote, serializeNote } from "../core/frontmatter.js";
import type { Visibility } from "../core/types.js";

function argFor(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const DRY = process.argv.includes("--dry");
const OLD_PREFIX = "notes/concepts/";
const NEW_PREFIX = "concepts/";
const ALLOWED: Visibility[] = ["public", "private", "secret"];

/**
 * One-off: relocate concept notes from the old `notes/concepts/*` subfolder to
 * the first-class `concepts/*` pillar and retype them `note` -> `concept`.
 *
 *   tsx src/scripts/migrate-concepts.ts --user <id> [--dry]
 */
async function main(): Promise<void> {
  const userId = argFor("--user") ?? process.env.OHMYSELF_USER_ID;
  if (!userId) {
    console.error("Usage: tsx src/scripts/migrate-concepts.ts --user <userId> [--dry]");
    process.exit(1);
  }
  const { brain, vault } = buildCore();
  const paths = (await vault.listPaths(userId)).filter((p) => p.startsWith(OLD_PREFIX));
  console.log(`Found ${paths.length} concept note(s) under ${OLD_PREFIX}${DRY ? " (dry run)" : ""}`);

  let moved = 0;
  let skipped = 0;
  for (const oldPath of paths) {
    const newPath = NEW_PREFIX + oldPath.slice(OLD_PREFIX.length);
    const raw = await vault.read(userId, oldPath);
    if (raw == null) {
      skipped++;
      continue;
    }
    const { meta, body } = parseNote(raw, oldPath);
    meta.type = "concept";
    if (!meta.tags.includes("concept")) meta.tags = [...meta.tags, "concept"];

    if (DRY) {
      console.log(`  would move ${oldPath} -> ${newPath}`);
      moved++;
      continue;
    }

    const collision = await vault.read(userId, newPath);
    if (collision != null) {
      // Same concept already migrated: fold this one's body in, then drop it.
      if (body.trim()) await brain.appendToNote(userId, newPath, body.trim(), ALLOWED);
      await brain.deleteNote(userId, oldPath, ALLOWED);
      console.log(`  ~ merged ${oldPath} into existing ${newPath}`);
      moved++;
      continue;
    }
    await brain.importRaw(userId, newPath, serializeNote(meta, body));
    await brain.deleteNote(userId, oldPath, ALLOWED);
    moved++;
    console.log(`  ✓ ${oldPath} -> ${newPath}`);
  }
  console.log(`\nDone. moved=${moved}, skipped=${skipped}`);
}

main().catch((err) => {
  console.error("migrate-concepts failed:", err);
  process.exit(1);
});
