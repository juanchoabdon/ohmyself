/**
 * In-process scheduler (persistent host only).
 *
 * Replaces the Vercel cron: on a stable Node process we can just run a periodic
 * tick that (a) pulls new Gemini meeting notes for every auto-sync connection
 * and (b) resumes any historical backfill whose loop stalled (e.g. after a
 * process restart / deploy). No external scheduler, no 60s function cap.
 */

import { listActiveConnectionsForProvider } from "./core/index.js";
import { GOOGLE_DRIVE_MEETINGS_PROVIDER } from "./connectors/google-auth.js";
import { syncDriveConnection } from "./sync.js";
import { DISCOVER_MAX, STALL_MS, detach, runBackfillLoop } from "./backfill.js";
import { lintAllUsers, scheduledApplyMode } from "./lint.js";

/** One scheduler pass: resume stalled backfills, else incrementally sync new
 *  meetings. Safe to call from both the interval and a manual trigger. */
export async function runScheduledTick(): Promise<{ synced: number; resumed: number }> {
  const conns = await listActiveConnectionsForProvider(GOOGLE_DRIVE_MEETINGS_PROVIDER);
  let synced = 0;
  let resumed = 0;
  for (const conn of conns) {
    const bf = conn.settings?.backfill;
    if (bf?.status === "running") {
      // A backfill loop that hasn't heartbeated in a while (process restarted
      // mid-run): relaunch it in the background. Don't also full-sync mid-run.
      const last = bf.lastStepAt ? Date.parse(bf.lastStepAt) : 0;
      if (Date.now() - last > STALL_MS) {
        resumed++;
        detach(() => runBackfillLoop(conn.userId, conn.id, bf.startedAt));
      }
      continue;
    }
    if (conn.settings?.autoSync === false) continue;
    // Incremental pull of new meetings — background so one slow account doesn't
    // hold up the tick (persistent host: no timeout to worry about).
    synced++;
    detach(async () => {
      try {
        await syncDriveConnection(conn.userId, conn.id, { mode: "full", max: DISCOVER_MAX });
      } catch (err) {
        console.error(`[scheduler] sync ${conn.id} failed:`, (err as Error).message);
      }
    });
  }
  return { synced, resumed };
}

/** Start the periodic scheduler:
 *   - sync/backfill tick every SYNC_INTERVAL_MS (default 15 min)
 *   - wiki-lint tick every LINT_INTERVAL_MS (default 6h); it self-throttles to
 *     once/day per user (skips if today's `lint/<date>.md` report exists), so a
 *     redeploy won't re-lint. Disable entirely with LINT=off. */
export function startScheduler(): void {
  const everyMs = Number(process.env.SYNC_INTERVAL_MS ?? String(15 * 60 * 1000)) || 15 * 60 * 1000;
  const tick = () =>
    runScheduledTick().catch((e) => console.error("[scheduler] tick failed:", (e as Error).message));
  setTimeout(tick, 20_000);
  setInterval(tick, everyMs);
  console.log(`[scheduler] started — sync every ${Math.round(everyMs / 60000)} min`);

  if (process.env.LINT !== "off") {
    const lintMs = Number(process.env.LINT_INTERVAL_MS ?? String(6 * 60 * 60 * 1000)) || 6 * 60 * 60 * 1000;
    const lintTick = () =>
      lintAllUsers().catch((e) => console.error("[lint] tick failed:", (e as Error).message));
    setTimeout(lintTick, 90_000); // after boot, once the sync tick has settled
    setInterval(lintTick, lintMs);
    console.log(`[scheduler] wiki-lint every ${Math.round(lintMs / 3600000)}h · mode=${scheduledApplyMode()}`);
  }
}
