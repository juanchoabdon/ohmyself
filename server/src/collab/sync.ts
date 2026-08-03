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

export type PushBodyResult = "pushed" | "skipped_active" | "skipped_offline" | "failed";

/** @deprecated use pushBodyToCollab */
export function isAgentAuthor(author?: string): boolean {
  if (!author) return false;
  return author.startsWith("agent:") || author === "ohmyself";
}

/** Best-effort: never throw — vault write already succeeded. */
export async function pushBodyToCollab(
  spaceId: string,
  path: string,
  body: string,
): Promise<PushBodyResult> {
  if (!collabEnabled()) return "skipped_offline";

  const server = getCollabServer();
  if (!server) return "skipped_offline";

  const documentName = roomName(spaceId, path);
  const editors = activeEditorCount(documentName);
  let connection: Awaited<ReturnType<typeof server.openDirectConnection>> | null = null;

  try {
    connection = await server.openDirectConnection(documentName, {
      source: VAULT_PUSH_ORIGIN,
    });

    const pushedRound = roundTripMarkdown(body).trim();
    let result: PushBodyResult = "pushed";

    await connection.transact((doc) => {
      const liveRound = yDocToMarkdown(doc as Doc).trim();
      if (editors > 0 && liveRound && liveRound !== pushedRound) {
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
