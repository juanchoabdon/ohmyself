import { createHash, randomBytes } from "node:crypto";
import { serviceClient } from "./supabase.js";
import type { Scope } from "./types.js";

const PREFIX = "oms_";

export interface ApiTokenRow {
  id: string;
  name: string;
  scope: Scope;
  preview: string;
  created_at: string;
  last_used_at: string | null;
}

export interface TokenLookup {
  userId: string;
  scope: Scope;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Resolve a personal API token to its owner + scope, or null if it's not one
 *  of ours (e.g. a Supabase JWT). Touches last_used_at best-effort. */
export async function lookupToken(token: string): Promise<TokenLookup | null> {
  if (!token.startsWith(PREFIX)) return null;
  const sb = serviceClient();
  const { data, error } = await sb
    .from("api_tokens")
    .select("id,user_id,scope")
    .eq("token_hash", hashToken(token))
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  void sb.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { userId: data.user_id as string, scope: data.scope as Scope };
}

export async function createToken(
  userId: string,
  name: string,
  scope: Scope,
): Promise<{ token: string; row: ApiTokenRow }> {
  const token = PREFIX + randomBytes(24).toString("base64url");
  const preview = `${token.slice(0, PREFIX.length + 5)}…`;
  const sb = serviceClient();
  const { data, error } = await sb
    .from("api_tokens")
    .insert({ user_id: userId, name: name || "token", scope, preview, token_hash: hashToken(token) })
    .select("id,name,scope,preview,created_at,last_used_at")
    .single();
  if (error || !data) throw new Error(error?.message ?? "could not create token");
  return { token, row: data as ApiTokenRow };
}

export async function listTokens(userId: string): Promise<ApiTokenRow[]> {
  const sb = serviceClient();
  const { data, error } = await sb
    .from("api_tokens")
    .select("id,name,scope,preview,created_at,last_used_at")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ApiTokenRow[];
}

export async function revokeToken(userId: string, id: string): Promise<void> {
  const sb = serviceClient();
  const { error } = await sb
    .from("api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw new Error(error.message);
}
