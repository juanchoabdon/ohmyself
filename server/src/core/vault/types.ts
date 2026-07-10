/** Storage adapter for the raw markdown content (the source of truth). */
export interface Vault {
  /** Return raw file contents, or null if missing. */
  read(userId: string, path: string): Promise<string | null>;
  /** Create or overwrite a file. */
  write(userId: string, path: string, raw: string): Promise<void>;
  /** Delete a file (no-op if missing). */
  remove(userId: string, path: string): Promise<void>;
  /** List all note paths for a user (relative, e.g. "projects/x/_index.md"). */
  listPaths(userId: string): Promise<string[]>;
}
