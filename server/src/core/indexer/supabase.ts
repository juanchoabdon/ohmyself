import { toVectorLiteral } from "../embeddings.js";
import { serviceClient } from "../supabase.js";
import type {
  ChunkRecord,
  FolderCount,
  HybridHit,
  IndexRecord,
  IndexedNote,
  ListOptions,
  SearchOptions,
  TimelineOptions,
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
/** Metadata only — skips the heavy `content` blob (sidebar / map listing). */
const SELECT_META = "path, note_id, title, type, visibility, tags, links, created, updated";

/** Turn a free-text query into a prefix `to_tsquery` string ("amal:* & mob:*").
 *  Prefix matching makes as-you-type search work (websearch/plainto only match
 *  whole lexemes). Returns "" when the query has no usable tokens. */
function prefixTsquery(query: string): string {
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter(Boolean);
  return tokens.map((t) => `${t}:*`).join(" & ");
}

// Hybrid rerank weights (applied app-side on top of the RPC's RRF fusion).
const TITLE_BONUS = 0.02;
const RECENCY_BONUS_MAX = 0.01;

interface HybridRow {
  path: string;
  note_id: string | null;
  title: string;
  type: string;
  visibility: Visibility;
  tags: string[] | null;
  created: string | null;
  updated: string | null;
  section: string | null;
  chunk_pos: number | null;
  excerpt: string | null;
  score: number;
  sem_rank: number | null;
  lex_rank: number | null;
  similarity: number | null;
}

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
    const limit = opts.limit ?? 200;
    const prefixFilter = opts.prefix
      ? `${opts.prefix.replace(/[%_]/g, "\\$&")}%`
      : undefined;

    if (opts.includeContent) {
      let q = sb.from("note_index").select(SELECT).eq("space_id", spaceId).in("visibility", opts.allowed);
      if (opts.types?.length) q = q.in("type", opts.types);
      if (opts.excludeTypes?.length) q = q.not("type", "in", `(${opts.excludeTypes.join(",")})`);
      if (opts.tags?.length) q = q.overlaps("tags", opts.tags);
      if (prefixFilter) q = q.like("path", prefixFilter);
      const { data, error } = await q
        .order("updated", { ascending: false, nullsFirst: false })
        .limit(limit);
      if (error || !data) return [];
      return (data as Row[]).map(toIndexed);
    }

    type MetaRow = Omit<Row, "content">;
    let q = sb.from("note_index").select(SELECT_META).eq("space_id", spaceId).in("visibility", opts.allowed);
    if (opts.types?.length) q = q.in("type", opts.types);
    if (opts.excludeTypes?.length) q = q.not("type", "in", `(${opts.excludeTypes.join(",")})`);
    if (opts.tags?.length) q = q.overlaps("tags", opts.tags);
    if (prefixFilter) q = q.like("path", prefixFilter);
    const { data, error } = await q
      .order("updated", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as MetaRow[]).map((r) => toIndexed({ ...r, content: "" }));
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
    let q = sb.from("note_index").select(SELECT).eq("space_id", spaceId).in("visibility", opts.allowed);

    // Prefix search: turn each token into `<token>:*` and AND them, using a raw
    // to_tsquery (omit `type`). websearch/plainto only match whole lexemes — so
    // "amal" wouldn't find "Amalia" and "sim mob" wouldn't find "Simplifying
    // Mobile". Prefix matching makes as-you-type search actually work.
    const ts = prefixTsquery(trimmed);
    if (ts) {
      q = q.textSearch("fts", ts, { config: "simple" });
    } else {
      q = q.textSearch("fts", trimmed, { type: "websearch", config: "simple" });
    }
    if (opts.types?.length) q = q.in("type", opts.types);
    if (opts.tags?.length) q = q.overlaps("tags", opts.tags);
    q = q.limit(opts.limit ?? 50);
    const { data, error } = await q;
    if (error || !data) return [];
    return (data as Row[]).map(toIndexed);
  }

  // ── Hybrid retrieval (chunk embeddings + vector search) ──────────────────────

  async upsertChunks(spaceId: string, rec: IndexRecord, chunks: ChunkRecord[]): Promise<void> {
    const sb = serviceClient();
    // Replace the note's chunks wholesale so stale chunks never linger.
    await sb.from("note_chunks").delete().eq("space_id", spaceId).eq("path", rec.path);
    if (!chunks.length) return;
    const rows = chunks.map((c) => ({
      space_id: spaceId,
      path: rec.path,
      note_id: rec.id ?? null,
      title: rec.title,
      type: rec.type,
      visibility: rec.visibility,
      tags: rec.tags,
      section: c.section,
      chunk_pos: c.pos,
      content: c.content,
      created: rec.created ?? null,
      updated: rec.updated ?? null,
      embedding: c.embedding ? toVectorLiteral(c.embedding) : null,
      indexed_at: new Date().toISOString(),
    }));
    const { error } = await sb
      .from("note_chunks")
      .upsert(rows, { onConflict: "space_id,path,chunk_pos" });
    if (error) throw new Error(`chunk upsert failed: ${error.message}`);
  }

  async removeChunks(spaceId: string, path: string): Promise<void> {
    const sb = serviceClient();
    await sb.from("note_chunks").delete().eq("space_id", spaceId).eq("path", path);
  }

  /** Map raw hybrid_search_notes rows to reranked HybridHits. `qTokens` are the
   *  lowercased query tokens used for the title-match bonus (empty for pure
   *  vector search, where no lexical/title signal applies). */
  private mapHybridRows(rows: HybridRow[], qTokens: string[], limit: number): HybridHit[] {
    const now = Date.now();
    const hits = rows.map<HybridHit>((r) => {
      const reasons: string[] = [];
      if (r.sem_rank != null) reasons.push("semantic");
      if (r.lex_rank != null) reasons.push("lexical");

      let score = r.score ?? 0;
      const titleLc = (r.title ?? "").toLowerCase();
      if (qTokens.length && qTokens.some((t) => titleLc.includes(t))) {
        score += TITLE_BONUS;
        reasons.push("title");
      }
      if (r.updated) {
        const ageDays = (now - new Date(r.updated).getTime()) / 86_400_000;
        if (Number.isFinite(ageDays) && ageDays >= 0) {
          // Decays to ~0 over ~180 days; keeps fresh notes marginally ahead.
          const rec = RECENCY_BONUS_MAX * Math.exp(-ageDays / 180);
          score += rec;
          if (ageDays <= 30) reasons.push("recent");
        }
      }

      return {
        path: r.path,
        id: r.note_id ?? undefined,
        title: r.title,
        type: r.type,
        visibility: r.visibility,
        tags: r.tags ?? [],
        links: [],
        created: r.created ?? undefined,
        updated: r.updated ?? undefined,
        excerpt: r.excerpt ?? undefined,
        section: r.section ?? undefined,
        score,
        semRank: r.sem_rank ?? undefined,
        lexRank: r.lex_rank ?? undefined,
        similarity: r.similarity ?? undefined,
        matchReasons: reasons,
      };
    });
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  async hybridSearch(
    spaceId: string,
    query: string,
    embedding: number[] | null,
    opts: SearchOptions,
  ): Promise<HybridHit[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const sb = serviceClient();
    const limit = opts.limit ?? 20;
    const { data, error } = await sb.rpc("hybrid_search_notes", {
      p_space: spaceId,
      p_tsquery: prefixTsquery(trimmed),
      p_embedding: embedding ? toVectorLiteral(embedding) : "",
      p_allowed: opts.allowed,
      p_types: opts.types?.length ? opts.types : null,
      p_tags: opts.tags?.length ? opts.tags : null,
      // Over-fetch a candidate pool, then rerank + slice app-side.
      p_limit: Math.max(limit * 3, 40),
    });
    if (error) throw new Error(`hybrid search failed: ${error.message}`);
    const rows = (data as HybridRow[] | null) ?? [];
    const qTokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
    return this.mapHybridRows(rows, qTokens, limit);
  }

  /** Pure-vector nearest neighbours: run the hybrid RPC with an empty tsquery so
   *  only the semantic CTE contributes. Used for "notes like this one". */
  async vectorSearch(spaceId: string, embedding: number[], opts: SearchOptions): Promise<HybridHit[]> {
    if (!embedding.length) return [];
    const sb = serviceClient();
    const limit = opts.limit ?? 10;
    const { data, error } = await sb.rpc("hybrid_search_notes", {
      p_space: spaceId,
      p_tsquery: "",
      p_embedding: toVectorLiteral(embedding),
      p_allowed: opts.allowed,
      p_types: opts.types?.length ? opts.types : null,
      p_tags: opts.tags?.length ? opts.tags : null,
      p_limit: Math.max(limit * 3, 30),
    });
    if (error) throw new Error(`vector search failed: ${error.message}`);
    const rows = (data as HybridRow[] | null) ?? [];
    return this.mapHybridRows(rows, [], limit);
  }

  /** Notes that link TO `path` (their frontmatter `links[]` contains it). */
  async backlinks(
    spaceId: string,
    path: string,
    allowed: Visibility[],
    limit = 50,
  ): Promise<IndexedNote[]> {
    const sb = serviceClient();
    const { data, error } = await sb
      .from("note_index")
      .select(SELECT)
      .eq("space_id", spaceId)
      .in("visibility", allowed)
      .contains("links", [path])
      .limit(limit);
    if (error || !data) return [];
    return (data as Row[]).map(toIndexed);
  }

  async timeline(spaceId: string, opts: TimelineOptions): Promise<IndexedNote[]> {
    const sb = serviceClient();
    const by = opts.by ?? "created";
    let q = sb.from("note_index").select(SELECT).eq("space_id", spaceId).in("visibility", opts.allowed);
    if (opts.types?.length) q = q.in("type", opts.types);
    if (opts.tags?.length) q = q.overlaps("tags", opts.tags);
    if (opts.prefix) q = q.like("path", `${opts.prefix.replace(/[%_]/g, "\\$&")}%`);
    if (opts.from) q = q.gte(by, opts.from);
    if (opts.to) q = q.lte(by, opts.to);
    q = q
      .order(by, { ascending: opts.order === "asc", nullsFirst: false })
      .limit(opts.limit ?? 50);
    const { data, error } = await q;
    if (error || !data) return [];
    return (data as Row[]).map(toIndexed);
  }

  async notesMissingChunks(spaceId: string, limit: number): Promise<IndexRecord[]> {
    const sb = serviceClient();
    const { data, error } = await sb.rpc("notes_missing_chunks", {
      p_space: spaceId,
      p_limit: limit,
    });
    if (error || !data) return [];
    return (data as MissingRow[]).map((r) => ({
      path: r.path,
      id: r.note_id ?? undefined,
      title: r.title,
      type: r.type,
      visibility: r.visibility as Visibility,
      tags: r.tags ?? [],
      links: [],
      created: r.created ?? undefined,
      updated: r.updated ?? undefined,
      excerpt: r.content ? r.content.slice(0, 240) : undefined,
      content: r.content ?? "",
    }));
  }
}

interface MissingRow {
  path: string;
  note_id: string | null;
  title: string;
  type: string;
  visibility: string;
  tags: string[] | null;
  created: string | null;
  updated: string | null;
  content: string;
}
