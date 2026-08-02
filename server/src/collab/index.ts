/**
 * Real-time co-editing (Epic D2 / Layer 2) — Hocuspocus + Yjs relay.
 *
 * Room name: `{spaceId}:{notePath}` (path URL-encoded).
 * TipTap Collaboration syncs a Y.XmlFragment; vault persistence stays on REST autosave.
 * Empty rooms are hydrated from the vault on first open (`onLoadDocument`).
 *
 * Enable: COLLAB_ENABLED=true on Railway.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Hocuspocus } from "@hocuspocus/server";
import { WebSocketServer } from "ws";
import { applyUpdate, encodeStateAsUpdate } from "yjs";
import { resolveAuth } from "../auth.js";
import { requireCompanyWrite } from "../core/authz.js";
import { repairCollabBody } from "../core/dedupeBody.js";
import { buildCore, parseNote } from "../core/index.js";
import { stripRedundantTitleH1 } from "../core/titleBody.js";
import type { Visibility } from "../core/types.js";
import { hydrateYDocOnce, replaceYDocMarkdown } from "./hydrate.js";
import { collabFieldName, roundTripMarkdown, yDocToMarkdown } from "./schema.js";
import { loadCollabState, saveCollabState } from "./state-store.js";

const ALL_VISIBILITIES: Visibility[] = ["public", "private", "secret"];

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

/**
 * Anomalous-shrink guard state. A corrupt/stale Y doc can arrive dramatically
 * smaller than the vault (partial sync, bad merge) — persisting it would wipe
 * real content. We NEVER mutate the doc; we defer the vault write and only
 * accept the shrink if the exact same content is still there on a later store
 * (>= CONFIRM_MS apart), which distinguishes an intentional mass deletion from
 * a transient corruption. Versions keep full history either way.
 */
const SHRINK_RATIO = 0.4;
const SHRINK_MIN_VAULT = 1000;
const SHRINK_CONFIRM_MS = 30_000;
const pendingShrinks = new Map<string, { body: string; firstSeen: number }>();

export function getCollabServer(): Hocuspocus | null {
  return hocuspocus;
}

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
      requireCompanyWrite(auth);
      return { userId: auth.userId, spaceId: auth.spaceId };
    },

    async onLoadDocument({ document, documentName }) {
      const room = parseRoom(documentName);
      if (!room) return;

      const { vault, brain } = buildCore();
      const raw = await vault.read(room.spaceId, room.path);
      const parsed = raw ? parseNote(raw, room.path) : null;
      const vaultBodyRaw = parsed
        ? stripRedundantTitleH1(parsed.body, parsed.meta.title)
        : "";
      let vaultBody = vaultBodyRaw;
      const vaultDup = repairCollabBody(vaultBodyRaw);
      if (vaultDup.deduped) {
        vaultBody = vaultDup.body;
        await brain
          .updateNote(room.spaceId, room.path, { body: vaultBody }, ALL_VISIBILITIES, {
            author: "ohmyself",
            summary: "repair duplicated vault on collab load",
          })
          .catch((err) => console.warn(`[collab] vault repair failed for ${documentName}:`, err));
        // The stored lineage is deliberately kept: the reconcile step below
        // converges it to the repaired body. Dropping it here would re-seed a
        // fresh lineage and let a stale client stack the note again.
        console.warn(
          `[collab] repaired duped vault for ${documentName} (${vaultBodyRaw.length} -> ${vaultBody.length})`,
        );
      }

      const vaultRound = vaultBody.trim() ? roundTripMarkdown(vaultBody).trim() : "";

      // A room's Yjs state is a lineage of items. Seeding from markdown mints a
      // NEW lineage, and any client still holding the old one merges it back —
      // Yjs keeps both, which stacks the whole note. So the stored state is
      // never discarded: it is restored, then converged toward the vault with a
      // diff, which stays inside the same lineage and is merge-safe.
      const stored = await loadCollabState(room.spaceId, room.path).catch(() => null);
      let restored = false;
      if (stored) {
        applyUpdate(document, stored, "ohmyself-state-store");
        restored = true;
        console.log(`[collab] restored Y state for ${documentName}`);
      }

      if (!vaultBody.trim()) return;

      if (!restored) {
        const seeded = hydrateYDocOnce(document, vaultBody);
        console.log(
          seeded
            ? `[collab] hydrated ${documentName} from vault (${vaultBody.trim().length} chars)`
            : `[collab] skipped seeding ${documentName} — room already has content`,
        );
        return;
      }

      // Restored lineage: reconcile it to the vault only when they actually
      // differ, comparing through the same serializer to ignore normalization.
      const liveRound = yDocToMarkdown(document).trim();
      if (liveRound === vaultRound) return;

      replaceYDocMarkdown(document, vaultBody);
      console.log(
        `[collab] reconciled ${documentName} to vault (${liveRound.length} -> ${vaultRound.length} chars)`,
      );
    },

    // Vault persistence for live edits. Hocuspocus debounces this per document,
    // and flushes before unloading, so the Y doc is the single writer of the
    // body while a room is open — the web client no longer PATCHes body in
    // collab mode.
    async onStoreDocument({ document, documentName }) {
      const room = parseRoom(documentName);
      if (!room) return;
      if (document.isEmpty(collabFieldName())) return;

      // Persist the binary Y state so the next load restores the same history.
      await saveCollabState(
        room.spaceId,
        room.path,
        encodeStateAsUpdate(document),
      ).catch((err) => console.warn(`[collab] state save failed for ${documentName}:`, err));

      let nextBody = yDocToMarkdown(document);
      // Never persist an empty doc over existing content (unhydrated/cleared room).
      if (!nextBody.trim()) return;
      // Belt-and-suspenders: a stale client merging old state can stack the
      // whole note N times — never let that reach the vault.
      const { body: cleaned, deduped } = repairCollabBody(nextBody);
      if (deduped) {
        console.warn(`[collab] deduped repeated body for ${documentName} (${nextBody.length} -> ${cleaned.length})`);
        nextBody = cleaned;
        // Rewrite the live Y doc so reconnecting clients inherit the clean state.
        replaceYDocMarkdown(document, nextBody);
        await saveCollabState(room.spaceId, room.path, encodeStateAsUpdate(document)).catch(
          (err) => console.warn(`[collab] state save failed for ${documentName}:`, err),
        );
      }

      const { brain } = buildCore();
      const current = await brain.readNote(room.spaceId, room.path, ALL_VISIBILITIES).catch(() => null);
      if (!current) return;
      // Skip serializer normalization noise: only write when the doc differs
      // from the current body's own round-trip through the same schema.
      if (nextBody.trim() === roundTripMarkdown(current.body).trim()) return;

      // Anomalous-shrink guard: defer (never chop) sudden large shrinks.
      const curLen = current.body.trim().length;
      const nextLen = nextBody.trim().length;
      if (curLen > SHRINK_MIN_VAULT && nextLen < curLen * SHRINK_RATIO) {
        const pending = pendingShrinks.get(documentName);
        const now = Date.now();
        if (!pending || pending.body !== nextBody) {
          pendingShrinks.set(documentName, { body: nextBody, firstSeen: now });
          console.warn(
            `[collab] SUSPECT SHRINK deferred for ${documentName} (vault ${curLen} -> doc ${nextLen}); ` +
              `will accept if unchanged after ${SHRINK_CONFIRM_MS / 1000}s`,
          );
          return;
        }
        if (now - pending.firstSeen < SHRINK_CONFIRM_MS) return;
        console.warn(`[collab] shrink confirmed for ${documentName} (${curLen} -> ${nextLen})`);
        pendingShrinks.delete(documentName);
      } else {
        pendingShrinks.delete(documentName);
      }

      await brain.updateNote(
        room.spaceId,
        room.path,
        { body: nextBody },
        ALL_VISIBILITIES,
        { author: "human", summary: "live edit" },
      );
      console.log(`[collab] stored ${documentName} (${nextBody.length} chars)`);
    },
  });

  wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (ws, req) => {
    hocuspocus!.handleConnection(ws, req);
  });

  console.log("[collab] Hocuspocus enabled — WebSocket path /collab (vault hydration on room open)");
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
