import { serviceClient } from "./supabase.js";
import { slugify } from "./brain.js";
import { BadRequestError, NotFoundError } from "./errors.js";
import { seedSpaceConfig } from "./config-store.js";
import { nameOf, resolveIdentifier, usersById } from "./users.js";
import type { SpaceRole } from "./types.js";

export type SpaceKind = "self" | "company";

/** A brain the user can act in: their personal "self" space or a company space. */
export interface Space {
  id: string;
  kind: SpaceKind;
  slug: string | null;
  name: string;
  ownerUserId: string;
  themeColor: string | null;
  logoUrl: string | null;
  /** The caller's role — present when the space is listed for a specific user. */
  role?: SpaceRole;
}

interface SpaceRow {
  id: string;
  kind: SpaceKind;
  slug: string | null;
  name: string;
  owner_user_id: string;
  theme_color: string | null;
  logo_url: string | null;
}

function mapSpace(r: SpaceRow, role?: SpaceRole): Space {
  return {
    id: r.id,
    kind: r.kind,
    slug: r.slug,
    name: r.name,
    ownerUserId: r.owner_user_id,
    themeColor: r.theme_color,
    logoUrl: r.logo_url,
    ...(role ? { role } : {}),
  };
}

const SPACE_COLS = "id, kind, slug, name, owner_user_id, theme_color, logo_url";

export async function getSpace(spaceId: string): Promise<Space | null> {
  const sb = serviceClient();
  const { data, error } = await sb.from("spaces").select(SPACE_COLS).eq("id", spaceId).maybeSingle();
  if (error || !data) return null;
  return mapSpace(data as SpaceRow);
}

/** The caller's role in a space, or null if they are not a member. Self spaces
 *  (space.id === userId) always resolve to `owner` without a query. */
export async function resolveRole(userId: string, spaceId: string): Promise<SpaceRole | null> {
  if (spaceId === userId) return "owner";
  const sb = serviceClient();
  const { data, error } = await sb
    .from("space_members")
    .select("role")
    .eq("space_id", spaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { role: SpaceRole }).role;
}

/** Every space the user belongs to (self first, then companies by name). */
export async function listSpacesForUser(userId: string): Promise<Space[]> {
  const sb = serviceClient();
  const { data, error } = await sb
    .from("space_members")
    .select(`role, spaces:space_id (${SPACE_COLS})`)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as { role: SpaceRole; spaces: SpaceRow | SpaceRow[] | null }[];
  const spaces = rows
    .map((r) => {
      const row = Array.isArray(r.spaces) ? r.spaces[0] : r.spaces;
      return row ? mapSpace(row, r.role) : null;
    })
    .filter((s): s is Space => s !== null);
  spaces.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "self" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return spaces;
}

async function uniqueSlug(base: string): Promise<string> {
  const sb = serviceClient();
  let slug = slugify(base) || "space";
  for (let i = 0; i < 50; i++) {
    const { data } = await sb.from("spaces").select("id").ilike("slug", slug).maybeSingle();
    if (!data) return slug;
    slug = `${slugify(base) || "space"}-${i + 2}`;
  }
  return `${slugify(base) || "space"}-${Date.now().toString(36)}`;
}

export interface CreateSpaceInput {
  ownerUserId: string;
  name: string;
  slug?: string;
  themeColor?: string | null;
  logoUrl?: string | null;
}

/** Create a company space, make the creator its owner, and seed the default
 *  company taxonomy so it opens pre-populated with the right sections. */
export async function createCompanySpace(input: CreateSpaceInput): Promise<Space> {
  const name = input.name.trim();
  if (!name) throw new BadRequestError("space name is required");
  const slug = await uniqueSlug(input.slug || name);

  const sb = serviceClient();
  const { data, error } = await sb
    .from("spaces")
    .insert({
      kind: "company",
      slug,
      name,
      owner_user_id: input.ownerUserId,
      theme_color: input.themeColor ?? null,
      logo_url: input.logoUrl ?? null,
    })
    .select(SPACE_COLS)
    .single();
  if (error || !data) throw new Error(error?.message ?? "could not create space");
  const space = mapSpace(data as SpaceRow, "owner");

  const { error: memberErr } = await sb
    .from("space_members")
    .upsert({ space_id: space.id, user_id: input.ownerUserId, role: "owner" }, { onConflict: "space_id,user_id" });
  if (memberErr) throw new Error(memberErr.message);

  await seedSpaceConfig(space.id, "company");
  return space;
}

export interface UpdateSpaceInput {
  name?: string;
  themeColor?: string | null;
  logoUrl?: string | null;
}

/** Update a space's name/branding. Caller must be the owner (enforced upstream). */
export async function updateSpace(spaceId: string, patch: UpdateSpaceInput): Promise<Space> {
  const sb = serviceClient();
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.themeColor !== undefined) update.theme_color = patch.themeColor;
  if (patch.logoUrl !== undefined) update.logo_url = patch.logoUrl;
  const { data, error } = await sb.from("spaces").update(update).eq("id", spaceId).select(SPACE_COLS).single();
  if (error || !data) throw new Error(error?.message ?? "could not update space");
  return mapSpace(data as SpaceRow);
}

// ── Membership roster ─────────────────────────────────────────────────────────

export interface SpaceMember {
  userId: string;
  name: string;
  username: string;
  role: SpaceRole;
  createdAt: string;
}

export async function listMembers(spaceId: string): Promise<SpaceMember[]> {
  const sb = serviceClient();
  const { data, error } = await sb
    .from("space_members")
    .select("user_id, role, created_at")
    .eq("space_id", spaceId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { user_id: string; role: SpaceRole; created_at: string }[];
  const profiles = await usersById(rows.map((r) => r.user_id));
  return rows.map((r) => {
    const p = profiles.get(r.user_id);
    return {
      userId: r.user_id,
      name: p ? nameOf(p) : "unknown",
      username: p?.username ?? "",
      role: r.role,
      createdAt: r.created_at,
    };
  });
}

/** Add a member to a company space by user id, exact email, or @handle. */
export async function addMember(
  spaceId: string,
  identifier: string,
  role: Exclude<SpaceRole, "owner"> = "member",
): Promise<SpaceMember> {
  if (!identifier.trim()) throw new BadRequestError("who to add is required");
  const user = await resolveIdentifier(identifier);
  if (!user) throw new NotFoundError(`no ohmyself! account matching '${identifier.trim()}'`);

  const sb = serviceClient();
  const { error } = await sb
    .from("space_members")
    .upsert({ space_id: spaceId, user_id: user.id, role }, { onConflict: "space_id,user_id" });
  if (error) throw new Error(error.message);
  return {
    userId: user.id,
    name: nameOf(user),
    username: user.username ?? "",
    role,
    createdAt: new Date().toISOString(),
  };
}

export async function updateMemberRole(
  spaceId: string,
  userId: string,
  role: Exclude<SpaceRole, "owner">,
): Promise<void> {
  const sb = serviceClient();
  // Never demote the owner via this path (owner is defined by spaces.owner_user_id).
  const { data: space } = await sb.from("spaces").select("owner_user_id").eq("id", spaceId).maybeSingle();
  if (space && (space as { owner_user_id: string }).owner_user_id === userId) {
    throw new BadRequestError("the owner's role can't be changed");
  }
  const { error } = await sb
    .from("space_members")
    .update({ role })
    .eq("space_id", spaceId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function removeMember(spaceId: string, userId: string): Promise<void> {
  const sb = serviceClient();
  const { data: space } = await sb.from("spaces").select("owner_user_id").eq("id", spaceId).maybeSingle();
  if (space && (space as { owner_user_id: string }).owner_user_id === userId) {
    throw new BadRequestError("the owner can't be removed from their own space");
  }
  const { error } = await sb.from("space_members").delete().eq("space_id", spaceId).eq("user_id", userId);
  if (error) throw new Error(error.message);
}

/** All self-space ids (personal brains). Paginated; optional single-id filter. */
export async function listSelfSpaceIds(only?: string): Promise<string[]> {
  if (only) return [only];
  const sb = serviceClient();
  const ids: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("spaces")
      .select("id")
      .eq("kind", "self")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`listSelfSpaceIds: ${error.message}`);
    const batch = (data as { id: string }[] | null) ?? [];
    ids.push(...batch.map((r) => r.id));
    if (batch.length < PAGE) break;
  }
  return ids;
}
