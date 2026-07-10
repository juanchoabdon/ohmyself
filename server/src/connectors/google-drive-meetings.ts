/**
 * Google Drive / Gemini meeting-notes connector.
 *
 * Discovers Gemini-generated meeting notes in a user's Drive (Google Docs whose
 * title matches the Gemini pattern) and runs each through the ingest pipeline
 * (distill -> wiki). The raw doc text is never stored: only the distilled
 * signal, with a link back to the Drive doc as the immutable source.
 *
 * Dedup is by Drive file id: previously-ingested ids are tracked in the
 * connection settings so re-runs are idempotent.
 */

import { ingest, type IngestMode } from "../core/index.js";
import {
  GOOGLE_DRIVE_MEETINGS_PROVIDER,
  refreshAccessToken,
} from "./google-auth.js";
import { type Connector, type ConnectorContext, type PullResult, emptyResult } from "./types.js";

/** Default Drive `name contains` term. Broad on purpose: Gemini localizes its
 *  suffix ("Notes by Gemini" / "Notas de Gemini" / "Notizen von Gemini" …), so
 *  we match the one constant token ("Gemini") in the query and then tighten with
 *  GEMINI_SUFFIX_RE client-side. Matching only the English phrase silently
 *  dropped every Spanish/other-locale meeting note. */
const DEFAULT_TITLE_MATCH = "Gemini";
/** Gemini's auto-note filename suffix across locales, e.g.
 *  "… - Notes by Gemini", "… - Notas de Gemini", "… - Notas do Gemini",
 *  "… - Notizen von Gemini", optionally followed by "(English)" / "(Spanish)". */
const GEMINI_SUFFIX_RE =
  /\s*[-–—]\s*(notes?|notas?|notizen|note|notities|anteckningar|notas de reuni[oó]n)\s+(by|de|do|di|von|par|van)\s+gemini\s*(\([^)]*\))?\s*$/i;

/** True when a Drive doc name looks like a real Gemini meeting note (vs. a doc
 *  that merely mentions "Gemini" in its title). */
export function isGeminiNote(name: string): boolean {
  return GEMINI_SUFFIX_RE.test(name);
}
const DRIVE_MIME_DOC = "application/vnd.google-apps.document";
const MAX_SEEN_IDS = 1000;

export interface DriveNoteCandidate {
  id: string;
  name: string;
  modifiedTime?: string;
  createdTime?: string;
  webViewLink?: string;
}

export interface DriveMeetingsOptions {
  /** OAuth access token (tests / direct calls). */
  accessToken?: string;
  /** Or a refresh token to mint one. */
  refreshToken?: string;
  /** Only discover; do not ingest. Returns candidates in `candidates`. */
  dryRun?: boolean;
  /** ISO floor for modifiedTime. Overrides lookbackMonths when set. */
  sinceIso?: string;
  lookbackMonths?: number;
  /** Restrict to a Drive folder id. */
  driveFolderId?: string;
  /** Title substring to match. */
  titleMatch?: string;
  /** Drive file ids already ingested (dedup). */
  seenFileIds?: string[];
  /** Cap the number of candidates discovered per run (window ceiling). */
  max?: number;
  /** Process at most this many fresh candidates this call (hard cap). */
  batchSize?: number;
  /** Soft wall-clock budget (ms) per call: keep distilling until this elapses,
   *  then stop and report `remaining` so the caller can continue. Lets one
   *  serverless invocation do as many transcripts as safely fit under its
   *  timeout instead of one-per-HTTP-hop. Always does at least one. */
  deadlineMs?: number;
  mode?: IngestMode;
  visibility?: "public" | "private" | "secret";
}

/** What happened to one transcript in a step — powers the live UI feed. */
export interface DriveMeetingItem {
  title: string;
  outcome: "created" | "updated" | "noise" | "error";
  /** Number of wiki pages the meeting touched (people/projects/concepts). */
  touched: number;
}

export interface DriveMeetingsResult extends PullResult {
  candidates?: DriveNoteCandidate[];
  /** Drive file ids ingested this run (append to connection.settings.seenFileIds). */
  ingestedIds?: string[];
  /** Fresh candidates handled this call (success + noise + error). */
  processed?: number;
  /** Fresh candidates still pending after this call. */
  remaining?: number;
  /** Fresh candidates at the start of this call (= processed + remaining). */
  total?: number;
  /** Per-transcript outcomes handled this call (for the live feed). */
  items?: DriveMeetingItem[];
  /** Clean title of the next fresh transcript (the one nurturing next). */
  nextTitle?: string;
}

function sinceFloor(opts: DriveMeetingsOptions): string {
  if (opts.sinceIso) return opts.sinceIso;
  const months = opts.lookbackMonths ?? 3;
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
}

/** Strip Gemini's filename cruft to a clean meeting title + detected language.
 *  Gemini names docs "<title> - <YYYY/MM/DD HH:MM TZ> - Notes by Gemini [(Lang)]",
 *  and emits a separate doc per language for bilingual meetings. */
export function normalizeGeminiName(name: string): { title: string; lang?: string } {
  let t = name;
  let lang: string | undefined;
  const langM = /\s*\(([^)]*)\)\s*$/.exec(t);
  if (langM && /(english|spanish|espa|ingl|portug|français|french)/i.test(langM[1] ?? "")) {
    lang = (langM[1] ?? "").trim().toLowerCase();
    t = t.slice(0, langM.index);
  }
  t = t.replace(GEMINI_SUFFIX_RE, "");
  // Drop a trailing " - <date/time …>" (e.g. "2026/07/01 10:01 GMT-05:00").
  t = t.replace(/\s*-\s*\d{4}\/\d{2}\/\d{2}[\sT][^-]*$/i, "");
  return { title: t.trim() || name.trim(), lang };
}

/** A stable key identifying one meeting regardless of language: clean title +
 *  its date. Recurring meetings on different days stay distinct. */
function meetingKey(c: DriveNoteCandidate): string {
  const { title } = normalizeGeminiName(c.name);
  const dm = /(\d{4})\/(\d{2})\/(\d{2})/.exec(c.name);
  const date = dm
    ? `${dm[1]}-${dm[2]}-${dm[3]}`
    : (c.createdTime ?? c.modifiedTime ?? "").slice(0, 10);
  return `${title.toLowerCase()}|${date}`;
}

/** Collapse Gemini's per-language duplicates to ONE doc per meeting so we don't
 *  distill (and bill, and double person-facts on) the same meeting twice.
 *  Preference: a doc with no language tag, else Spanish (owner's primary), else
 *  the first seen. */
export function dedupeByMeeting(cands: DriveNoteCandidate[]): DriveNoteCandidate[] {
  const byKey = new Map<string, DriveNoteCandidate>();
  const rank = (lang?: string) => (lang ? (/espa/.test(lang) ? 1 : 2) : 0);
  for (const c of cands) {
    const k = meetingKey(c);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, c);
      continue;
    }
    if (rank(normalizeGeminiName(c.name).lang) < rank(normalizeGeminiName(prev.name).lang)) {
      byKey.set(k, c);
    }
  }
  return [...byKey.values()];
}

async function resolveAccessToken(opts: DriveMeetingsOptions): Promise<string> {
  if (opts.accessToken) return opts.accessToken;
  if (opts.refreshToken) return (await refreshAccessToken(opts.refreshToken)).accessToken;
  throw new Error("google-drive-meetings: no accessToken or refreshToken provided");
}

interface DriveListResponse {
  files?: {
    id: string;
    name: string;
    modifiedTime?: string;
    createdTime?: string;
    webViewLink?: string;
  }[];
  nextPageToken?: string;
}

/** Discover Gemini meeting-note docs. Read-only; safe for dry-run preview. */
export async function discoverGeminiNotes(
  accessToken: string,
  opts: DriveMeetingsOptions = {},
): Promise<DriveNoteCandidate[]> {
  const titleMatch = opts.titleMatch ?? DEFAULT_TITLE_MATCH;
  // When using the default broad term, tighten to real Gemini notes client-side
  // (Drive's `contains` can't express the localized suffix). A custom titleMatch
  // is taken at face value.
  const strict = !opts.titleMatch;
  const clauses = [
    `mimeType='${DRIVE_MIME_DOC}'`,
    `name contains '${titleMatch.replace(/'/g, "\\'")}'`,
    `modifiedTime > '${sinceFloor(opts)}'`,
    "trashed=false",
  ];
  if (opts.driveFolderId) clauses.push(`'${opts.driveFolderId}' in parents`);
  const q = clauses.join(" and ");

  const out: DriveNoteCandidate[] = [];
  let pageToken: string | undefined;
  const cap = opts.max ?? 100;
  do {
    const params = new URLSearchParams({
      q,
      orderBy: "modifiedTime desc",
      pageSize: "100",
      fields: "nextPageToken, files(id, name, modifiedTime, createdTime, webViewLink)",
      spaces: "drive",
      corpora: "user",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Drive files.list failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as DriveListResponse;
    for (const f of data.files ?? []) {
      if (strict && !isGeminiNote(f.name)) continue;
      out.push(f);
      if (out.length >= cap) return out;
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

/** Export a Google Doc as plain text. */
export async function exportDocText(accessToken: string, fileId: string): Promise<string> {
  const params = new URLSearchParams({ mimeType: "text/plain" });
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/export?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Drive export failed: ${res.status} ${await res.text()}`);
  return res.text();
}

export const googleDriveMeetingsConnector: Connector<DriveMeetingsOptions> = {
  id: GOOGLE_DRIVE_MEETINGS_PROVIDER,
  label: "Google Drive (Gemini meeting notes)",
  description:
    "Discovers Gemini meeting notes in Google Drive and distills each into the wiki (people, projects, commitments). Raw docs are never stored.",

  async pull(ctx: ConnectorContext, options: DriveMeetingsOptions = {}): Promise<DriveMeetingsResult> {
    const accessToken = await resolveAccessToken(options);
    // Collapse Gemini's per-language duplicate docs to one per meeting up front,
    // so neither the preview count nor the ingest double-counts a meeting.
    const candidates = dedupeByMeeting(await discoverGeminiNotes(accessToken, options));
    const seen = new Set(options.seenFileIds ?? []);
    const fresh = candidates.filter((c) => !seen.has(c.id));

    if (options.dryRun) {
      return {
        ...emptyResult(),
        candidates,
        skipped: candidates.map((c) => c.name),
        processed: 0,
        remaining: fresh.length,
        total: fresh.length,
        nextTitle: fresh[0] ? normalizeGeminiName(fresh[0].name).title : undefined,
      };
    }

    // Process fresh candidates until we hit the hard cap (batchSize) OR the soft
    // wall-clock budget (deadlineMs), whichever comes first — always at least one.
    // This lets a single invocation distill many transcripts (few HTTP hops =
    // faster + far less chance of a self-triggering chain stalling), while never
    // starting work that would blow past the serverless timeout.
    const cap = options.batchSize && options.batchSize > 0 ? options.batchSize : fresh.length;
    const limit = Math.min(cap, fresh.length);
    const startedAt = Date.now();

    const result: DriveMeetingsResult = { ...emptyResult(), ingestedIds: [], items: [] };
    let done = 0;
    for (let i = 0; i < limit; i++) {
      if (i > 0 && options.deadlineMs && Date.now() - startedAt > options.deadlineMs) break;
      const c = fresh[i]!;
      done = i + 1;
      const title = normalizeGeminiName(c.name).title;
      try {
        const rawText = await exportDocText(accessToken, c.id);
        const r = await ingest(ctx.brain, ctx.spaceId, ctx.config, ctx.allowed, {
          kind: "meeting",
          rawText,
          title,
          date: (c.createdTime ?? c.modifiedTime ?? "").slice(0, 10) || undefined,
          sourceUrl: c.webViewLink ?? `https://drive.google.com/open?id=${c.id}`,
          mode: options.mode ?? "full",
          visibility: options.visibility,
        });
        // Mark seen regardless of outcome so re-runs don't reprocess it.
        result.ingestedIds!.push(c.id);
        if (r.isNoise) {
          result.skipped.push(`${c.name} (noise)`);
          result.items!.push({ title, outcome: "noise", touched: 0 });
        } else if (r.meetingPath) {
          result.created.push(r.meetingPath);
          result.items!.push({ title, outcome: "created", touched: r.touched.length });
        } else {
          result.updated.push(`${c.name} (${r.touched.length} pages)`);
          result.items!.push({ title, outcome: "updated", touched: r.touched.length });
        }
      } catch (err) {
        // Mark seen on error too, so a persistently failing doc can't stall the loop.
        result.ingestedIds!.push(c.id);
        result.skipped.push(`${c.name} (error: ${(err as Error).message})`);
        result.items!.push({ title, outcome: "error", touched: 0 });
      }
    }
    result.processed = done;
    result.remaining = Math.max(0, fresh.length - done);
    result.total = fresh.length;
    result.nextTitle = fresh[done] ? normalizeGeminiName(fresh[done]!.name).title : undefined;
    return result;
  },
};

/** Merge newly-ingested ids into a capped seen list for the connection. */
export function mergeSeenIds(existing: string[] | undefined, added: string[] | undefined): string[] {
  const merged = [...(added ?? []), ...(existing ?? [])];
  return Array.from(new Set(merged)).slice(0, MAX_SEEN_IDS);
}
