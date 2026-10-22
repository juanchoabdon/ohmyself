/**
 * Push vault markdown into the live Yjs room so open editors pick up MCP/REST
 * writes without a refresh. Skips when humans are actively editing and live Y
 * already diverged — vault write still succeeded; collab autosave is SSOT.
 */
import type { Doc } from "yjs";
import {
  activeEditorCount,
  collabEnabled,
  getCollabServer,
  roomName,
} from "./index.js";
import { replaceYDocMarkdown } from "./hydrate.js";
import { roundTripMarkdown, yDocToMarkdown } from "./schema.js";

const VAULT_PUSH_ORIGIN = "ohmyself-vault-push";

export type PushBodyResult = "pushed" | "skipped_active" | "skipped_offline" | "skipped_no_room" | "failed";

/** @deprecated use pushBodyToCollab */
export function isAgentAuthor(author?: string): boolean {
  if (!author) return false;
  return author.startsWith("agent:") || author === "ohmyself";
}

/**
 * Best-effort: never throw — vault write already succeeded.
 *
 * `prevBody` is the vault body as it was BEFORE this write. It is how we tell
 * "the live doc simply has the previous content" (safe to replace — the open
 * editor is idle) apart from "a human has unsaved edits in flight" (skip).
 * Without it, any real change made the live doc differ from the pushed body,
 * so every MCP/REST write to an open note was skipped.
 */
export async function pushBodyToCollab(
  spaceId: string,
  path: string,
  body: string,
  prevBody?: string,
): Promise<PushBodyResult> {
  if (!collabEnabled()) return "skipped_offline";

  const server = getCollabServer();
  if (!server) return "skipped_offline";

  const documentName = roomName(spaceId, path);
  const editors = activeEditorCount(documentName);
  const pushedRound = roundTripMarkdown(body).trim();
  const prevRound = prevBody !== undefined ? roundTripMarkdown(prevBody).trim() : null;

  const humanEditsInFlight = (liveRound: string): boolean => {
    if (editors === 0 || !liveRound || liveRound === pushedRound) return false;
    // Without prevBody we can't distinguish idle from mid-edit: stay safe, skip.
    if (prevRound === null) return true;
    return liveRound !== prevRound;
  };

  // Decide BEFORE opening a direct connection: Hocuspocus fires the
  // onStoreDocument hooks on both transact() and disconnect() even when the
  // transaction changed nothing, and that hook persists the (stale) live doc
  // over the vault write that just succeeded — reverting it. A skip must not
  // touch Hocuspocus at all.
  const inMemory = server.documents.get(documentName);
  // No room loaded = nobody has the note open: there is nothing to push. Opening
  // a direct connection here LOADS the room from its stored Y state — still the
  // previous body — and the store hook then writes that stale doc back over the
  // vault write that just succeeded, as "live edit" (2026-10-22: every bonds
  // PATCH was reverted within a second this way). The next real open hydrates
  // from the vault instead (onLoadDocument reconciles toward the newer vault).
  if (!inMemory) return "skipped_no_room";
  if (humanEditsInFlight(yDocToMarkdown(inMemory).trim())) {
    console.log(
      `[collab] skipped vault push for ${documentName} — ${editors} editor(s) with unsaved edits`,
    );
    return "skipped_active";
  }

  let connection: Awaited<ReturnType<typeof server.openDirectConnection>> | null = null;

  try {
    connection = await server.openDirectConnection(documentName, {
      source: VAULT_PUSH_ORIGIN,
    });

    let result: PushBodyResult = "pushed";

    await connection.transact((doc) => {
      const liveRound = yDocToMarkdown(doc as Doc).trim();
      if (liveRound === pushedRound) return; // already in sync
      // Re-check inside the transaction: a keystroke may have landed between
      // the pre-check and here. In that race the human's live doc wins (collab
      // is SSOT while a room is open) and the store hook persists it.
      if (humanEditsInFlight(liveRound)) {
        result = "skipped_active";
        return;
      }
      replaceYDocMarkdown(doc as Doc, body, VAULT_PUSH_ORIGIN);
    }, VAULT_PUSH_ORIGIN);

    if (result === "pushed") {
      console.log(`[collab] pushed vault body to ${documentName} (${body.trim().length} chars)`);
    } else {
      console.log(
        `[collab] skipped vault push for ${documentName} — ${editors} editor(s), live doc differs`,
      );
    }
    return result;
  } catch (err) {
    console.warn("[collab] vault push failed:", documentName, err);
    return "failed";
  } finally {
    try {
      await connection?.disconnect();
    } catch {
      /* ignore */
    }
  }
}
