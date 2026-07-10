export type Visibility = "public" | "private" | "secret";

/** A request's capability level. Mirrors Visibility; `public` is read-only. */
export type Scope = "public" | "private" | "secret";

/** Frontmatter metadata of a note. */
export interface NoteMeta {
  id?: string;
  title: string;
  type: string;
  visibility: Visibility;
  tags: string[];
  links: string[];
  created?: string;
  updated?: string;
  /** Any extra frontmatter keys are preserved round-trip. */
  extra?: Record<string, unknown>;
}

/** A full note: metadata + path + markdown body. */
export interface Note {
  path: string;
  meta: NoteMeta;
  body: string;
}

/** Lightweight indexed view used for listing / search results. */
export interface IndexedNote {
  path: string;
  id?: string;
  title: string;
  type: string;
  visibility: Visibility;
  tags: string[];
  links: string[];
  created?: string;
  updated?: string;
  excerpt?: string;
}

/** Index row including searchable content (used on write). */
export interface IndexRecord extends IndexedNote {
  content: string;
}

export interface ListOptions {
  types?: string[];
  tags?: string[];
  /** Visibilities the caller is allowed to see. */
  allowed: Visibility[];
  limit?: number;
  /** Restrict to notes whose path starts with this prefix (e.g. "goals/"). */
  prefix?: string;
}

export interface SearchOptions extends ListOptions {}

/** A top-level pillar (first path segment) and how many notes it holds. */
export interface FolderCount {
  folder: string;
  count: number;
}

/** A member's role within a space. */
export type SpaceRole = "owner" | "admin" | "member";

/** Resolved identity + capability for a request. */
export interface AuthContext {
  /** The authenticated account (identity). Used for tokens, sharing, profiles. */
  userId: string;
  /** The active brain (tenant) key. Equals `userId` for the personal "self"
   *  space; a distinct uuid for a company space the user is a member of.
   *  All brain/vault/index/config operations are scoped to this. */
  spaceId: string;
  /** The caller's role in the active space (`owner` for a self space). */
  role: SpaceRole;
  scope: Scope;
  readonly: boolean;
  /** How the caller authenticated. Token management requires a `jwt` session. */
  via?: "jwt" | "token" | "oauth" | "public";
}
