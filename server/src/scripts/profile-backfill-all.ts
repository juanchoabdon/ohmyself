/**
 * One-time "repasada": force-regenerate every person's synthesized Read AND
 * re-infer their identity headline from ALL accrued facts, across EVERY ohmyself
 * user (not just one). Older headlines were frozen from whatever the first
 * meeting stated; this refreshes them with the improved profiling prompt.
 *
 * The ongoing scheduler (profileTick, every 3h) keeps them fresh from then on —
 * this script is just to fix the existing backlog in one pass.
 *
 *   tsx src/scripts/profile-backfill-all.ts                 # all users, force
 *   tsx src/scripts/profile-backfill-all.ts --user <id>     # a single user
 *   tsx src/scripts/profile-backfill-all.ts --conc 4 --min 3 --limit 5000
 *   tsx src/scripts/profile-backfill-all.ts --stale         # only stale (no force)
 */
import "../env.js";
import {
  allowedVisibilities,
  buildCore,
  getUserConfig,
  listActiveConnectionsForProvider,
  profileStalePeople,
} from "../core/index.js";
import { GOOGLE_DRIVE_MEETINGS_PROVIDER } from "../connectors/google-auth.js";

function argFor(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<void> {
  const only = argFor("--user");
  const force = !hasFlag("--stale"); // default: force-refresh everyone
  const minFacts = Number(argFor("--min") ?? "3") || 3;
  const limit = Number(argFor("--limit") ?? "5000") || 5000;
  const concurrency = Number(argFor("--conc") ?? "4") || 4;

  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");

  let userIds: string[];
  if (only) {
    userIds = [only];
  } else {
    const conns = await listActiveConnectionsForProvider(GOOGLE_DRIVE_MEETINGS_PROVIDER);
    userIds = Array.from(new Set(conns.map((c) => c.userId)));
  }

  console.log(
    `Profile backfill — users=${userIds.length} force=${force} min=${minFacts} conc=${concurrency}`,
  );

  const totals = { scanned: 0, profiled: 0, skipped: 0, errors: 0 };
  for (const userId of userIds) {
    try {
      const config = await getUserConfig(userId);
      const r = await profileStalePeople(brain, userId, config, allowed, {
        minFacts,
        force,
        limit,
        concurrency,
      });
      totals.scanned += r.scanned;
      totals.profiled += r.profiled;
      totals.skipped += r.skipped;
      totals.errors += r.errors;
      console.log(
        `  ${userId}: scanned=${r.scanned} profiled=${r.profiled} skipped=${r.skipped} errors=${r.errors}`,
      );
    } catch (err) {
      console.error(`  ${userId} FAILED:`, (err as Error).message);
    }
  }

  console.log(
    `\nDone. scanned=${totals.scanned} profiled=${totals.profiled} skipped=${totals.skipped} errors=${totals.errors}`,
  );
}

main().catch((e) => {
  console.error("profile-backfill-all failed:", e);
  process.exit(1);
});
