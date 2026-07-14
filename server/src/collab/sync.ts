/**
 * Push agent/MCP markdown writes into the live Yjs room (OK-style dual path).
 * Vault remains SSOT; this updates open browser editors via Hocuspocus.
 */
import type { Doc } from "yjs";
import { collabEnabled, getCollabServer, roomName } from "./index.js";
import { applyMarkdownToYDoc } from "./hydrate.js";

const AGENT_ORIGIN = "ohmyself-agent";

export function isAgentAuthor(author?: string): boolean {
  if (!author) return false;
  return author.startsWith("agent:") || author === "ohmyself";
}

/**
 * Best-effort: never throw — vault write already succeeded.
 */
export async function pushAgentBodyToCollab(
  spaceId: string,
  path: string,
  body: string,
  author?: string,
): Promise<void> {
  if (!collabEnabled() || !isAgentAuthor(author)) return;

  const server = getCollabServer();
  if (!server) return;

  const documentName = roomName(spaceId, path);
  let connection: Awaited<ReturnType<typeof server.openDirectConnection>> | null = null;

  try {
    connection = await server.openDirectConnection(documentName, {
      source: AGENT_ORIGIN,
      author,
    });

    await connection.transact((doc) => {
      applyMarkdownToYDoc(doc as Doc, body, AGENT_ORIGIN);
    }, AGENT_ORIGIN);
  } catch (err) {
    console.warn("[collab] agent push failed:", documentName, err);
  } finally {
    try {
      await connection?.disconnect();
    } catch {
      /* ignore */
    }
  }
}
