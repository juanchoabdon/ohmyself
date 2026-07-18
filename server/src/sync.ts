/**
 * Connection sync orchestration, shared by the manual UI routes and the cron.
 *
 * Given a stored connection, mints a fresh access token from its encrypted
 * refresh token, runs the connector's pull (which distills each source into the
 * wiki), and persists sync state (last_sync_at, seen ids, status/error) back to
 * the connection. Server-side and trusted: writes at the owner's full scope.
 */

import {
  allowedVisibilities,
  buildCore,
  getConnectionWithCredential,
  getSpaceConfig,
  updateConnection,
  type ConnectionSettings,
} from "./core/index.js";
import { GOOGLE_DRIVE_MEETINGS_PROVIDER } from "./connectors/google-auth.js";
import {
  googleDriveMeetingsConnector,
  mergeSeenIds,
  type DriveMeetingsResult,
} from "./connectors/google-drive-meetings.js";
import type { IngestMode } from "./core/index.js";

/** After this many failed ingest attempts a doc is dead-lettered: marked seen
 *  so it stops blocking the loop, with a loud log so it can be re-run manually. */
const MAX_INGEST_ATTEMPTS = 3;

export interface SyncOptions {
  mode?: IngestMode;
  dryRun?: boolean;
  /** Override the lookback for a one-off backfill. */
  lookbackMonths?: number;
  /** Process at most this many fresh candidates this call (hard cap). */
  batchSize?: number;
  /** Soft wall-clock budget (ms) per call — keep distilling until it elapses. */
  deadlineMs?: number;
  /** Discovery ceiling — how many candidates to page in from Drive (window size). */
  max?: number;
}

/** Run a sync for one Google Drive meetings connection. `spaceId` is the tenant
 *  the connection ingests into (its self or company brain). */
export async function syncDriveConnection(
  spaceId: string,
  connectionId: string,
  opts: SyncOptions = {},
): Promise<DriveMeetingsResult> {
  const conn = await getConnectionWithCredential(spaceId, connectionId);
  if (!conn) throw new Error("connection not found");
  if (conn.provider !== GOOGLE_DRIVE_MEETINGS_PROVIDER) {
    throw new Error(`unsupported provider for sync: ${conn.provider}`);
  }

  const { brain } = buildCore();
  const config = await getSpaceConfig(spaceId);
  const settings: ConnectionSettings = conn.settings ?? {};
  const allowed = allowedVisibilities("secret"); // trusted server-side write into the space's brain

  const mode: IngestMode = opts.mode ?? "full";
  const seenFull = (settings.seenFileIds as string[] | undefined) ?? [];
  const seenLight = (settings.seenLightIds as string[] | undefined) ?? [];
  // Light and full keep independent "seen" ledgers. A doc only light-processed
  // (person/concept facts, no meeting note) must NOT block a later full sync from
  // creating its meeting note + commitments — so full only skips full-seen docs.
  // Light skips both (full already covers what light does).
  const skip = mode === "light" ? [...seenFull, ...seenLight] : seenFull;

  try {
    const result = (await googleDriveMeetingsConnector.pull(
      { spaceId, brain, allowed, config },
      {
        refreshToken: conn.credential,
        mode,
        dryRun: opts.dryRun,
        lookbackMonths: opts.lookbackMonths ?? settings.lookbackMonths,
        batchSize: opts.batchSize,
        deadlineMs: opts.deadlineMs,
        max: opts.max,
        driveFolderId: settings.driveFolderId,
        visibility: settings.visibility ?? "private",
        seenFileIds: skip,
      },
    )) as DriveMeetingsResult;

    if (!opts.dryRun) {
      // Retry ledger: failed docs stay fresh (retried next sync) until they hit
      // MAX_INGEST_ATTEMPTS, then get dead-lettered into the seen list.
      const failed: Record<string, number> = { ...(settings.failedIngests ?? {}) };
      const deadLettered: string[] = [];
      for (const id of result.failedIds ?? []) {
        const attempts = (failed[id] ?? 0) + 1;
        if (attempts >= MAX_INGEST_ATTEMPTS) {
          delete failed[id];
          deadLettered.push(id);
          console.error(
            `[sync] giving up on doc ${id} after ${attempts} failed ingest attempts (marked seen)`,
          );
        } else {
          failed[id] = attempts;
        }
      }
      for (const id of result.ingestedIds ?? []) delete failed[id];

      const ingested = [...(result.ingestedIds ?? []), ...deadLettered];
      const nextSeen =
        mode === "light"
          ? { seenLightIds: mergeSeenIds(seenLight, ingested) }
          : { seenFileIds: mergeSeenIds(seenFull, ingested) };
      await updateConnection(spaceId, connectionId, {
        status: "active",
        lastSyncAt: new Date().toISOString(),
        lastError: null,
        settings: {
          ...settings,
          ...nextSeen,
          failedIngests: failed,
        },
      });
    }
    return result;
  } catch (err) {
    await updateConnection(spaceId, connectionId, {
      status: "error",
      lastError: (err as Error).message,
    });
    throw err;
  }
}
