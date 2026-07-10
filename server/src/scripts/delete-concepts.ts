import "../env.js";
import { buildCore } from "../core/index.js";
import { serviceClient } from "../core/supabase.js";
import type { Visibility } from "../core/types.js";

function argFor(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const APPLY = process.argv.includes("--yes");
const ALLOWED: Visibility[] = ["public", "private", "secret"];
// Cover the first-class pillar and any lingering legacy location.
const PREFIXES = ["concepts/", "notes/concepts/"];

/**
 * One-off: delete every concept note for a user (the glossary), so it can be
 * rebuilt cleanly with the stricter distill prompt. Dry-run by default.
 *
 *   tsx src/scripts/delete-concepts.ts [--user <id>] [--yes]
 */
async function resolveUser(): Promise<string> {
  const explicit = argFor("--user") ?? process.env.OHMYSELF_USER_ID;
  if (explicit) return explicit;
  // Auto-detect: the single user that owns concept notes.
  const sb = serviceClient();
  const { data, error } = await sb
    .from("note_index")
    .select("user_id")
    .eq("type", "concept")
    .limit(100000);
  if (error) throw new Error(`could not auto-detect user: ${error.message}`);
  const users = [...new Set((data as { user_id: string }[]).map((r) => r.user_id))];
  if (users.length === 0) throw new Error("no concept notes found for any user");
  if (users.length > 1) {
    throw new Error(`multiple users have concepts (${users.join(", ")}); pass --user <id>`);
  }
  return users[0]!;
}

async function main(): Promise<void> {
  const userId = await resolveUser();
  const { brain, vault } = buildCore();
  const all = await vault.listPaths(userId);
  const paths = all.filter((p) => PREFIXES.some((pre) => p.startsWith(pre)));

  console.log(
    `User ${userId}: ${paths.length} concept note(s)${APPLY ? "" : " (dry run — pass --yes to delete)"}`,
  );
  for (const p of paths) console.log(`  - ${p}`);
  if (!APPLY || paths.length === 0) return;

  let deleted = 0;
  for (const p of paths) {
    try {
      await brain.deleteNote(userId, p, ALLOWED);
      deleted++;
    } catch (err) {
      console.error(`  ✗ ${p}: ${(err as Error).message}`);
    }
  }
  console.log(`\nDeleted ${deleted}/${paths.length} concept note(s).`);
}

main().catch((err) => {
  console.error("delete-concepts failed:", err);
  process.exit(1);
});
