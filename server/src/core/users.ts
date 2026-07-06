import { serviceClient } from "./supabase.js";
import { BadRequestError } from "./errors.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  username: string | null;
}

export interface UserSummary {
  id: string;
  username: string;
  displayName: string;
}

/** Best display name: display_name, else username, else email local-part. */
export function nameOf(p: Pick<ProfileRow, "display_name" | "username" | "email">): string {
  return p.display_name?.trim() || p.username?.trim() || p.email?.split("@")[0] || "someone";
}

function toSummary(p: ProfileRow): UserSummary {
  return { id: p.id, username: p.username ?? "", displayName: nameOf(p) };
}

export function normalizeUsername(raw: string): string {
  const clean = raw.trim().replace(/^@/, "").toLowerCase();
  if (!USERNAME_RE.test(clean)) {
    throw new BadRequestError("handles are 3-20 characters: lowercase letters, numbers, underscores");
  }
  return clean;
}

async function findOne(column: "id" | "email" | "username", value: string): Promise<ProfileRow | null> {
  const sb = serviceClient();
  const query = sb.from("profiles").select("id,email,display_name,username");
  const { data, error } =
    column === "id" ? await query.eq("id", value).maybeSingle() : await query.ilike(column, value).maybeSingle();
  if (error || !data) return null;
  return data as ProfileRow;
}

export const findById = (id: string) => findOne("id", id);
export const findByEmail = (email: string) => findOne("email", email.trim());
export const findByUsername = (username: string) => findOne("username", username.trim());

/** Resolve a user id, exact email, or @handle (with or without the `@`) to a
 *  profile. Used wherever a person picks another user (e.g. sharing a brain). */
export async function resolveIdentifier(identifier: string): Promise<ProfileRow | null> {
  const clean = identifier.trim();
  if (!clean) return null;
  if (UUID_RE.test(clean)) return findById(clean);
  if (clean.includes("@") && !clean.startsWith("@")) return findByEmail(clean);
  return findByUsername(clean.replace(/^@/, ""));
}

/** Batch-fetch profiles by id (no direct FK from friend_shares to profiles
 *  for PostgREST to embed, so callers merge these in application code). */
export async function usersById(ids: string[]): Promise<Map<string, ProfileRow>> {
  const unique = [...new Set(ids)];
  const map = new Map<string, ProfileRow>();
  if (unique.length === 0) return map;
  const sb = serviceClient();
  const { data, error } = await sb.from("profiles").select("id,email,display_name,username").in("id", unique);
  if (error || !data) return map;
  for (const row of data as ProfileRow[]) map.set(row.id, row);
  return map;
}

/** Search people by @handle or display name (never by raw email) so a user
 *  can find a friend to share with without knowing their exact address. */
export async function searchUsers(query: string, excludeUserId: string, limit = 10): Promise<UserSummary[]> {
  const q = query.trim().replace(/^@/, "");
  if (q.length < 2) return [];
  const sb = serviceClient();
  const { data, error } = await sb
    .from("profiles")
    .select("id,email,display_name,username")
    .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
    .neq("id", excludeUserId)
    .limit(limit);
  if (error || !data) return [];
  return (data as ProfileRow[]).map(toSummary);
}

export async function getProfileSummary(userId: string): Promise<UserSummary | null> {
  const p = await findById(userId);
  return p ? toSummary(p) : null;
}

/** Set the caller's public @handle. Case-insensitively unique across all users. */
export async function setUsername(userId: string, raw: string): Promise<string> {
  const clean = normalizeUsername(raw);
  const sb = serviceClient();
  const { data: conflict } = await sb
    .from("profiles")
    .select("id")
    .ilike("username", clean)
    .neq("id", userId)
    .maybeSingle();
  if (conflict) throw new BadRequestError(`@${clean} is already taken`);
  const { error } = await sb.from("profiles").update({ username: clean }).eq("id", userId);
  if (error) throw new Error(error.message);
  return clean;
}
