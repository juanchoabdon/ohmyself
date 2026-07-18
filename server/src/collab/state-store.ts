/**
 * Durable binary Yjs state per room (collab_docs). Restoring the exact Y
 * history across server restarts keeps client re-syncs idempotent — without
 * it, a reconnecting client merges its old state into a fresh markdown
 * hydration and every block duplicates.
 */
import { serviceClient } from "../core/supabase.js";

const TABLE = "collab_docs";

export async function loadCollabState(spaceId: string, path: string): Promise<Uint8Array | null> {
  const { data, error } = await serviceClient()
    .from(TABLE)
    .select("state_b64")
    .eq("space_id", spaceId)
    .eq("path", path)
    .maybeSingle();
  if (error || !data?.state_b64) return null;
  return new Uint8Array(Buffer.from(data.state_b64 as string, "base64"));
}

export async function saveCollabState(spaceId: string, path: string, state: Uint8Array): Promise<void> {
  const { error } = await serviceClient()
    .from(TABLE)
    .upsert(
      {
        space_id: spaceId,
        path,
        state_b64: Buffer.from(state).toString("base64"),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "space_id,path" },
    );
  if (error) throw new Error(`collab state save failed: ${error.message}`);
}

export async function deleteCollabState(spaceId: string, path: string): Promise<void> {
  const { error } = await serviceClient()
    .from(TABLE)
    .delete()
    .eq("space_id", spaceId)
    .eq("path", path);
  if (error) throw new Error(`collab state delete failed: ${error.message}`);
}
