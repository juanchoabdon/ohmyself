/**
 * Relationship spaces (bonds ai-in-chat B2ext): provisioning scaffold and the
 * transcript-delta inbox.
 *
 * A relationship space is the shared brain of ONE external room. The room's
 * owner system (bonds) pushes message deltas here; the journal job distills
 * each closed day into `journal/` + `memory/` and refreshes the `_index.md`
 * postal. Raw conversation is never vault content — deltas live in their own
 * table and are marked digested after distillation, so a replay (or a
 * historical backfill) of the same events is idempotent end to end.
 */

import type { Brain } from "./brain.js";
import { NotFoundError } from "./errors.js";
import { serviceClient } from "./supabase.js";
import type { Visibility } from "./types.js";
import type { WriteAttribution } from "./versions/types.js";
import type { UserConfig } from "./config.js";

const ALL_VISIBILITIES: Visibility[] = ["public", "private", "secret"];

/** Version-history author for everything the engine maintains in a cocina. */
export const KEEPER_ATTRIBUTION: WriteAttribution = { author: "agent:bonds-keeper" };

// ── Cocina scaffold ───────────────────────────────────────────────────────────

export interface ScaffoldInput {
  name: string;
  /** Display names of the room's members, for the people.md roster. */
  members?: string[];
}

/** Create the cocina's fixed contract (`_index.md`, `people.md`, `apps.md`) if
 *  missing. Idempotent: provisioning re-fires on lifecycle events and sweeps. */
export async function scaffoldRelationshipCocina(
  brain: Brain,
  spaceId: string,
  config: UserConfig,
  input: ScaffoldInput,
): Promise<{ created: string[] }> {
  const created: string[] = [];
  const stubs: { path: string; title: string; body: string }[] = [
    {
      path: "_index.md",
      title: input.name,
      body: [
        "Postal of this relationship's brain. The keeper regenerates this note",
        "after each journal pass: what this room is about, what's alive right",
        "now, and where to look next.",
        "",
        "_No journal has been distilled yet._",
      ].join("\n"),
    },
    {
      path: "people.md",
      title: "People",
      body: peopleBody(input.members ?? []),
    },
    {
      path: "apps.md",
      title: "Apps",
      body: "Map of this room's apps. Maintained by the keeper from the room's app digest.\n\n_No apps yet._",
    },
  ];
  for (const stub of stubs) {
    const exists = await brain
      .readNote(spaceId, stub.path, ALL_VISIBILITIES)
      .then(() => true)
      .catch((err) => {
        if (err instanceof NotFoundError) return false;
        throw err;
      });
    if (exists) continue;
    await brain.createNote(
      spaceId,
      { type: "note", title: stub.title, body: stub.body, path: stub.path, visibility: "secret" },
      config,
      ALL_VISIBILITIES,
      KEEPER_ATTRIBUTION,
    );
    created.push(stub.path);
  }
  return { created };
}

function peopleBody(members: string[]): string {
  const header = "Roles and voice of this room's members. Never diagnoses or psychological profiles.";
  if (members.length === 0) return `${header}\n\n_No roster yet._`;
  return `${header}\n\n${members.map((m) => `- ${m}`).join("\n")}`;
}

// ── Transcript deltas ─────────────────────────────────────────────────────────

export interface TranscriptMessage {
  /** Source event id (e.g. a Matrix event id) — dedupes replays and backfills. */
  external_id?: string;
  /** Display name of who spoke — pass-through attribution, not an ohmyself user. */
  author: string;
  /** When it was said (ISO timestamp). */
  at: string;
  /** `text` (default), or a derived understanding: `voice_transcript`,
   *  `image_description`, `file_summary`, `link_summary`, `system`. */
  kind?: string;
  body: string;
  /** Local day (YYYY-MM-DD) in the ROOM's timezone. The pusher owns the day
   *  boundary; defaults to the UTC date of `at`. */
  day?: string;
}

export interface IngestDeltasResult {
  accepted: number;
  duplicates: number;
}

const MAX_BATCH = 500;
const MAX_BODY_CHARS = 8_000;

function dayOf(msg: TranscriptMessage): string {
  if (msg.day && /^\d{4}-\d{2}-\d{2}$/.test(msg.day)) return msg.day;
  return new Date(msg.at).toISOString().slice(0, 10);
}

/** Store a batch of message deltas for a relationship space. Rows carrying an
 *  `external_id` upsert-ignore (replay-safe); rows without one always insert. */
export async function ingestTranscriptDeltas(
  spaceId: string,
  messages: TranscriptMessage[],
): Promise<IngestDeltasResult> {
  if (messages.length === 0) return { accepted: 0, duplicates: 0 };
  if (messages.length > MAX_BATCH) {
    throw new Error(`batch too large (${messages.length} > ${MAX_BATCH})`);
  }
  const rows = messages.map((m) => ({
    space_id: spaceId,
    day: dayOf(m),
    at: new Date(m.at).toISOString(),
    author: m.author.slice(0, 120),
    kind: (m.kind ?? "text").slice(0, 40),
    body: m.body.slice(0, MAX_BODY_CHARS),
    external_id: m.external_id ?? null,
  }));

  const sb = serviceClient();
  const keyed = rows.filter((r) => r.external_id !== null);
  const anonymous = rows.filter((r) => r.external_id === null);

  let accepted = 0;
  if (keyed.length > 0) {
    const { data, error } = await sb
      .from("transcript_deltas")
      .upsert(keyed, { onConflict: "space_id,external_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`delta upsert failed: ${error.message}`);
    accepted += (data ?? []).length;
  }
  if (anonymous.length > 0) {
    const { data, error } = await sb.from("transcript_deltas").insert(anonymous).select("id");
    if (error) throw new Error(`delta insert failed: ${error.message}`);
    accepted += (data ?? []).length;
  }
  return { accepted, duplicates: rows.length - accepted };
}

export interface PendingDay {
  spaceId: string;
  day: string;
}

/** Space+day pairs with undigested deltas strictly before `beforeDay` — the
 *  journal job's queue. Oldest days first so backfills distill in order. */
export async function pendingJournalDays(beforeDay: string, cap = 5000): Promise<PendingDay[]> {
  const sb = serviceClient();
  const { data, error } = await sb
    .from("transcript_deltas")
    .select("space_id, day")
    .is("digested_at", null)
    .lt("day", beforeDay)
    .order("day", { ascending: true })
    .limit(cap);
  if (error) throw new Error(`pending days failed: ${error.message}`);
  const seen = new Set<string>();
  const out: PendingDay[] = [];
  for (const row of (data ?? []) as { space_id: string; day: string }[]) {
    const key = `${row.space_id}|${row.day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ spaceId: row.space_id, day: row.day });
  }
  return out;
}

export interface DeltaRow {
  at: string;
  author: string;
  kind: string;
  body: string;
}

/** One day's deltas in spoken order (capped — a chattier day than this gets
 *  its head distilled rather than failing). */
export async function readDeltas(spaceId: string, day: string, cap = 4000): Promise<DeltaRow[]> {
  const sb = serviceClient();
  const { data, error } = await sb
    .from("transcript_deltas")
    .select("at, author, kind, body")
    .eq("space_id", spaceId)
    .eq("day", day)
    .is("digested_at", null)
    .order("at", { ascending: true })
    .limit(cap);
  if (error) throw new Error(`read deltas failed: ${error.message}`);
  return (data ?? []) as DeltaRow[];
}

export async function markDeltasDigested(spaceId: string, day: string): Promise<void> {
  const sb = serviceClient();
  const { error } = await sb
    .from("transcript_deltas")
    .update({ digested_at: new Date().toISOString() })
    .eq("space_id", spaceId)
    .eq("day", day)
    .is("digested_at", null);
  if (error) throw new Error(`mark digested failed: ${error.message}`);
}
