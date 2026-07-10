import { serviceClient } from "../supabase.js";
import type {
  FolderCount,
  IndexRecord,
  IndexedNote,
  ListOptions,
  SearchOptions,
  Visibility,
} from "../types.js";
import type { BrainIndex } from "./types.js";

interface Row {
  path: string;
  note_id: string | null;
  title: string;
  type: string;
  visibility: Visibility;
  tags: string[];
  links: string[];
  created: string | null;
  updated: string | null;
  content: string;
}

function toIndexed(r: Row): IndexedNote {
  return {
    path: r.path,
    id: r.note_id ?? undefined,
    title: r.title,
    type: r.type,
    visibility: r.visibility,
    tags: r.tags ?? [],
    links: r.links ?? [],
    created: r.created ?? undefined,
    updated: r.updated ?? undefined,
    excerpt: r.content ? r.content.slice(0, 240) : undefined,
  };
}

const SELECT = "path, note_id, title, type, visibility, tags, links, created, updated, content";

// The `spaceId` argument is the tenant key: a user's self space (== their user id)
// or a company space uuid. Rows are keyed by (space_id, path).
export class SupabaseIndex implements BrainIndex {
  async upsert(spaceId: string, rec: IndexRecord): Promise<void> {
    const sb = serviceClient();
    const { error } = await sb.from("note_index").upsert(
      {
        space_id: spaceId,
        path: rec.path,
        note_id: rec.id ?? null,
        title: rec.title,
        type: rec.type,
        visibility: rec.visibility,
        tags: rec.tags,
        links: rec.links,
        content: rec.content,
        created: rec.created ?? null,
        updated: rec.updated ?? null,
        indexed_at: new Date().toISOString(),
      },
      { onConflict: "space_id,path" },
    );
    if (error) throw new Error(`index upsert failed: ${error.message}`);
  }

  async remove(spaceId: string, path: string): Promise<void> {
    const sb = serviceClient();
    await sb.from("note_index").delete().eq("space_id", spaceId).eq("path", path);
  }

  async get(spaceId: string, path: string): Promise<IndexedNote | null> {
    const sb = serviceClient();
    const { data, error } = await sb
      .from("note_index")
      .select(SELECT)
      .eq("space_id", spaceId)
      .eq("path", path)
      .maybeSingle();
    if (error || !data) return null;
    return toIndexed(data as Row);
  }

  async list(spaceId: string, opts: ListOptions): Promise<IndexedNote[]> {
    const sb = serviceClient();
    let q = sb
      .from("note_index")
      .select(SELECT)
      .eq("space_id", spaceId)
      .in("visibility", opts.allowed);
    if (opts.types?.length) q = q.in("type", opts.types);
    if (opts.tags?.length) q = q.overlaps("tags", opts.tags);
    if (opts.prefix) q = q.like("path", `${opts.prefix.replace(/[%_]/g, "\\$&")}%`);
    q = q.order("updated", { ascending: false, nullsFirst: false }).limit(opts.limit ?? 200);
    const { data, error } = await q;
    if (error || !data) return [];
    return (data as Row[]).map(toIndexed);
  }

  async folderCounts(spaceId: string, allowed: Visibility[]): Promise<FolderCount[]> {
    const sb = serviceClient();
    // Preferred: a set-based aggregate (scales past PostgREST's row cap).
    const { data, error } = await sb.rpc("note_folder_counts", {
      p_space: spaceId,
      p_allowed: allowed,
    });
    if (!error && data) {
      return (data as { folder: string; n: number }[]).map((r) => ({
        folder: r.folder,
        count: Number(r.n),
      }));
    }
    // Fallback (RPC not deployed): count from a lightweight paths query. PostgREST
    // caps a single response (~1000 rows) regardless of .limit(), so we page with
    // .range() until exhausted — otherwise big brains undercount their folders.
    const counts = new Map<string, number>();
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data: rows, error: pageErr } = await sb
        .from("note_index")
        .select("path")
        .eq("space_id", spaceId)
        .in("visibility", allowed)
        .order("path", { ascending: true })
        .range(from, from + PAGE - 1);
      const batch = (rows as { path: string }[] | null) ?? [];
      for (const r of batch) {
        const top = r.path.split("/")[0] || "(root)";
        counts.set(top, (counts.get(top) ?? 0) + 1);
      }
      if (pageErr || batch.length < PAGE) break;
    }
    return [...counts.entries()].map(([folder, count]) => ({ folder, count }));
  }

  async search(spaceId: string, query: string, opts: SearchOptions): Promise<IndexedNote[]> {
    const trimmed = query.trim();
    if (!trimmed) return this.list(spaceId, opts);
    const sb = serviceClient();
    let q = sb
      .from("note_index")
      .select(SELECT)
      .eq("space_id", spaceId)
      .in("visibility", opts.allowed)
      .textSearch("fts", trimmed, { type: "websearch", config: "simple" });
    if (opts.types?.length) q = q.in("type", opts.types);
    if (opts.tags?.length) q = q.overlaps("tags", opts.tags);
    q = q.limit(opts.limit ?? 50);
    const { data, error } = await q;
    if (error || !data) return [];
    return (data as Row[]).map(toIndexed);
  }
}
