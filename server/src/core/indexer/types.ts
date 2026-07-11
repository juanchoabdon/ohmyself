import type {
  ChunkRecord,
  FolderCount,
  HybridHit,
  IndexRecord,
  IndexedNote,
  ListOptions,
  SearchOptions,
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
}
