/**
 * Real-time co-editing (Epic D2 / Layer 2) — Hocuspocus + Yjs relay.
 *
 * Room name: `{spaceId}:{notePath}` (path URL-encoded).
 * TipTap Collaboration syncs a Y.XmlFragment; vault persistence stays on REST autosave.
 *
 * Enable: COLLAB_ENABLED=true on Railway.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Hocuspocus } from "@hocuspocus/server";
import { WebSocketServer } from "ws";
import { resolveAuth } from "../auth.js";

function parseRoom(name: string): { spaceId: string; path: string } | null {
  const i = name.indexOf(":");
  if (i <= 0) return null;
  const spaceId = name.slice(0, i);
  const path = decodeURIComponent(name.slice(i + 1)).replace(/^\/+/, "");
  if (!path.endsWith(".md")) return null;
  return { spaceId, path };
}

export function roomName(spaceId: string, path: string): string {
  return `${spaceId}:${encodeURIComponent(path.replace(/^\/+/, ""))}`;
}

let hocuspocus: Hocuspocus | null = null;
let wss: WebSocketServer | null = null;

export function collabEnabled(): boolean {
  return process.env.COLLAB_ENABLED === "true";
}

export function startCollabServer(): Hocuspocus | null {
  if (!collabEnabled()) return null;
  if (hocuspocus) return hocuspocus;

  hocuspocus = new Hocuspocus({
    name: "ohmyself-collab",

    async onAuthenticate({ token, documentName }) {
      if (!token) throw new Error("collab: missing token");
      const room = parseRoom(documentName);
      if (!room) throw new Error("collab: invalid room");
      const auth = await resolveAuth({
        authorization: `Bearer ${token}`,
        "x-brain-scope": null,
        "x-brain-space": room.spaceId,
      });
      if (auth.readonly) throw new Error("collab: read-only token");
      return { userId: auth.userId, spaceId: auth.spaceId };
    },
  });

  wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (ws, req) => {
    hocuspocus!.handleConnection(ws, req);
  });

  console.log("[collab] Hocuspocus enabled — WebSocket path /collab");
  return hocuspocus;
}

export function handleCollabUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): boolean {
  if (!collabEnabled() || !wss) return false;
  const url = request.url ?? "";
  if (!url.startsWith("/collab")) return false;
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss!.emit("connection", ws, request);
  });
  return true;
}
