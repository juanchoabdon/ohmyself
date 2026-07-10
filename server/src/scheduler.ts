/**
 * In-process scheduler (persistent host only).
 *
 * Replaces the Vercel cron: on a stable Node process we can just run a periodic
 * tick that (a) pulls new Gemini meeting notes for every auto-sync connection
 * and (b) resumes any historical backfill whose loop stalled (e.g. after a
 * process restart / deploy). No external scheduler, no 60s function cap.
 */

import {
  allowedVisibilities,
  buildCore,
  getUserConfig,
  listActiveConnectionsForProvider,
  profileStaleConcepts,
  profileStalePeople,
} from "./core/index.js";
import { GOOGLE_DRIVE_MEETINGS_PROVIDER } from "./connectors/google-auth.js";
import { syncDriveConnection } from "./sync.js";
import { DISCOVER_MAX, STALL_MS, detach, runBackfillLoop } from "./backfill.js";
import { lintAllUsers, scheduledApplyMode } from "./lint.js";

/** Keep person "Read" profiles fresh: for each user with an auto-sync connection,
 *  regenerate the read for people whose fact count changed (capped per tick so it
 *  backfills gradually without a burst of LLM calls). Disable with PROFILE=off. */
async function profileTick(): Promise<void> {
  const conns = await listActiveConnectionsForProvider(GOOGLE_DRIVE_MEETINGS_PROVIDER);
  const users = [...new Set(conns.map((c) => c.spaceId))];
  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");
  const cap = Number(process.env.PROFILE_TICK_LIMIT ?? "25") || 25;
  for (const userId of users) {
    detach(async () => {
      try {
        const config = await getUserConfig(userId);
        const r = await profileStalePeople(brain, userId, config, allowed, { limit: cap });
        if (r.profiled) console.log(`[profile] ${userId}: refreshed ${r.profiled} read(s)`);
        const c = await profileStaleConcepts(brain, userId, config, allowed, { limit: cap });
        if (c.profiled) console.log(`[profile] ${userId}: refreshed ${c.profiled} concept(s)`);
      } catch (err) {
        console.error(`[profile] ${userId} failed:`, (err as Error).message);
      }
    });
  }
}

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
        detach(() => runBackfillLoop(conn.spaceId, conn.id, bf.startedAt));
      }
      continue;
    }
    if (conn.settings?.autoSync === false) continue;
    // Incremental pull of new meetings — background so one slow account doesn't
    // hold up the tick (persistent host: no timeout to worry about).
    synced++;
    detach(async () => {
      try {
        await syncDriveConnection(conn.spaceId, conn.id, { mode: "full", max: DISCOVER_MAX });
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

  if (process.env.PROFILE !== "off") {
    const profMs = Number(process.env.PROFILE_INTERVAL_MS ?? String(3 * 60 * 60 * 1000)) || 3 * 60 * 60 * 1000;
    const profileTickSafe = () =>
      profileTick().catch((e) => console.error("[profile] tick failed:", (e as Error).message));
    setTimeout(profileTickSafe, 150_000); // after boot, once sync/lint have settled
    setInterval(profileTickSafe, profMs);
    console.log(`[scheduler] person profiles every ${Math.round(profMs / 3600000)}h`);
  }
}
