import { brainBucket, serviceClient } from "../supabase.js";
import { safeNotePath } from "../paths.js";
import type { Vault } from "./types.js";

/** Stores markdown in a private Supabase Storage bucket under `<spaceId>/<path>`.
 *  `spaceId` is the tenant key: a user's self space (== their user id) or a
 *  company space uuid. Self spaces keep the exact same prefix they always had. */
export class SupabaseVault implements Vault {
  private key(spaceId: string, path: string): string {
    // safeNotePath rejects `..`/absolute/traversal so a request can never
    // address another tenant's prefix (the service role bypasses Storage RLS).
    return `${spaceId}/${safeNotePath(path)}`;
  }

  async read(spaceId: string, path: string): Promise<string | null> {
    const sb = serviceClient();
    const { data, error } = await sb.storage.from(brainBucket()).download(this.key(spaceId, path));
    if (error || !data) return null;
    return await data.text();
  }

  async write(spaceId: string, path: string, raw: string): Promise<void> {
    const sb = serviceClient();
    const { error } = await sb.storage
      .from(brainBucket())
      .upload(this.key(spaceId, path), new Blob([raw], { type: "text/markdown" }), {
        upsert: true,
        contentType: "text/markdown",
      });
    if (error) throw new Error(`vault write failed: ${error.message}`);
  }

  async remove(spaceId: string, path: string): Promise<void> {
    const sb = serviceClient();
    await sb.storage.from(brainBucket()).remove([this.key(spaceId, path)]);
  }

  async listPaths(spaceId: string): Promise<string[]> {
    const sb = serviceClient();
    const out: string[] = [];
    const walk = async (prefix: string): Promise<void> => {
      const { data, error } = await sb.storage
        .from(brainBucket())
        .list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
      if (error || !data) return;
      for (const entry of data) {
        // Supabase marks folders with a null id (no metadata).
        const isFolder = (entry as { id: string | null }).id === null;
        const full = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (isFolder) {
          await walk(full);
        } else if (entry.name.endsWith(".md")) {
          out.push(full);
        }
      }
    };
    await walk(spaceId);
    // strip the leading "<spaceId>/" prefix
    const prefixLen = spaceId.length + 1;
    return out.map((p) => p.slice(prefixLen));
  }
}
