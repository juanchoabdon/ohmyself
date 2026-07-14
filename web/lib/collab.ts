function apiBase(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:8787";
}

/** Railway collab endpoint — Vercel HTTP rewrites cannot proxy WebSocket upgrades. */
const RAILWAY_COLLAB_WS = "wss://ohmyself-api-production.up.railway.app/collab";

/** WebSocket endpoint for Hocuspocus (must hit Railway directly in prod). */
export function collabWsUrl(): string {
  if (process.env.NEXT_PUBLIC_COLLAB_WS_URL) {
    return process.env.NEXT_PUBLIC_COLLAB_WS_URL;
  }
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "www.ohmyself.ai" || host === "ohmyself.ai" || host.endsWith(".vercel.app")) {
      return RAILWAY_COLLAB_WS;
    }
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/collab`;
  }
  const api = apiBase();
  if (api.includes("ohmyself.ai")) return RAILWAY_COLLAB_WS;
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
