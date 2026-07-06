import { serviceClient } from "./supabase.js";
import { slugify } from "./brain.js";
import { BadRequestError, NotFoundError } from "./errors.js";
import { nameOf, resolveIdentifier, usersById } from "./users.js";
import type { Visibility } from "./types.js";

/** The ceiling a brain owner can share with a friend. Never `secret`. */
export type FriendVisibility = Extract<Visibility, "public" | "private">;

export function isFriendVisibility(v: unknown): v is FriendVisibility {
  return v === "public" || v === "private";
}

export interface FriendShare {
  id: string;
  maxVisibility: FriendVisibility;
  createdAt: string;
}

/** A share the current user has GIVEN — who can read their brain, and how much. */
export interface SharedByMe extends FriendShare {
  viewerId: string;
  viewerName: string;
  viewerUsername: string;
}

/** A share the current user has RECEIVED — whose brain they can read. */
export interface SharedWithMe extends FriendShare {
  ownerId: string;
  ownerName: string;
  ownerUsername: string;
}

/** Share `ownerId`'s brain, read-only, up to `maxVisibility`, with another
 *  ohmyself! account — identified by user id, exact email, or @handle.
 *  Creates or updates the grant. */
export async function shareWith(
  ownerId: string,
  identifier: string,
  maxVisibility: FriendVisibility,
): Promise<SharedByMe> {
  if (!identifier.trim()) throw new BadRequestError("who to share with is required");
  const viewer = await resolveIdentifier(identifier);
  if (!viewer) throw new NotFoundError(`no ohmyself! account matching '${identifier.trim()}'`);
  if (viewer.id === ownerId) throw new BadRequestError("you can't share with yourself");

  const sb = serviceClient();
  const { data, error } = await sb
    .from("friend_shares")
    .upsert(
      { owner_id: ownerId, viewer_id: viewer.id, max_visibility: maxVisibility },
      { onConflict: "owner_id,viewer_id" },
    )
    .select("id,max_visibility,created_at")
    .single();
  if (error || !data) throw new Error(error?.message ?? "could not create share");
  const row = data as { id: string; max_visibility: FriendVisibility; created_at: string };
  return {
    id: row.id,
    maxVisibility: row.max_visibility,
    createdAt: row.created_at,
    viewerId: viewer.id,
    viewerName: nameOf(viewer),
    viewerUsername: viewer.username ?? "",
  };
}

export async function listSharedByMe(ownerId: string): Promise<SharedByMe[]> {
  const sb = serviceClient();
  const { data, error } = await sb
    .from("friend_shares")
    .select("id,max_visibility,created_at,viewer_id")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: string; max_visibility: FriendVisibility; created_at: string; viewer_id: string }[];
  const profiles = await usersById(rows.map((r) => r.viewer_id));
  return rows.map((r) => {
    const p = profiles.get(r.viewer_id);
    return {
      id: r.id,
      maxVisibility: r.max_visibility,
      createdAt: r.created_at,
      viewerId: r.viewer_id,
      viewerName: p ? nameOf(p) : "unknown",
      viewerUsername: p?.username ?? "",
    };
  });
}

export async function listSharedWithMe(viewerId: string): Promise<SharedWithMe[]> {
  const sb = serviceClient();
  const { data, error } = await sb
    .from("friend_shares")
    .select("id,max_visibility,created_at,owner_id")
    .eq("viewer_id", viewerId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: string; max_visibility: FriendVisibility; created_at: string; owner_id: string }[];
  const profiles = await usersById(rows.map((r) => r.owner_id));
  return rows.map((r) => {
    const p = profiles.get(r.owner_id);
    return {
      id: r.id,
      maxVisibility: r.max_visibility,
      createdAt: r.created_at,
      ownerId: r.owner_id,
      ownerName: p ? nameOf(p) : "unknown",
      ownerUsername: p?.username ?? "",
    };
  });
}

export async function revokeShare(ownerId: string, id: string): Promise<void> {
  const sb = serviceClient();
  const { error } = await sb.from("friend_shares").delete().eq("owner_id", ownerId).eq("id", id);
  if (error) throw new Error(error.message);
}

/** A friend's brain, addressable by a stable slug (derived from their name),
 *  for the MCP "friend" tools. Built once per connection. */
export interface FriendEntry {
  slug: string;
  ownerId: string;
  name: string;
  maxVisibility: FriendVisibility;
}

/** All brains currently shared with `viewerId`, keyed by a unique slug. */
export async function buildFriendDirectory(viewerId: string): Promise<FriendEntry[]> {
  const shares = await listSharedWithMe(viewerId);
  const seen = new Set<string>();
  return shares.map((s) => {
    let slug = slugify(s.ownerUsername || s.ownerName) || "friend";
    while (seen.has(slug)) slug = `${slug}-${s.ownerId.slice(0, 4)}`;
    seen.add(slug);
    return { slug, ownerId: s.ownerId, name: s.ownerName, maxVisibility: s.maxVisibility };
  });
}
