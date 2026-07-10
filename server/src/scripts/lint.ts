import "../env.js";
import { runWikiLint } from "../lint.js";
import { serviceClient } from "../core/supabase.js";

/**
 * Run the wiki-lint pass on demand (Karpathy's Lint operation).
 *
 *   tsx src/scripts/lint.ts [--user <id>] [--apply]
 *
 * Default is PROPOSE-ONLY (writes a dated `lint/<date>.md` report, changes
 * nothing). Pass --apply to auto-apply high-confidence merges this run.
 */

function argFor(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function resolveUser(): Promise<string> {
  const explicit = argFor("--user") ?? process.env.OHMYSELF_USER_ID;
  if (explicit) return explicit;
  const sb = serviceClient();
  const { data, error } = await sb.from("connections").select("user_id").limit(1000);
  if (error) throw new Error(`could not auto-detect user: ${error.message}`);
  const users = [...new Set((data as { user_id: string }[]).map((r) => r.user_id))];
  if (users.length === 0) throw new Error("no connections found; pass --user <id>");
  if (users.length > 1) throw new Error(`multiple users (${users.join(", ")}); pass --user <id>`);
  return users[0]!;
}

async function main(): Promise<void> {
  const userId = await resolveUser();
  const apply = process.argv.includes("--apply") ? "high" : "propose";
  console.log(`Linting user ${userId} · mode=${apply}\n`);
  const report = await runWikiLint(userId, { apply });

  console.log(`Scanned ${report.pagesScanned} pages, considered ${report.candidatesConsidered} pairs.`);
  const applied = report.merges.filter((m) => m.applied);
  const proposed = report.merges.filter((m) => !m.applied);
  console.log(`\nMerged (${applied.length}):`);
  for (const m of applied) console.log(`  ${m.keep} ⟵ ${m.drop}  (sim ${m.score}, conf ${m.confidence.toFixed(2)})`);
  console.log(`\nProposed, not applied (${proposed.length}):`);
  for (const m of proposed)
    console.log(`  ${m.keep} ⟵ ${m.drop}  (sim ${m.score}, conf ${m.confidence.toFixed(2)}) — ${m.reason}`);
  console.log(`\nReport saved to lint/${new Date().toISOString().slice(0, 10)}.md`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("lint failed:", err);
    process.exit(1);
  });
