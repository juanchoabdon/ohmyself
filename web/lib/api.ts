import type { ContextResult, FullNote, IndexedNote, Visibility } from "./types.js";

function base(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
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
    call<{ seeded: string[]; alreadyHadNotes: boolean }>("/v1/onboard", token, { method: "POST" }),

  listNotes: (token: string) => call<{ notes: IndexedNote[] }>("/v1/notes", token),

  search: (token: string, q: string) =>
    call<{ results: IndexedNote[] }>(`/v1/search?q=${encodeURIComponent(q)}`, token),

  readNote: (token: string, path: string) =>
    call<FullNote>(`/v1/notes/${path.split("/").map(encodeURIComponent).join("/")}`, token),

  createNote: (
    token: string,
    body: { type: string; title: string; body?: string; visibility?: Visibility },
  ) => call<{ path: string }>("/v1/notes", token, { method: "POST", body: JSON.stringify(body) }),

  context: (token: string, topic: string) =>
    call<ContextResult>("/v1/context", token, {
      method: "POST",
      body: JSON.stringify({ topic, limit: 6 }),
    }),
};
