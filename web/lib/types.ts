export type Visibility = "public" | "private" | "secret";

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

export interface NoteMeta {
  id?: string;
  title: string;
  type: string;
  visibility: Visibility;
  tags: string[];
  links: string[];
  created?: string;
  updated?: string;
}

export interface FullNote {
  path: string;
  meta: NoteMeta;
  body: string;
  raw: string;
}

export interface HistoryEntry {
  version: string;
  author: string;
  timestamp: number;
  summary: string;
  op?: string;
  path?: string;
}

export interface Category {
  folder: string;
  label: string;
}

/** A top-level pillar and how many notes it holds (for the lazy sidebar). */
export interface FolderCount {
  folder: string;
  count: number;
}

export interface ApiToken {
  id: string;
  name: string;
  scope: Visibility;
  preview: string;
  created_at: string;
  last_used_at: string | null;
}

export interface ContextResult {
  topic: string;
  notes: { path: string; title: string; body: string }[];
  text: string;
}

/** The ceiling a brain owner can share with a friend — any visibility,
 *  including `secret` (full bucket, still read-only for the viewer). */
export type FriendVisibility = Visibility;

/** A share the current user has GIVEN — who can read their brain, and how much. */
export interface SharedByMe {
  id: string;
  maxVisibility: FriendVisibility;
  createdAt: string;
  viewerId: string;
  viewerName: string;
  viewerUsername: string;
}

/** A share the current user has RECEIVED — whose brain they can read. */
export interface SharedWithMe {
  id: string;
  maxVisibility: FriendVisibility;
  createdAt: string;
  ownerId: string;
  ownerName: string;
  ownerUsername: string;
}

/** A person found via /v1/users/search — by @handle or display name. */
export interface UserSummary {
  id: string;
  username: string;
  displayName: string;
}

export type SpaceKind = "self" | "company";
export type SpaceRole = "owner" | "admin" | "member";

/** A brain the user can act in: their personal "self" space or a company space. */
export interface Space {
  id: string;
  kind: SpaceKind;
  slug: string | null;
  name: string;
  ownerUserId: string;
  themeColor: string | null;
  logoUrl: string | null;
  role?: SpaceRole;
}

export interface SpaceMember {
  userId: string;
  name: string;
  username: string;
  role: SpaceRole;
  createdAt: string;
}

export interface Me {
  userId: string;
  spaceId: string;
  role: SpaceRole;
  scope: Visibility;
  readonly: boolean;
  via?: string;
  username: string | null;
  displayName: string | null;
}

/** Progress of a server-side historical backfill (fire-and-forget). */
export interface BackfillItem {
  title: string;
  outcome: "created" | "updated" | "noise" | "error";
  touched: number;
  at: string;
}

export interface BackfillState {
  status: "running" | "done" | "error";
  /** light = historical backfill (people/concepts); full = Sync now (meetings). */
  mode?: "light" | "full";
  lookbackMonths: number;
  done: number;
  total: number;
  startedAt: string;
  /** Transcript being distilled next (the live "now"). */
  current?: string;
  /** Most-recently finished transcripts (newest first) for the live feed. */
  recent?: BackfillItem[];
  lastStepAt?: string;
  finishedAt?: string;
  error?: string;
}

export interface ConnectionSettings {
  autoSync?: boolean;
  lookbackMonths?: number;
  keepRaw?: boolean;
  visibility?: Visibility;
  driveFolderId?: string;
  seenFileIds?: string[];
  backfill?: BackfillState;
  [key: string]: unknown;
}

/** An external connector account (e.g. a connected Google Drive for meetings). */
export interface Connection {
  id: string;
  provider: string;
  status: "active" | "error" | "disabled";
  accountEmail?: string;
  accountLabel?: string;
  lastSyncAt?: string;
  lastError?: string;
  settings: ConnectionSettings;
  createdAt: string;
}

export interface DriveNoteCandidate {
  id: string;
  name: string;
  modifiedTime?: string;
  createdTime?: string;
  webViewLink?: string;
}

export interface SyncResult {
  created: string[];
  updated: string[];
  skipped: string[];
  candidates?: DriveNoteCandidate[];
  ingestedIds?: string[];
  /** Fresh candidates handled this call (success + noise + error). */
  processed?: number;
  /** Fresh candidates still pending after this call. */
  remaining?: number;
  /** Fresh candidates at the start of this call (= processed + remaining). */
  total?: number;
}
