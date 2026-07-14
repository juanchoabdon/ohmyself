import type {
  ApiToken,
  BackfillState,
  Category,
  Connection,
  FolderCount,
  ContextResult,
  FriendVisibility,
  FullNote,
  HistoryEntry,
  IndexedNote,
  Me,
  SharedByMe,
  SharedWithMe,
  Space,
  SpaceMember,
  SyncResult,
  UserSummary,
  Visibility,
} from "./types.js";

function base(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
}

// The active brain (space) the whole client is operating on. Null = the user's
// personal "self" space (the server defaults there when the header is absent).
// Set by the dashboard when the user switches spaces in the header.
let _activeSpaceId: string | null = null;
export function setActiveSpace(spaceId: string | null): void {
  _activeSpaceId = spaceId;
}
export function getActiveSpace(): string | null {
  return _activeSpaceId;
}

/** Public base URL of the API/MCP server (for showing connection instructions). */
export function apiBase(): string {
  return base();
}

/**
 * Public site origin (official domain). The site proxies /mcp, /oauth and
 * /.well-known to the API, so connection snippets should use this, not the
 * raw Vercel API URL.
 */
export function siteBase(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.ohmyself.ai";
}

/** Encode a note path for the URL, preserving the `/` separators. */
function encPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function call<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base() + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(_activeSpaceId ? { "X-Brain-Space": _activeSpaceId } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  onboard: (token: string) =>
    call<{ seeded: string[]; structure: string[] }>("/v1/onboard", token, { method: "POST" }),

  structure: (token: string) => call<{ categories: Category[] }>("/v1/structure", token),

  // Lazy sidebar: fetch a folder's notes (prefix) on expand, or the whole brain
  // (no prefix) for the map / active filters. High default limit so a single
  // folder is never truncated.
  listNotes: (token: string, opts?: { prefix?: string; limit?: number; exclude?: string[] }) => {
    const q = new URLSearchParams();
    if (opts?.prefix) q.set("prefix", opts.prefix);
    if (opts?.exclude?.length) q.set("exclude", opts.exclude.join(","));
    q.set("limit", String(opts?.limit ?? 5000));
    return call<{ notes: IndexedNote[] }>(`/v1/notes?${q.toString()}`, token);
  },

  /** Per-pillar note counts for the lazy sidebar (cheap; no note bodies). */
  folders: (token: string) => call<{ folders: FolderCount[] }>("/v1/folders", token),

  search: (token: string, q: string) =>
    call<{ results: IndexedNote[] }>(`/v1/search?q=${encodeURIComponent(q)}`, token),

  readNote: (token: string, path: string) =>
    call<FullNote>(`/v1/notes/${encPath(path)}`, token),

  createNote: (
    token: string,
    body: {
      type: string;
      title: string;
      body?: string;
      visibility?: Visibility;
      tags?: string[];
      path?: string;
    },
  ) => call<{ path: string }>("/v1/notes", token, { method: "POST", body: JSON.stringify(body) }),

  updateNote: (
    token: string,
    path: string,
    patch: { body?: string; title?: string; visibility?: Visibility; tags?: string[] },
  ) =>
    call<{ path: string; meta: FullNote["meta"]; body: string }>(`/v1/notes/${encPath(path)}`, token, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteNote: (token: string, path: string) =>
    call<{ deleted: string }>(`/v1/notes/${encPath(path)}`, token, { method: "DELETE" }),

  moveNote: (token: string, from: string, to: string) =>
    call<{ path: string }>("/v1/move", token, {
      method: "POST",
      body: JSON.stringify({ from, to }),
    }),

  noteHistory: (token: string, path: string, opts?: { limit?: number; offset?: number }) => {
    const q = new URLSearchParams({ path });
    if (opts?.limit != null) q.set("limit", String(opts.limit));
    if (opts?.offset != null) q.set("offset", String(opts.offset));
    return call<{ path: string; entries: HistoryEntry[] }>(`/v1/history?${q.toString()}`, token);
  },

  spaceActivity: (token: string, opts?: { limit?: number }) => {
    const q = new URLSearchParams();
    if (opts?.limit != null) q.set("limit", String(opts.limit));
    const qs = q.toString();
    return call<{ entries: HistoryEntry[] }>(`/v1/activity${qs ? `?${qs}` : ""}`, token);
  },

  noteBacklinks: (token: string, path: string, opts?: { limit?: number }) => {
    const q = new URLSearchParams({ path });
    if (opts?.limit != null) q.set("limit", String(opts.limit));
    return call<{ path: string; backlinks: IndexedNote[] }>(`/v1/backlinks?${q.toString()}`, token);
  },

  restoreVersion: (token: string, path: string, version: string, summary?: string) =>
    call<{ path: string; restored: string }>("/v1/restore", token, {
      method: "POST",
      body: JSON.stringify({ path, version, summary }),
    }),

  context: (token: string, topic: string) =>
    call<ContextResult>("/v1/context", token, {
      method: "POST",
      body: JSON.stringify({ topic, limit: 6 }),
    }),

  /** Semantic "idea links" for the Brain Map (embeddings-derived edges). */
  semanticLinks: (token: string) =>
    call<{ enabled: boolean; edges: { a: string; b: string; score: number }[]; count?: number }>(
      "/v1/graph/semantic",
      token,
    ),

  listTokens: (token: string) => call<{ tokens: ApiToken[] }>("/v1/tokens", token),

  createToken: (token: string, name: string, scope: Visibility) =>
    call<ApiToken & { token: string }>("/v1/tokens", token, {
      method: "POST",
      body: JSON.stringify({ name, scope }),
    }),

  revokeToken: (token: string, id: string) =>
    call<{ revoked: string }>(`/v1/tokens/${id}`, token, { method: "DELETE" }),

  me: (token: string) => call<Me>("/v1/me", token),

  // ── Spaces (personal "self" + company brains) ─────────────────────────────
  listSpaces: (token: string) =>
    call<{ spaces: Space[]; activeSpaceId: string }>("/v1/spaces", token),

  createSpace: (
    token: string,
    body: { name: string; slug?: string; themeColor?: string | null; logoUrl?: string | null },
  ) => call<{ space: Space }>("/v1/spaces", token, { method: "POST", body: JSON.stringify(body) }),

  updateSpace: (
    token: string,
    id: string,
    patch: { name?: string; themeColor?: string | null; logoUrl?: string | null },
  ) =>
    call<{ space: Space }>(`/v1/spaces/${id}`, token, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  uploadSpaceLogo: (token: string, id: string, dataUrl: string) =>
    call<{ space: Space; logoUrl: string }>(`/v1/spaces/${id}/logo`, token, {
      method: "POST",
      body: JSON.stringify({ dataUrl }),
    }),

  listMembers: (token: string, id: string) =>
    call<{ members: SpaceMember[] }>(`/v1/spaces/${id}/members`, token),

  addMember: (token: string, id: string, identifier: string, role: "member" | "admin") =>
    call<{ member: SpaceMember }>(`/v1/spaces/${id}/members`, token, {
      method: "POST",
      body: JSON.stringify({ identifier, role }),
    }),

  updateMemberRole: (token: string, id: string, userId: string, role: "member" | "admin") =>
    call<{ ok: boolean }>(`/v1/spaces/${id}/members/${userId}`, token, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),

  removeMember: (token: string, id: string, userId: string) =>
    call<{ removed: string }>(`/v1/spaces/${id}/members/${userId}`, token, { method: "DELETE" }),

  setUsername: (token: string, username: string) =>
    call<{ username: string }>("/v1/me/username", token, {
      method: "PUT",
      body: JSON.stringify({ username }),
    }),

  searchUsers: (token: string, q: string) =>
    call<{ users: UserSummary[] }>(`/v1/users/search?q=${encodeURIComponent(q)}`, token),

  listSharedByMe: (token: string) => call<{ shares: SharedByMe[] }>("/v1/friends/shared-by-me", token),

  shareWithFriend: (token: string, identifier: string, maxVisibility: FriendVisibility) =>
    call<{ share: SharedByMe }>("/v1/friends/shared-by-me", token, {
      method: "POST",
      body: JSON.stringify({ identifier, maxVisibility }),
    }),

  revokeShare: (token: string, id: string) =>
    call<{ revoked: string }>(`/v1/friends/shared-by-me/${id}`, token, { method: "DELETE" }),

  listSharedWithMe: (token: string) => call<{ shares: SharedWithMe[] }>("/v1/friends/shared-with-me", token),

  // ── Connectors / meeting sources ──────────────────────────────────────────
  listConnections: (token: string, provider?: string) =>
    call<{ connections: Connection[] }>(
      `/v1/connections${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`,
      token,
    ),

  deleteConnection: (token: string, id: string) =>
    call<{ deleted: string }>(`/v1/connections/${id}`, token, { method: "DELETE" }),

  /** Get the Google consent URL to connect a Drive/Gemini meetings account. */
  googleAuthorizeUrl: (token: string) =>
    call<{ url: string }>("/v1/connectors/google/authorize", token),

  /** Run a sync for one connection. dryRun previews; mode=light powers backfill. */
  syncConnection: (
    token: string,
    id: string,
    opts?: {
      mode?: "light" | "full";
      dryRun?: boolean;
      lookbackMonths?: number;
      batchSize?: number;
    },
  ) =>
    call<SyncResult>(`/v1/connections/${id}/sync`, token, {
      method: "POST",
      body: JSON.stringify(opts ?? {}),
    }),

  /** Kick off a fire-and-forget server-side run. `light` = historical backfill
   *  (people/concepts); `full` = Sync now (meeting notes + commitments). Returns
   *  the initial state; progress is then read from the connection's settings. */
  startBackfill: (
    token: string,
    id: string,
    lookbackMonths: number,
    mode: "light" | "full" = "light",
  ) =>
    call<BackfillState>(`/v1/connections/${id}/backfill`, token, {
      method: "POST",
      body: JSON.stringify({ lookbackMonths, mode }),
    }),
};
