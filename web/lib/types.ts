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

export interface Category {
  folder: string;
  label: string;
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

/** The ceiling a brain owner can share with a friend. Never `secret`. */
export type FriendVisibility = Extract<Visibility, "public" | "private">;

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

export interface Me {
  userId: string;
  scope: Visibility;
  readonly: boolean;
  via?: string;
  username: string | null;
  displayName: string | null;
}
