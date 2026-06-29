import { DEFAULT_CONFIG, loadConfig, type UserConfig } from "./config.js";
import { serviceClient } from "./supabase.js";

function usesSupabase(): boolean {
  return (process.env.VAULT_BACKEND ?? "supabase") !== "fs";
}

export async function getUserConfig(userId: string): Promise<UserConfig> {
  if (!usesSupabase()) return DEFAULT_CONFIG;
  const sb = serviceClient();
  const { data, error } = await sb
    .from("user_config")
    .select("config")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return DEFAULT_CONFIG;
  return loadConfig((data as { config: unknown }).config);
}

/** Best-effort display name for the brain's owner (from the profiles table).
 *  Returns null when unknown (e.g. the FS backend or a missing profile). */
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

export async function setUserConfig(userId: string, raw: unknown): Promise<UserConfig> {
  const config = loadConfig(raw);
  if (!usesSupabase()) return config;
  const sb = serviceClient();
  const { error } = await sb
    .from("user_config")
    .upsert({ user_id: userId, config, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error(`config save failed: ${error.message}`);
  return config;
}
