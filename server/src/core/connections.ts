/**
 * Connections: encrypted storage for external connector credentials.
 *
 * A user can connect multiple accounts per provider (unique on
 * user_id + provider + account_email). The plaintext credential (OAuth refresh
 * token, Granola API key, ...) is never stored: it is AES-256-GCM encrypted
 * with CONNECTION_ENC_KEY and only decrypted server-side when a sync runs.
 */

import crypto from "node:crypto";
import { serviceClient } from "./supabase.js";

export type ConnectionStatus = "active" | "error" | "disabled";

/** Progress of a server-side fire-and-forget run (historical backfill in `light`
 *  mode, or a "Sync now" in `full` mode), persisted on the connection so it
 *  survives the browser closing and can be polled by the UI. */
export interface BackfillState {
  status: "running" | "done" | "error";
  /** How this run distills: `light` (people/concepts only, for backfill) or
   *  `full` (meeting notes + commitments, for Sync now). Defaults to light. */
  mode?: "light" | "full";
  lookbackMonths: number;
  done: number;
  total: number;
  startedAt: string;
  /** Clean title of the transcript being distilled next (the live "now"). */
  current?: string;
  /** Most-recently finished transcripts (newest first, capped) for the live feed. */
  recent?: BackfillItem[];
  /** Heartbeat: when the last step ran (used by the cron to resume a stalled chain). */
  lastStepAt?: string;
  finishedAt?: string;
  error?: string;
}

/** One finished transcript in the live feed. */
export interface BackfillItem {
  title: string;
  outcome: "created" | "updated" | "noise" | "error";
  touched: number;
  at: string;
}

export interface ConnectionSettings {
  autoSync?: boolean;
  lookbackMonths?: number;
  /** If true, keep the raw source note (default false: distill-only). */
  keepRaw?: boolean;
  folder?: string;
  visibility?: "public" | "private" | "secret";
  /** Restrict Drive discovery to a folder id. */
  driveFolderId?: string;
  /** Drive file ids fully ingested (meeting note + commitments written). Full
   *  sync skips these; they're the source of truth for "already a real note". */
  seenFileIds?: string[];
  /** Drive file ids only light-processed (person/concept facts, no meeting note).
   *  Kept separate so a later full sync still creates their meeting notes. */
  seenLightIds?: string[];
  /** In-progress / last historical backfill. */
  backfill?: BackfillState;
  [key: string]: unknown;
}

export interface Connection {
  id: string;
  /** The space (self or company brain) this connection ingests into. */
  spaceId: string;
  /** The user who connected the account (auditing / OAuth ownership). */
  userId: string;
  provider: string;
  status: ConnectionStatus;
  accountEmail?: string;
  accountLabel?: string;
  lastSyncAt?: string;
  lastError?: string;
  settings: ConnectionSettings;
  createdAt: string;
  updatedAt: string;
}

/** A connection plus its decrypted credential (server-side use only). */
export interface ConnectionWithCredential extends Connection {
  credential: string;
}

interface ConnectionRow {
  id: string;
  space_id: string;
  user_id: string;
  provider: string;
  credential_enc: string;
  status: ConnectionStatus;
  account_email: string | null;
  account_label: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  settings: ConnectionSettings | null;
  created_at: string;
  updated_at: string;
}

// ── Encryption (AES-256-GCM) ─────────────────────────────────────────────────

function key(): Buffer {
  const secret = process.env.CONNECTION_ENC_KEY;
  if (!secret || secret.length < 16) {
    throw new Error("CONNECTION_ENC_KEY must be set (32+ random chars)");
  }
  // Derive a fixed 32-byte key from the secret regardless of its length.
  return crypto.createHash("sha256").update(secret).digest();
}

/** Encrypt to `iv.tag.ciphertext`, all base64url. */
export function encryptCredential(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptCredential(payload: string): string {
  const [ivB64, tagB64, ctB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("malformed encrypted credential");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

function toConnection(row: ConnectionRow): Connection {
  return {
    id: row.id,
    spaceId: row.space_id,
    userId: row.user_id,
    provider: row.provider,
    status: row.status,
    accountEmail: row.account_email ?? undefined,
    accountLabel: row.account_label ?? undefined,
    lastSyncAt: row.last_sync_at ?? undefined,
    lastError: row.last_error ?? undefined,
    settings: row.settings ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** List a space's connections (no credentials). Optionally filter by provider. */
export async function listConnections(spaceId: string, provider?: string): Promise<Connection[]> {
  const db = serviceClient();
  let q = db.from("connections").select("*").eq("space_id", spaceId);
  if (provider) q = q.eq("provider", provider);
  const { data, error } = await q.order("created_at", { ascending: true });
  if (error) throw new Error(`listConnections: ${error.message}`);
  return (data as ConnectionRow[]).map(toConnection);
}

/** Fetch a single connection WITH its decrypted credential, scoped to a space. */
export async function getConnectionWithCredential(
  spaceId: string,
  id: string,
): Promise<ConnectionWithCredential | null> {
  const db = serviceClient();
  const { data, error } = await db
    .from("connections")
    .select("*")
    .eq("space_id", spaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getConnection: ${error.message}`);
  if (!data) return null;
  const row = data as ConnectionRow;
  return { ...toConnection(row), credential: decryptCredential(row.credential_enc) };
}

export interface UpsertConnectionInput {
  /** The space this connection ingests into (self or company brain). */
  spaceId: string;
  /** The user who connected the account. */
  userId: string;
  provider: string;
  credential: string;
  accountEmail?: string;
  accountLabel?: string;
  settings?: ConnectionSettings;
  status?: ConnectionStatus;
}

/** Create or update a connection, keyed by (space, provider, account_email). */
export async function upsertConnection(input: UpsertConnectionInput): Promise<Connection> {
  const db = serviceClient();
  const row = {
    space_id: input.spaceId,
    user_id: input.userId,
    provider: input.provider,
    credential_enc: encryptCredential(input.credential),
    account_email: input.accountEmail ?? null,
    account_label: input.accountLabel ?? null,
    settings: input.settings ?? {},
    status: input.status ?? ("active" as ConnectionStatus),
  };
  const { data, error } = await db
    .from("connections")
    .upsert(row, { onConflict: "space_id,provider,account_email" })
    .select("*")
    .single();
  if (error) throw new Error(`upsertConnection: ${error.message}`);
  return toConnection(data as ConnectionRow);
}

export interface ConnectionStatePatch {
  status?: ConnectionStatus;
  lastSyncAt?: string;
  lastError?: string | null;
  settings?: ConnectionSettings;
  /** Rotate the stored credential (e.g. refreshed OAuth token). */
  credential?: string;
}

/** Update sync state / settings / credential for a connection, scoped to a space. */
export async function updateConnection(
  spaceId: string,
  id: string,
  patch: ConnectionStatePatch,
): Promise<void> {
  const db = serviceClient();
  const update: Record<string, unknown> = {};
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.lastSyncAt !== undefined) update.last_sync_at = patch.lastSyncAt;
  if (patch.lastError !== undefined) update.last_error = patch.lastError;
  if (patch.settings !== undefined) update.settings = patch.settings;
  if (patch.credential !== undefined) update.credential_enc = encryptCredential(patch.credential);
  if (Object.keys(update).length === 0) return;
  const { error } = await db.from("connections").update(update).eq("space_id", spaceId).eq("id", id);
  if (error) throw new Error(`updateConnection: ${error.message}`);
}

export async function deleteConnection(spaceId: string, id: string): Promise<void> {
  const db = serviceClient();
  const { error } = await db.from("connections").delete().eq("space_id", spaceId).eq("id", id);
  if (error) throw new Error(`deleteConnection: ${error.message}`);
}

/** All active connections for a provider across all users (used by the cron). */
export async function listActiveConnectionsForProvider(
  provider: string,
): Promise<Connection[]> {
  const db = serviceClient();
  const { data, error } = await db
    .from("connections")
    .select("*")
    .eq("provider", provider)
    .eq("status", "active");
  if (error) throw new Error(`listActiveConnectionsForProvider: ${error.message}`);
  return (data as ConnectionRow[]).map(toConnection);
}
