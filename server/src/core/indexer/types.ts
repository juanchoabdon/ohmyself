import type {
  FolderCount,
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
}
