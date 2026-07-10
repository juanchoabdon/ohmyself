/**
 * Server-side fire-and-forget ingest run.
 *
 * On a persistent host (Railway/Render/etc.) there is no per-request timeout, so
 * a run is simply a background loop that distills one transcript at a time,
 * persisting progress to the connection (`settings.backfill`) after each so the
 * UI can poll it live and the browser can be closed at any time. If the process
 * restarts mid-run, the scheduler resumes any `running` backfill whose heartbeat
 * (`lastStepAt`) went stale.
 *
 * `light` = historical backfill (people/concepts only). `full` = "Sync now"
 * (meeting notes + commitments).
 */

import { waitUntil } from "@vercel/functions";
import {
  getConnectionWithCredential,
  updateConnection,
  type BackfillItem,
  type BackfillState,
} from "./core/index.js";
import { syncDriveConnection } from "./sync.js";

/** Transcripts per loop iteration. One keeps the live feed smooth (progress is
 *  written after each), and on a persistent host there's no timeout to beat. */
const BATCH = Number(process.env.BACKFILL_BATCH ?? "1") || 1;
/** How many candidates to page in from Drive per iteration (window ceiling). */
export const DISCOVER_MAX = 2000;
/** Keep the live feed short — the newest handful of finished transcripts. */
const RECENT_CAP = 8;
/** A run is considered stalled (resumable by the scheduler) after this long. */
export const STALL_MS = 5 * 60 * 1000;

/** Run `work` in the background. On a persistent server the promise simply runs
 *  to completion on the process; `waitUntil` (if present, e.g. a serverless
 *  runtime) keeps the invocation alive until it settles. */
export function detach(work: () => Promise<void>): void {
  const p = work().catch((e) => console.error("[backfill] run failed:", (e as Error).message));
  try {
    waitUntil(p);
  } catch {
    /* not in a serverless request context: the process stays alive, p runs */
  }
}

/** Merge a patch into the connection's backfill state, preserving whatever the
 *  sync just wrote (e.g. the grown seenFileIds list) and bumping the heartbeat. */
async function patchBackfill(
  userId: string,
  connectionId: string,
  patch: Partial<BackfillState>,
): Promise<void> {
  const conn = await getConnectionWithCredential(userId, connectionId);
  if (!conn) return;
  const cur = (conn.settings?.backfill ?? {}) as BackfillState;
  const next: BackfillState = { ...cur, ...patch, lastStepAt: new Date().toISOString() };
  await updateConnection(userId, connectionId, { settings: { ...conn.settings, backfill: next } });
}

/** Kick off a run and return its initial state. Counts the fresh candidates in
 *  the window, persists a `running` state, and launches the background loop.
 *  Idempotent per connection: a new call supersedes the old loop via a fresh
 *  `startedAt` run token. */
export async function startBackfill(
  userId: string,
  connectionId: string,
  lookbackMonths: number,
  mode: "light" | "full" = "light",
): Promise<BackfillState> {
  const conn = await getConnectionWithCredential(userId, connectionId);
  if (!conn) throw new Error("connection not found");

  const preview = await syncDriveConnection(userId, connectionId, {
    mode,
    dryRun: true,
    lookbackMonths,
    max: DISCOVER_MAX,
  });
  const total = preview.total ?? preview.candidates?.length ?? 0;
  const now = new Date().toISOString();
  const state: BackfillState = {
    status: total > 0 ? "running" : "done",
    mode,
    lookbackMonths,
    done: 0,
    total,
    startedAt: now,
    lastStepAt: now,
    current: total > 0 ? preview.nextTitle : undefined,
    recent: [],
    ...(total > 0 ? {} : { finishedAt: now }),
  };
  await updateConnection(userId, connectionId, { settings: { ...conn.settings, backfill: state } });
  if (total > 0) detach(() => runBackfillLoop(userId, connectionId, state.startedAt));
  return state;
}

/** Background loop: distill BATCH transcripts, persist progress, repeat until
 *  none remain. Stops early if the run was superseded (newer `startedAt`), the
 *  status changed, or the connection vanished. */
export async function runBackfillLoop(
  userId: string,
  connectionId: string,
  runToken: string,
): Promise<void> {
  for (;;) {
    const conn = await getConnectionWithCredential(userId, connectionId);
    if (!conn) return;
    const bf = conn.settings?.backfill;
    if (!bf || bf.status !== "running") return;
    if (runToken && bf.startedAt !== runToken) return; // a newer run took over

    let result;
    try {
      result = await syncDriveConnection(userId, connectionId, {
        mode: bf.mode ?? "light",
        lookbackMonths: bf.lookbackMonths,
        batchSize: BATCH,
        max: DISCOVER_MAX,
      });
    } catch (err) {
      await patchBackfill(userId, connectionId, {
        status: "error",
        error: (err as Error).message,
        finishedAt: new Date().toISOString(),
      });
      return;
    }

    const processed = result.processed ?? 0;
    const remaining = result.remaining ?? 0;
    const done = bf.done + processed;
    const total = Math.max(bf.total, done + remaining);

    const at = new Date().toISOString();
    const justDone: BackfillItem[] = (result.items ?? []).map((it) => ({ ...it, at }));
    const recent = [...justDone, ...(bf.recent ?? [])].slice(0, RECENT_CAP);

    if (remaining > 0 && processed > 0) {
      await patchBackfill(userId, connectionId, {
        status: "running",
        done,
        total,
        current: result.nextTitle,
        recent,
      });
      continue; // keep distilling — no HTTP hop, no timeout
    }
    await patchBackfill(userId, connectionId, {
      status: "done",
      done,
      total,
      current: undefined,
      recent,
      finishedAt: at,
    });
    return;
  }
}
