/**
 * Trigger a full fire-and-forget backfill for a connection and keep the process
 * alive while its background loop runs (newest meeting first). Sets the
 * connection's `backfill.status = running`, which makes the Railway scheduler
 * back off (no concurrent sync → no double person-facts), and if this process
 * dies mid-run the scheduler resumes the same run on the server.
 *
 *   BACKFILL_BATCH=8 tsx src/scripts/run-full-backfill.ts --user <id> --months 3
 */
import "../env.js";
import { getConnectionWithCredential, listConnections } from "../core/index.js";
import { GOOGLE_DRIVE_MEETINGS_PROVIDER } from "../connectors/google-auth.js";
import { startBackfill } from "../backfill.js";

function argFor(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const userId = argFor("--user") ?? process.env.OHMYSELF_USER_ID;
  if (!userId) throw new Error("--user <id> required");
  const months = Number(argFor("--months") ?? "3") || 3;

  const conns = await listConnections(userId, GOOGLE_DRIVE_MEETINGS_PROVIDER);
  const conn = conns[0];
  if (!conn) throw new Error("no drive-meetings connection");

  const state = await startBackfill(userId, conn.id, months, "full");
  console.log(`started backfill: total=${state.total}, current="${state.current}"`);

  // Keep the process alive + log progress until the loop finishes.
  const timer = setInterval(async () => {
    const c = await getConnectionWithCredential(userId, conn.id);
    const bf = c?.settings?.backfill;
    if (!bf) return;
    console.log(`[${new Date().toISOString()}] ${bf.status} ${bf.done}/${bf.total} · now="${bf.current ?? ""}"`);
    if (bf.status !== "running") {
      clearInterval(timer);
      console.log("done.");
      process.exit(0);
    }
  }, 20_000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
