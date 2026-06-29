"use client";

import { useEffect, useState } from "react";
import { api, siteBase } from "@/lib/api";
import type { ApiToken, Visibility } from "@/lib/types";

interface Props {
  token: string;
  open: boolean;
  onClose: () => void;
}

const SCOPES: { value: Visibility; label: string; help: string }[] = [
  { value: "secret", label: "Secret", help: "Full access — every note, including finances & secrets." },
  { value: "private", label: "Private", help: "Public + private notes. Hides secret-level notes." },
  { value: "public", label: "Public", help: "Read-only, public notes only — safe for a shared agent." },
];

export function Settings({ token, open, onClose }: Props) {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Visibility>("secret");
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mcpUrl = `${siteBase()}/mcp`;
  const restUrl = `${siteBase()}/v1`;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    api
      .listTokens(token)
      .then((r) => setTokens(r.tokens))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load tokens"))
      .finally(() => setLoading(false));
  }, [open, token]);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const created = await api.createToken(token, name.trim() || "token", scope);
      setFresh(created.token);
      setName("");
      const { tokens } = await api.listTokens(token);
      setTokens(tokens);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create token");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    try {
      await api.revokeToken(token, id);
      setTokens((t) => t.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke token");
    }
  }

  if (!open) return null;

  const snippetToken = fresh ?? "oms_your_token_here";
  const claudeSnippet = `{
  "mcpServers": {
    "ohmyself": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "${mcpUrl}",
        "--header", "Authorization: Bearer ${snippetToken}"
      ]
    }
  }
}`;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-2xl rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="font-heading text-lg font-semibold tracking-tight">Connect your second self</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-muted hover:text-ink">
            Close
          </button>
        </div>

        <div className="space-y-7 px-5 py-5">
          {/* One-click OAuth (recommended) */}
          <section>
            <h3 className="text-sm font-semibold text-ink">Connect Claude or ChatGPT</h3>
            <p className="mt-1 text-sm text-muted">
              The easiest way — no token needed. Add ohmyself! as a connector and you&apos;ll be
              asked to sign in and pick how much it can see.
            </p>
            <div className="mt-3 space-y-2">
              <CopyRow label="URL" value={mcpUrl} />
            </div>
            <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-muted">
              <li>
                <span className="font-medium text-ink">Claude:</span> Settings → Connectors → Add
                custom connector → paste the URL above → Connect, then approve.
              </li>
              <li>
                <span className="font-medium text-ink">ChatGPT:</span> Settings → Connectors →
                Create → paste the URL → authorize.
              </li>
            </ul>
          </section>

          {/* Endpoints */}
          <section>
            <h3 className="text-sm font-semibold text-ink">Endpoints &amp; tokens</h3>
            <p className="mt-1 text-sm text-muted">
              For other MCP clients (Cursor, scripts, your own), point at the MCP URL with a personal
              token below. The REST base is for apps and scripts.
            </p>
            <div className="mt-3 space-y-2">
              <CopyRow label="MCP" value={mcpUrl} />
              <CopyRow label="REST" value={restUrl} />
            </div>
          </section>

          {/* Tokens */}
          <section>
            <h3 className="text-sm font-semibold text-ink">Personal access tokens</h3>
            <p className="mt-1 text-sm text-muted">
              A long-lived token to authenticate agents and tools. Its scope caps what the
              connected agent can see.
            </p>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Token name (e.g. Claude Desktop)"
                className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:border-brand"
              />
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as Visibility)}
                className="rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:border-brand"
              >
                {SCOPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                onClick={create}
                disabled={creating}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-95 disabled:opacity-60"
              >
                {creating ? "…" : "Create"}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-muted">{SCOPES.find((s) => s.value === scope)?.help}</p>

            {fresh && (
              <div className="mt-3 rounded-lg border border-brand/40 bg-brand-weak p-3">
                <p className="text-xs font-medium text-brand-ink">
                  Copy your token now — you won&apos;t be able to see it again.
                </p>
                <div className="mt-2">
                  <CopyRow label="Token" value={fresh} mono />
                </div>
              </div>
            )}

            {error && <p className="mt-3 text-sm text-vis-secret">{error}</p>}

            <div className="mt-4 divide-y divide-border rounded-lg border border-border">
              {loading && <p className="px-3 py-3 text-sm text-muted">Loading…</p>}
              {!loading && tokens.length === 0 && (
                <p className="px-3 py-3 text-sm text-muted">No tokens yet.</p>
              )}
              {tokens.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{t.name}</span>
                      <ScopeBadge scope={t.scope} />
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      <span className="font-mono">{t.preview}</span> ·{" "}
                      {t.last_used_at ? `last used ${timeAgo(t.last_used_at)}` : "never used"}
                    </div>
                  </div>
                  <button
                    onClick={() => revoke(t.id)}
                    className="shrink-0 rounded-md px-2 py-1 text-xs text-vis-secret hover:bg-vis-secret/10"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Claude / MCP setup */}
          <section>
            <h3 className="text-sm font-semibold text-ink">Add to Claude Desktop</h3>
            <p className="mt-1 text-sm text-muted">
              Paste this into your Claude Desktop config (Settings → Developer → Edit config),
              then restart Claude. Works with any MCP client — ChatGPT, Cursor, or your own.
            </p>
            <CopyBlock value={claudeSnippet} />
            <p className="mt-2 text-xs text-muted">
              Any MCP client: connect to <span className="font-mono">{mcpUrl}</span> with header{" "}
              <span className="font-mono">Authorization: Bearer &lt;token&gt;</span>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function ScopeBadge({ scope }: { scope: Visibility }) {
  const color =
    scope === "public" ? "var(--vis-public)" : scope === "secret" ? "var(--vis-secret)" : "var(--vis-private)";
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] text-muted">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {scope}
    </span>
  );
}

function CopyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2">
      <span className="w-12 shrink-0 text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      <span className={`min-w-0 flex-1 truncate text-sm text-ink ${mono ? "font-mono" : ""}`}>{value}</span>
      <CopyButton value={value} />
    </div>
  );
}

function CopyBlock({ value }: { value: string }) {
  return (
    <div className="relative mt-3">
      <pre className="overflow-x-auto rounded-lg border border-border bg-bg p-3 text-xs leading-relaxed text-ink">
        {value}
      </pre>
      <div className="absolute right-2 top-2">
        <CopyButton value={value} />
      </div>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          /* ignore */
        }
      }}
      className="shrink-0 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-ink hover:border-brand hover:text-brand-ink"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
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
