import { getActiveSpace } from "./api";

export type BrainEvent = {
  type: "note_created" | "note_updated" | "note_deleted" | "note_moved";
  spaceId: string;
  path: string;
  to?: string;
  updated?: string;
};

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
}

/** Subscribe to live brain writes for the active space (SSE over fetch). */
export async function connectBrainEvents(
  token: string,
  onEvent: (event: BrainEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const spaceId = getActiveSpace();
  const res = await fetch(`${apiBase()}/v1/events`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
      ...(spaceId ? { "X-Brain-Space": spaceId } : {}),
    },
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`events stream failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      let eventName = "";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) data = line.slice(5).trim();
      }
      if (!eventName || eventName === "ping" || !data) continue;
      try {
        onEvent(JSON.parse(data) as BrainEvent);
      } catch {
        /* malformed frame */
      }
    }
  }
}
