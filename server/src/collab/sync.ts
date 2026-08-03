/**
 * Push vault markdown into the live Yjs room so open editors pick up MCP/REST
 * writes without a refresh. Vault remains SSOT; collab autosave skips this
 * path to avoid feedback loops (see brain.updateNote).
 */
import type { Doc } from "yjs";
import { collabEnabled, getCollabServer, roomName } from "./index.js";
import { replaceYDocMarkdown } from "./hydrate.js";

const VAULT_PUSH_ORIGIN = "ohmyself-vault-push";

/** @deprecated use pushBodyToCollab */
export function isAgentAuthor(author?: string): boolean {
  if (!author) return false;
  return author.startsWith("agent:") || author === "ohmyself";
}

/** Best-effort: never throw — vault write already succeeded. */
export async function pushBodyToCollab(spaceId: string, path: string, body: string): Promise<void> {
  if (!collabEnabled()) return;

  const server = getCollabServer();
  if (!server) return;

  const documentName = roomName(spaceId, path);
  let connection: Awaited<ReturnType<typeof server.openDirectConnection>> | null = null;

  try {
    connection = await server.openDirectConnection(documentName, {
      source: VAULT_PUSH_ORIGIN,
    });

    await connection.transact((doc) => {
      replaceYDocMarkdown(doc as Doc, body, VAULT_PUSH_ORIGIN);
    }, VAULT_PUSH_ORIGIN);
    console.log(`[collab] pushed vault body to ${documentName} (${body.trim().length} chars)`);
  } catch (err) {
    console.warn("[collab] vault push failed:", documentName, err);
  } finally {
    try {
      await connection?.disconnect();
    } catch {
      /* ignore */
    }
  }
}
