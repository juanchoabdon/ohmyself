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
