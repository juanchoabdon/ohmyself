import "../env.js";
import { listConnections } from "../core/index.js";
import { GOOGLE_DRIVE_MEETINGS_PROVIDER } from "../connectors/google-auth.js";
import { syncDriveConnection } from "../sync.js";

function argFor(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

/**
 * Historical backfill of Gemini meeting notes for a user.
 *
 *   tsx src/scripts/backfill.ts --user <id> [--connection <id>]
 *       [--months 12] [--full] [--dry]
 *
 * Defaults to mode=light (person facts + concepts only; no action items or
 * project updates, since that context is stale). Use --full to distill
 * everything. --dry previews the Drive candidates without writing.
 */
async function main(): Promise<void> {
  const userId = argFor("--user") ?? process.env.OHMYSELF_USER_ID;
  if (!userId) {
    console.error("Usage: tsx src/scripts/backfill.ts --user <userId> [--connection <id>] [--months 12] [--full] [--dry]");
    process.exit(1);
  }
  const months = Number(argFor("--months") ?? "12");
  const mode = hasFlag("--full") ? "full" : "light";
  const dryRun = hasFlag("--dry");
  const only = argFor("--connection");
  const batchSize = argFor("--batch") ? Number(argFor("--batch")) : undefined;
  const max = argFor("--max") ? Number(argFor("--max")) : undefined;

  let conns = await listConnections(userId, GOOGLE_DRIVE_MEETINGS_PROVIDER);
  if (only) conns = conns.filter((k) => k.id === only);
  if (conns.length === 0) {
    console.error("No Google Drive meetings connections found for this user. Connect one first.");
    process.exit(1);
  }

  console.log(
    `Backfilling ${conns.length} connection(s) — mode=${mode}, lookback=${months}mo, dryRun=${dryRun}`,
  );
  for (const conn of conns) {
    console.log(`\n▸ ${conn.accountLabel ?? conn.accountEmail ?? conn.id}`);
    try {
      const r = await syncDriveConnection(userId, conn.id, {
        mode,
        dryRun,
        lookbackMonths: months,
        batchSize,
        max,
      });
      if (dryRun) {
        console.log(`  ${r.candidates?.length ?? 0} candidate(s) in window · ${r.total ?? 0} fresh (unseen):`);
        for (const c of r.candidates ?? []) console.log(`    - [${c.modifiedTime?.slice(0, 10)}] ${c.name}`);
      } else {
        console.log(
          `  processed: ${r.processed ?? "?"}, remaining: ${r.remaining ?? "?"}, created: ${r.created.length}, updated: ${r.updated.length}, skipped: ${r.skipped.length}`,
        );
        for (const p of r.created) console.log(`    ✓ ${p}`);
        for (const p of r.updated) console.log(`    ~ ${p}`);
      }
    } catch (err) {
      console.error(`  ✗ ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error("backfill failed:", err);
  process.exit(1);
});
