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

/** Derived, rebuildable index over the markdown brain. Powers list + search +
 *  fast visibility scoping without reading every file. */
export interface BrainIndex {
  upsert(userId: string, rec: IndexRecord): Promise<void>;
  remove(userId: string, path: string): Promise<void>;
  get(userId: string, path: string): Promise<IndexedNote | null>;
  list(userId: string, opts: ListOptions): Promise<IndexedNote[]>;
  search(userId: string, query: string, opts: SearchOptions): Promise<IndexedNote[]>;
  /** Count notes grouped by top-level folder (first path segment), scoped to
   *  the allowed visibilities. Powers the lazy sidebar. */
  folderCounts(userId: string, allowed: Visibility[]): Promise<FolderCount[]>;

  // ── Optional hybrid-retrieval layer (chunk embeddings + vector search) ──────
  // Backends that support it (Supabase/pgvector) implement these; the FS backend
  // omits them and the Brain falls back to lexical `search`.

  /** Replace the persisted chunks (and embeddings) for a note. */
  upsertChunks?(userId: string, rec: IndexRecord, chunks: ChunkRecord[]): Promise<void>;
  /** Drop all chunks for a note (on delete/move). */
  removeChunks?(userId: string, path: string): Promise<void>;
  /** Hybrid (semantic + lexical) search over chunks, collapsed to notes. The
   *  `embedding` is the query vector, or null to run lexical-only. */
  hybridSearch?(
    userId: string,
    query: string,
    embedding: number[] | null,
    opts: SearchOptions,
  ): Promise<HybridHit[]>;

  // ── Optional graph / navigation primitives ─────────────────────────────────

  /** Notes that link TO `path` (incoming links / backlinks). */
  backlinks?(userId: string, path: string, allowed: Visibility[], limit?: number): Promise<IndexedNote[]>;
  /** Pure-vector nearest neighbours for a query embedding (chunks → notes). */
  vectorSearch?(userId: string, embedding: number[], opts: SearchOptions): Promise<HybridHit[]>;
  /** Notes ordered chronologically within an optional date window. */
  timeline?(userId: string, opts: TimelineOptions): Promise<IndexedNote[]>;
  /** Indexed notes that still lack an embedded chunk (embed safety-net). */
  notesMissingChunks?(userId: string, limit: number): Promise<IndexRecord[]>;
}
