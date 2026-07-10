"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { BackfillState, Connection, DriveNoteCandidate } from "@/lib/types";

const PROVIDER = "google-drive-meetings";
const ALL_HISTORY_MONTHS = 1200;
/** How often to poll a running server-side backfill for progress. */
const POLL_MS = 3000;
const WINDOW_PRESETS: { label: string; months: number }[] = [
  { label: "1 month", months: 1 },
  { label: "3 months", months: 3 },
  { label: "6 months", months: 6 },
  { label: "12 months", months: 12 },
  { label: "24 months", months: 24 },
  { label: "All history", months: 0 },
];

interface PreviewInfo {
  candidates: DriveNoteCandidate[];
  total: number;
}

interface Props {
  token: string;
  open: boolean;
  /** Called after an ingest changes the brain, so the parent can refresh the sidebar. */
  onChanged?: () => void;
}

export function Sources({ token, open, onChanged }: Props) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<"sync" | "preview" | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, PreviewInfo | undefined>>({});
  const [windowMonths, setWindowMonths] = useState<Record<string, number>>({});
  const [activity, setActivity] = useState<string[] | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .listConnections(token, PROVIDER)
      .then((r) => setConnections(r.connections))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load connections"))
      .finally(() => setLoading(false));
  }, [token]);

  const refreshActivity = useCallback(() => {
    api
      .readNote(token, "memory/log.md")
      .then((n) => setActivity(recentIngests(n.body)))
      .catch(() => setActivity([]));
  }, [token]);

  useEffect(() => {
    if (!open) return;
    load();
    refreshActivity();
  }, [open, token, load, refreshActivity]);

  // Poll while any connection has a server-side backfill running, so the bar
  // advances live and the sidebar fills in. Survives closing/reopening (the
  // job runs on the server; we just re-read its progress).
  const anyRunning = connections.some((k) => k.settings?.backfill?.status === "running");
  const cbRef = useRef({ load, refreshActivity, onChanged });
  cbRef.current = { load, refreshActivity, onChanged };
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!open) return;
    if (!anyRunning) {
      if (wasRunning.current) {
        wasRunning.current = false;
        cbRef.current.refreshActivity();
        cbRef.current.onChanged?.();
      }
      return;
    }
    wasRunning.current = true;
    const t = setInterval(() => {
      cbRef.current.load();
      cbRef.current.refreshActivity();
      cbRef.current.onChanged?.();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [open, anyRunning]);

  const monthsFor = useCallback((id: string) => windowMonths[id] ?? 12, [windowMonths]);
  function lookbackFor(months: number): number {
    return months === 0 ? ALL_HISTORY_MONTHS : months;
  }

  async function connect() {
    setError(null);
    try {
      const { url } = await api.googleAuthorizeUrl(token);
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start Google connect");
    }
  }

  /** Sync-now (incremental) or dry-run preview for a connection. */
  async function run(id: string, opts: { mode?: "light" | "full"; dryRun?: boolean }) {
    setBusyId(id);
    setBusyKind(opts.dryRun ? "preview" : "sync");
    setError(null);
    try {
      const lookbackMonths = lookbackFor(monthsFor(id));
      const res = await api.syncConnection(token, id, { ...opts, lookbackMonths });
      if (opts.dryRun) {
        setPreview((p) => ({
          ...p,
          [id]: { candidates: res.candidates ?? [], total: res.total ?? (res.candidates?.length ?? 0) },
        }));
      } else {
        setPreview((p) => ({ ...p, [id]: undefined }));
        load();
        refreshActivity();
        onChanged?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusyId(null);
      setBusyKind(null);
    }
  }

  /** Kick off a fire-and-forget server-side run. `full` = Sync now (meeting
   *  notes + commitments), `light` = historical backfill (people/concepts). Both
   *  return immediately; the chain runs on the server (survives closing the tab)
   *  and we poll progress from the connection's settings.backfill. Each transcript
   *  is its own tiny step, so it never hits the 60s function cap. */
  async function startRun(id: string, mode: "light" | "full") {
    setStarting(`${id}:${mode}`);
    setError(null);
    setPreview((p) => ({ ...p, [id]: undefined }));
    try {
      await api.startBackfill(token, id, lookbackFor(monthsFor(id)), mode);
      load(); // pick up the new settings.backfill (kicks off polling)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start sync");
    } finally {
      setStarting(null);
    }
  }

  async function disconnect(id: string) {
    setBusyId(id);
    try {
      await api.deleteConnection(token, id);
      setConnections((c) => c.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disconnect");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-1.5 py-1">
          <GoogleMark className="h-4 w-4" />
          <span className="text-xs text-muted">+</span>
          <GeminiMark className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-semibold text-ink">Meeting sources</h3>
      </div>
      <p className="mt-1 text-sm text-muted">
        Connect Google accounts to auto-ingest <span className="font-medium text-ink">Gemini</span>{" "}
        meeting notes. Transcripts are never stored — each meeting is distilled into people, projects
        and commitments, with a link back to the source. You can connect more than one account.
      </p>

      <button
        onClick={connect}
        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-95"
      >
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white">
          <GoogleMark className="h-3 w-3" />
        </span>
        Connect a Google account
      </button>

      {error && <p className="mt-3 text-sm text-vis-secret">{error}</p>}

      <div className="mt-4 divide-y divide-border rounded-lg border border-border">
        {loading && <p className="px-3 py-3 text-sm text-muted">Loading…</p>}
        {!loading && connections.length === 0 && (
          <p className="px-3 py-3 text-sm text-muted">No accounts connected yet.</p>
        )}
        {connections.map((k) => {
          const bf = k.settings?.backfill;
          const running = bf?.status === "running";
          const runMode = bf?.mode ?? "light";
          const runningFull = running && runMode === "full";
          const runningLight = running && runMode === "light";
          const rowBusy = busyId === k.id || starting?.startsWith(`${k.id}:`) || running;
          return (
          <div key={k.id} className="px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink">
                    {k.accountEmail ?? k.accountLabel ?? "Google account"}
                  </span>
                  <StatusBadge status={k.status} />
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {k.lastSyncAt ? `last sync ${timeAgo(k.lastSyncAt)}` : "never synced"}
                  {k.settings?.autoSync === false ? " · auto-sync off" : " · auto-sync on"}
                  {k.lastError ? ` · error: ${k.lastError}` : ""}
                </div>
              </div>
              <button
                onClick={() => disconnect(k.id)}
                disabled={rowBusy}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-vis-secret hover:bg-vis-secret/10 disabled:opacity-60"
              >
                Disconnect
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ActionBtn
                label={runningFull ? "Syncing…" : "Sync now"}
                busy={starting === `${k.id}:full` || runningFull}
                disabled={rowBusy}
                onClick={() => startRun(k.id, "full")}
              />
              <span className="inline-flex items-center gap-1.5">
                <label className="text-xs text-muted">Window</label>
                <select
                  value={monthsFor(k.id)}
                  disabled={rowBusy}
                  onChange={(e) =>
                    setWindowMonths((w) => ({ ...w, [k.id]: Number(e.target.value) }))
                  }
                  className="rounded-md border border-border bg-bg px-1.5 py-1 text-xs text-ink disabled:opacity-60"
                >
                  {WINDOW_PRESETS.map((p) => (
                    <option key={p.months} value={p.months}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </span>
              <ActionBtn label="Preview" busy={busyId === k.id} disabled={rowBusy} onClick={() => run(k.id, { dryRun: true })} />
              <ActionBtn
                label={runningLight ? "Backfilling…" : "Backfill (light)"}
                busy={starting === `${k.id}:light` || runningLight}
                disabled={rowBusy}
                onClick={() => startRun(k.id, "light")}
              />
            </div>

            {busyId === k.id && <LoadingStrip kind={busyKind} />}
            {busyId !== k.id && bf && <BackfillStatus bf={bf} />}

            {preview[k.id] && preview[k.id]!.total > 0 && (
              <div className="mt-2 rounded-lg border border-border bg-bg p-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  {preview[k.id]!.total} new transcript(s) to process
                  {preview[k.id]!.candidates.length > preview[k.id]!.total
                    ? ` · ${preview[k.id]!.candidates.length} in window`
                    : ""}
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-ink">
                  {preview[k.id]!.candidates.slice(0, 12).map((c) => (
                    <li key={c.id} className="truncate">
                      <span className="text-muted">
                        {(c.modifiedTime ?? c.createdTime)?.slice(0, 10)}
                      </span>{" "}
                      {c.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {preview[k.id] && preview[k.id]!.total === 0 && (
              <p className="mt-2 text-xs text-muted">No new transcripts found in the window.</p>
            )}
          </div>
          );
        })}
      </div>

      {activity && activity.length > 0 && (
        <>
          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">Recently ingested</p>
          <div className="mt-1.5 space-y-1 rounded-lg border border-border p-3 text-xs text-ink">
            {activity.map((line, i) => (
              <div key={i} className="truncate">
                {line}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ActionBtn({
  label,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled ?? busy}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-ink hover:border-brand hover:text-brand-ink disabled:cursor-wait disabled:opacity-70"
    >
      {busy && <Spinner />}
      {label}
    </button>
  );
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`oms-spin h-3 w-3 shrink-0 text-brand ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Live loading strip for connector actions: a status line + a brand progress
 *  bar that is determinate during backfill (X of N) and indeterminate otherwise. */
function LoadingStrip({
  kind,
  progress,
}: {
  kind: "sync" | "preview" | "backfill" | null;
  progress?: { done: number; total: number };
}) {
  const determinate = !!progress && progress.total > 0;
  const total = progress ? Math.max(progress.total, progress.done) : 0;
  const pct = determinate ? Math.min(100, Math.round((progress!.done / total) * 100)) : 0;

  let label: string;
  if (kind === "preview") label = "Scanning Drive for new transcripts…";
  else if (kind === "sync") label = "Syncing & distilling meeting notes…";
  else if (kind === "backfill") label = "Backfilling — distilling each meeting…";
  else if (progress) label = "Done";
  else label = "Working…";

  return (
    <div className="mt-2.5">
      <div className="flex items-center justify-between text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          {kind && <Spinner />}
          {label}
        </span>
        {progress && (
          <span className="tabular-nums">
            {progress.done} of {total}
          </span>
        )}
      </div>
      <div className="oms-track mt-1.5">
        {determinate ? (
          <div className="oms-track__bar" style={{ width: `${pct}%` }} />
        ) : (
          <div className="oms-track__indeterminate" />
        )}
      </div>
    </div>
  );
}

/** Persisted state of a server-side backfill (running / done / error). */
function BackfillStatus({ bf }: { bf: BackfillState }) {
  const noun = (bf.mode ?? "light") === "full" ? "Sync" : "Backfill";
  if (bf.status === "running") {
    return (
      <>
        <LoadingStrip kind="backfill" progress={{ done: bf.done, total: bf.total }} />
        {bf.current && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink">
            <Spinner />
            <span className="text-muted">Nurturing</span>
            <span className="truncate font-medium">{bf.current}</span>
          </p>
        )}
        <TranscriptFeed items={bf.recent} />
        <p className="mt-1 text-[0.7rem] text-muted/80">
          Runs on the server — you can close this and it keeps going.
        </p>
      </>
    );
  }
  if (bf.status === "error") {
    return (
      <>
        <p className="mt-2.5 text-xs text-vis-secret">
          {noun} failed: {bf.error ?? "unknown error"} — press {noun} to resume.
        </p>
        <TranscriptFeed items={bf.recent} />
      </>
    );
  }
  return (
    <>
      <p className="mt-2.5 inline-flex items-center gap-1.5 text-xs text-muted">
        <CheckIcon /> {noun} complete · {bf.done} transcript{bf.done === 1 ? "" : "s"} distilled
      </p>
      <TranscriptFeed items={bf.recent} />
    </>
  );
}

/** Live feed of finished transcripts (newest first) with their outcome. */
function TranscriptFeed({ items }: { items?: BackfillState["recent"] }) {
  if (!items?.length) return null;
  const meta: Record<string, { dot: string; label: string }> = {
    created: { dot: "bg-vis-public", label: "meeting saved" },
    updated: { dot: "bg-brand", label: "enriched" },
    noise: { dot: "bg-muted/50", label: "skipped" },
    error: { dot: "bg-vis-secret", label: "error" },
  };
  return (
    <ul className="mt-1.5 space-y-1 border-l border-border pl-2.5">
      {items.map((it, i) => {
        const m = meta[it.outcome] ?? meta.updated!;
        return (
          <li key={`${it.at}-${i}`} className="flex items-center gap-1.5 text-xs">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.dot}`} />
            <span className="min-w-0 flex-1 truncate text-ink">{it.title}</span>
            <span className="shrink-0 text-[0.7rem] text-muted">
              {m.label}
              {it.touched > 0 ? ` · ${it.touched}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function CheckIcon() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0 text-vis-public" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Official Google "G" mark (4-color). */
function GoogleMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
    </svg>
  );
}

/** Gemini spark mark (4-point star with the Gemini blue→violet gradient). */
function GeminiMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="oms-gemini" x1="2" y1="20" x2="22" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4285F4" />
          <stop offset="0.5" stopColor="#9B72CB" />
          <stop offset="1" stopColor="#D96570" />
        </linearGradient>
      </defs>
      <path
        fill="url(#oms-gemini)"
        d="M12 0c.4 6.26 5.74 11.6 12 12-6.26.4-11.6 5.74-12 12-.4-6.26-5.74-11.6-12-12C6.26 11.6 11.6 6.26 12 0z"
      />
    </svg>
  );
}

function StatusBadge({ status }: { status: Connection["status"] }) {
  const color = status === "error" ? "var(--vis-secret)" : status === "disabled" ? "var(--muted)" : "var(--vis-public)";
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] text-muted">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {status}
    </span>
  );
}

/** Pull the last few "## [date] ingest | title" headings from memory/log.md. */
function recentIngests(body: string): string[] {
  const lines = body.split("\n").filter((l) => l.startsWith("## [") && l.includes("ingest"));
  return lines
    .slice(-8)
    .reverse()
    .map((l) => l.replace(/^##\s*/, "").replace(/\s*ingest\s*\|\s*/, " — "));
}

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
