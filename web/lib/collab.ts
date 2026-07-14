function apiBase(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:8787";
}

/** WebSocket endpoint — same origin in the browser so Vercel can proxy /collab. */
export function collabWsUrl(): string {
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/collab`;
  }
  const api = apiBase();
  return api.replace(/^http/, "ws") + "/collab";
}

/** Must match server `roomName(spaceId, path)`. */
export function collabRoomName(spaceId: string, path: string): string {
  return `${spaceId}:${encodeURIComponent(path.replace(/^\/+/, ""))}`;
}

export async function fetchCollabEnabled(): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase()}/health`);
    if (!res.ok) return false;
    const j = (await res.json()) as { collab?: boolean };
    return Boolean(j.collab);
  } catch {
    return false;
  }
}
