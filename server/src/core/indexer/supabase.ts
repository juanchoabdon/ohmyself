import { serviceClient } from "../supabase.js";
import type { IndexRecord, IndexedNote, ListOptions, SearchOptions, Visibility } from "../types.js";
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

export class SupabaseIndex implements BrainIndex {
  async upsert(userId: string, rec: IndexRecord): Promise<void> {
    const sb = serviceClient();
    const { error } = await sb.from("note_index").upsert(
      {
        user_id: userId,
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
      { onConflict: "user_id,path" },
    );
    if (error) throw new Error(`index upsert failed: ${error.message}`);
  }

  async remove(userId: string, path: string): Promise<void> {
    const sb = serviceClient();
    await sb.from("note_index").delete().eq("user_id", userId).eq("path", path);
  }

  async get(userId: string, path: string): Promise<IndexedNote | null> {
    const sb = serviceClient();
    const { data, error } = await sb
      .from("note_index")
      .select(SELECT)
      .eq("user_id", userId)
      .eq("path", path)
      .maybeSingle();
    if (error || !data) return null;
    return toIndexed(data as Row);
  }

  async list(userId: string, opts: ListOptions): Promise<IndexedNote[]> {
    const sb = serviceClient();
    let q = sb
      .from("note_index")
      .select(SELECT)
      .eq("user_id", userId)
      .in("visibility", opts.allowed);
    if (opts.types?.length) q = q.in("type", opts.types);
    if (opts.tags?.length) q = q.overlaps("tags", opts.tags);
    q = q.order("updated", { ascending: false, nullsFirst: false }).limit(opts.limit ?? 200);
    const { data, error } = await q;
    if (error || !data) return [];
    return (data as Row[]).map(toIndexed);
  }

  async search(userId: string, query: string, opts: SearchOptions): Promise<IndexedNote[]> {
    const trimmed = query.trim();
    if (!trimmed) return this.list(userId, opts);
    const sb = serviceClient();
    let q = sb
      .from("note_index")
      .select(SELECT)
      .eq("user_id", userId)
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
