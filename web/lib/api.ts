import type { ApiToken, Category, ContextResult, FullNote, IndexedNote, Visibility } from "./types.js";

function base(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
}

/** Public base URL of the API/MCP server (for showing connection instructions). */
export function apiBase(): string {
  return base();
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

  listNotes: (token: string) => call<{ notes: IndexedNote[] }>("/v1/notes", token),

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
    call<{ path: string }>(`/v1/notes/${encPath(path)}`, token, {
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

  context: (token: string, topic: string) =>
    call<ContextResult>("/v1/context", token, {
      method: "POST",
      body: JSON.stringify({ topic, limit: 6 }),
    }),

  listTokens: (token: string) => call<{ tokens: ApiToken[] }>("/v1/tokens", token),

  createToken: (token: string, name: string, scope: Visibility) =>
    call<ApiToken & { token: string }>("/v1/tokens", token, {
      method: "POST",
      body: JSON.stringify({ name, scope }),
    }),

  revokeToken: (token: string, id: string) =>
    call<{ revoked: string }>(`/v1/tokens/${id}`, token, { method: "DELETE" }),
};
