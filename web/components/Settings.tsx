"use client";

import { useEffect, useRef, useState } from "react";
import { api, siteBase } from "@/lib/api";
import type { ApiToken, FriendVisibility, Me, SharedByMe, SharedWithMe, Space, UserSummary, Visibility } from "@/lib/types";
import { Sources } from "./Sources";
import { SpaceSettings } from "./SpaceSettings";

type TabKey = "space" | "mcp" | "connectors" | "friends";

interface Props {
  token: string;
  open: boolean;
  onClose: () => void;
  initialTab?: TabKey;
  /** The space currently active in the dashboard (self or company). */
  activeSpace?: Space | null;
  /** Called when the active space's branding/name changes, so the shell updates. */
  onSpaceUpdated?: (space: Space) => void;
  /** Called when a connector ingest changes the brain, so the page can refresh the sidebar. */
  onChanged?: () => void;
}

const SCOPES: { value: Visibility; label: string; help: string }[] = [
  { value: "secret", label: "Secret", help: "Full access — every note, including finances & secrets." },
  { value: "private", label: "Private", help: "Public + private notes. Hides secret-level notes." },
  { value: "public", label: "Public", help: "Read-only, public notes only — safe for a shared agent." },
];

const FRIEND_SCOPES: { value: FriendVisibility; label: string; help: string }[] = [
  { value: "public", label: "Public", help: "Only your public notes." },
  { value: "private", label: "Private", help: "Public + private notes. Hides your secret notes." },
  {
    value: "secret",
    label: "Secret",
    help: "Everything — including finances and secret notes. Still read-only for them.",
  },
];

export function Settings({ token, open, onClose, initialTab, activeSpace, onSpaceUpdated, onChanged }: Props) {
  const isCompany = activeSpace?.kind === "company";
  const tabs: { key: TabKey; label: string }[] = [
    { key: "space", label: isCompany ? "Company" : "Appearance" },
    { key: "mcp", label: "MCP & tokens" },
    { key: "connectors", label: "Connectors" },
    { key: "friends", label: "Friends" },
  ];
  const [tab, setTab] = useState<TabKey>(initialTab ?? "mcp");
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Visibility>("secret");
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [me, setMe] = useState<Me | null>(null);
  const [handleInput, setHandleInput] = useState("");
  const [handleSaving, setHandleSaving] = useState(false);
  const [handleError, setHandleError] = useState<string | null>(null);
  const [handleSaved, setHandleSaved] = useState(false);

  const [sharedByMe, setSharedByMe] = useState<SharedByMe[]>([]);
  const [sharedWithMe, setSharedWithMe] = useState<SharedWithMe[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendQuery, setFriendQuery] = useState("");
  const [friendResults, setFriendResults] = useState<UserSummary[]>([]);
  const [friendPicked, setFriendPicked] = useState<UserSummary | null>(null);
  const [friendScope, setFriendScope] = useState<FriendVisibility>("public");
  const [sharing, setSharing] = useState(false);
  const [friendError, setFriendError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mcpUrl = `${siteBase()}/mcp`;
  const restUrl = `${siteBase()}/v1`;

  useEffect(() => {
    if (open && initialTab) setTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    api
      .me(token)
      .then((m) => {
        setMe(m);
        setHandleInput(m.username ?? "");
      })
      .catch(() => {
        /* non-fatal */
      });
  }, [open, token]);

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

  useEffect(() => {
    if (!open) return;
    setFriendError(null);
    setFriendsLoading(true);
    Promise.all([api.listSharedByMe(token), api.listSharedWithMe(token)])
      .then(([byMe, withMe]) => {
        setSharedByMe(byMe.shares);
        setSharedWithMe(withMe.shares);
      })
      .catch((e) => setFriendError(e instanceof Error ? e.message : "Could not load friends"))
      .finally(() => setFriendsLoading(false));
  }, [open, token]);

  // Debounced search-as-you-type by @handle or display name.
  useEffect(() => {
    if (!open) return;
    if (friendPicked && friendQuery !== `@${friendPicked.username}`) setFriendPicked(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = friendQuery.trim();
    if (q.length < 2) {
      setFriendResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const { users } = await api.searchUsers(token, q);
        setFriendResults(users);
      } catch {
        setFriendResults([]);
      }
    }, 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendQuery, open, token]);

  function pickFriend(u: UserSummary) {
    setFriendPicked(u);
    setFriendQuery(`@${u.username}`);
    setFriendResults([]);
  }

  async function shareBrain() {
    const identifier = friendPicked ? friendPicked.username : friendQuery.trim();
    if (!identifier) return;
    setSharing(true);
    setFriendError(null);
    try {
      await api.shareWithFriend(token, identifier, friendScope);
      setFriendQuery("");
      setFriendPicked(null);
      setFriendResults([]);
      const { shares } = await api.listSharedByMe(token);
      setSharedByMe(shares);
    } catch (e) {
      setFriendError(e instanceof Error ? e.message : "Could not share");
    } finally {
      setSharing(false);
    }
  }

  async function unshare(id: string) {
    try {
      await api.revokeShare(token, id);
      setSharedByMe((s) => s.filter((x) => x.id !== id));
    } catch (e) {
      setFriendError(e instanceof Error ? e.message : "Could not revoke");
    }
  }

  async function saveHandle() {
    setHandleSaving(true);
    setHandleError(null);
    setHandleSaved(false);
    try {
      const { username } = await api.setUsername(token, handleInput);
      setHandleInput(username);
      setMe((m) => (m ? { ...m, username } : m));
      setHandleSaved(true);
      setTimeout(() => setHandleSaved(false), 1600);
    } catch (e) {
      setHandleError(e instanceof Error ? e.message : "Could not save handle");
    } finally {
      setHandleSaving(false);
    }
  }

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
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-2xl rounded-2xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="font-heading text-lg font-semibold tracking-tight">Connect your second self</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-muted hover:text-ink">
            Close
          </button>
        </div>

        <div role="tablist" aria-label="Settings sections" className="flex gap-1 border-b border-border px-5">
          {tabs.map((t) => {
            const active = t.key === tab;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className={`relative -mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
                  active ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="space-y-7 px-5 py-5">
          {tab === "space" && activeSpace && (
            <SpaceSettings
              token={token}
              space={activeSpace}
              onUpdated={(s) => onSpaceUpdated?.(s)}
            />
          )}
          {tab === "space" && !activeSpace && (
            <p className="text-sm text-muted">Loading your space…</p>
          )}

          {tab === "mcp" && (
            <>
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
          </>
          )}

          {/* Meeting sources / connectors */}
          {tab === "connectors" && <Sources token={token} open={open} onChanged={onChanged} />}

          {/* Friends */}
          {tab === "friends" && (
          <section>
            <h3 className="text-sm font-semibold text-ink">Friends</h3>
            <p className="mt-1 text-sm text-muted">
              Share your brain, read-only, with someone else on ohmyself! — they&apos;ll get
              recall_friend, search_friend_brain, research_friend, list_friend_notes,
              read_friend_note, and graph tools (neighbors / backlinks / entity / timeline) in their
              own agent, capped at the level you pick. Never includes secret notes.
            </p>

            {/* Your @handle */}
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <div className="flex flex-1 items-center gap-1 rounded-lg border border-border bg-bg px-3 py-2">
                <span className="text-sm text-muted">@</span>
                <input
                  value={handleInput}
                  onChange={(e) => setHandleInput(e.target.value.toLowerCase())}
                  placeholder="your-handle"
                  className="min-w-0 flex-1 bg-transparent text-sm text-ink focus:outline-none"
                />
              </div>
              <button
                onClick={saveHandle}
                disabled={handleSaving || !handleInput.trim() || handleInput === me?.username}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink hover:border-brand hover:text-brand-ink disabled:opacity-60"
              >
                {handleSaving ? "…" : handleSaved ? "Saved" : "Save handle"}
              </button>
            </div>
            {handleError && <p className="mt-1.5 text-xs text-vis-secret">{handleError}</p>}
            <p className="mt-1.5 text-xs text-muted">
              This is how friends find you to share with — 3-20 characters, lowercase letters,
              numbers, underscores.
            </p>

            {/* Share with someone */}
            <div className="relative mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                value={friendQuery}
                onChange={(e) => setFriendQuery(e.target.value)}
                placeholder="Search by name or @handle"
                className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:border-brand"
              />
              <select
                value={friendScope}
                onChange={(e) => setFriendScope(e.target.value as FriendVisibility)}
                className="rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:border-brand"
              >
                {FRIEND_SCOPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                onClick={shareBrain}
                disabled={sharing || !friendQuery.trim()}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-95 disabled:opacity-60"
              >
                {sharing ? "…" : "Share"}
              </button>

              {friendResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-52 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg sm:right-auto sm:w-72">
                  {friendResults.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => pickFriend(u)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-brand-weak"
                    >
                      <span className="truncate font-medium text-ink">{u.displayName}</span>
                      <span className="truncate text-xs text-muted">@{u.username}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="mt-1.5 text-xs text-muted">{FRIEND_SCOPES.find((s) => s.value === friendScope)?.help}</p>

            {friendError && <p className="mt-3 text-sm text-vis-secret">{friendError}</p>}

            <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">People you&apos;ve shared with</p>
            <div className="mt-1.5 divide-y divide-border rounded-lg border border-border">
              {friendsLoading && <p className="px-3 py-3 text-sm text-muted">Loading…</p>}
              {!friendsLoading && sharedByMe.length === 0 && (
                <p className="px-3 py-3 text-sm text-muted">Nobody yet.</p>
              )}
              {sharedByMe.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{s.viewerName}</span>
                      <ScopeBadge scope={s.maxVisibility} />
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted">@{s.viewerUsername}</div>
                  </div>
                  <button
                    onClick={() => unshare(s.id)}
                    className="shrink-0 rounded-md px-2 py-1 text-xs text-vis-secret hover:bg-vis-secret/10"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>

            <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">Shared with you</p>
            <div className="mt-1.5 divide-y divide-border rounded-lg border border-border">
              {friendsLoading && <p className="px-3 py-3 text-sm text-muted">Loading…</p>}
              {!friendsLoading && sharedWithMe.length === 0 && (
                <p className="px-3 py-3 text-sm text-muted">
                  Nobody has shared with you yet — ask a friend to add your @handle above.
                </p>
              )}
              {sharedWithMe.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{s.ownerName}</span>
                      <ScopeBadge scope={s.maxVisibility} />
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted">@{s.ownerUsername}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
          )}

          {/* Claude / MCP setup */}
          {tab === "mcp" && (
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
          )}
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
