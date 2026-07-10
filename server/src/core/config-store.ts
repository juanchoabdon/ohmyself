import { DEFAULT_CONFIG, DEFAULT_COMPANY_CONFIG, loadConfig, type UserConfig } from "./config.js";
import { serviceClient } from "./supabase.js";

function usesSupabase(): boolean {
  return (process.env.VAULT_BACKEND ?? "supabase") !== "fs";
}

/** The default taxonomy for a space, chosen by its kind. */
function defaultConfigForKind(kind: string | null | undefined): UserConfig {
  return kind === "company" ? DEFAULT_COMPANY_CONFIG : DEFAULT_CONFIG;
}

async function spaceKind(spaceId: string): Promise<"self" | "company" | null> {
  const sb = serviceClient();
  const { data, error } = await sb.from("spaces").select("kind").eq("id", spaceId).maybeSingle();
  if (error || !data) return null;
  return (data as { kind: "self" | "company" }).kind;
}

/** The active taxonomy/config for a space. Falls back to the kind's default
 *  when the space has no explicit config row yet. */
export async function getSpaceConfig(spaceId: string): Promise<UserConfig> {
  if (!usesSupabase()) return DEFAULT_CONFIG;
  const sb = serviceClient();
  const { data, error } = await sb
    .from("user_config")
    .select("config")
    .eq("space_id", spaceId)
    .maybeSingle();
  const raw = (data as { config?: unknown } | null)?.config;
  if (!error && raw && typeof raw === "object" && Object.keys(raw as object).length > 0) {
    return loadConfig(raw);
  }
  return defaultConfigForKind(await spaceKind(spaceId));
}

/** Back-compat alias: for a self space, `spaceId === userId`. */
export const getUserConfig = getSpaceConfig;

/** Best-effort display name for a user (from the profiles table). Keyed by the
 *  user id (identity), not the space. Returns null when unknown. */
export async function getDisplayName(userId: string): Promise<string | null> {
  if (!usesSupabase()) return null;
  const sb = serviceClient();
  const { data, error } = await sb
    .from("profiles")
    .select("display_name, email")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { display_name?: string | null; email?: string | null };
  return row.display_name?.trim() || row.email?.split("@")[0] || null;
}

export async function setSpaceConfig(spaceId: string, raw: unknown): Promise<UserConfig> {
  const config = loadConfig(raw);
  if (!usesSupabase()) return config;
  const sb = serviceClient();
  const { error } = await sb
    .from("user_config")
    .upsert({ space_id: spaceId, config, updated_at: new Date().toISOString() }, { onConflict: "space_id" });
  if (error) throw new Error(`config save failed: ${error.message}`);
  return config;
}

/** Back-compat alias: for a self space, `spaceId === userId`. */
export const setUserConfig = setSpaceConfig;

/** Seed a fresh space with the default taxonomy for its kind. Used on company
 *  space creation so it opens pre-populated with the right sections. */
export async function seedSpaceConfig(spaceId: string, kind: "self" | "company"): Promise<void> {
  await setSpaceConfig(spaceId, defaultConfigForKind(kind));
}
