import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { serviceClient } from "./supabase.js";
import type { Scope } from "./types.js";

const ACCESS_PREFIX = "oma_";
const REFRESH_PREFIX = "omr_";

const ACCESS_TTL_S = Number(process.env.OAUTH_ACCESS_TTL_S ?? 3600); // 1h
const REFRESH_TTL_S = Number(process.env.OAUTH_REFRESH_TTL_S ?? 60 * 60 * 24 * 30); // 30d
const CODE_TTL_S = Number(process.env.OAUTH_CODE_TTL_S ?? 120); // 2 min

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** base64url-encoded SHA-256, used for PKCE S256 challenges. */
function s256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// ── Clients (Dynamic Client Registration, RFC 7591) ──────────────────────────

export interface OAuthClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  token_endpoint_auth_method: string;
}

export interface RegisterClientInput {
  client_name?: string;
  redirect_uris: string[];
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
}

export async function registerClient(input: RegisterClientInput): Promise<OAuthClient> {
  const client_id = "omc_" + randomBytes(18).toString("base64url");
  const row = {
    client_id,
    client_name: input.client_name?.slice(0, 200) || "MCP client",
    redirect_uris: input.redirect_uris,
    grant_types: input.grant_types?.length ? input.grant_types : ["authorization_code", "refresh_token"],
    token_endpoint_auth_method: "none",
  };
  const sb = serviceClient();
  const { error } = await sb.from("oauth_clients").insert(row);
  if (error) throw new Error(error.message);
  return row;
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  const sb = serviceClient();
  const { data } = await sb
    .from("oauth_clients")
    .select("client_id,client_name,redirect_uris,grant_types,token_endpoint_auth_method")
    .eq("client_id", clientId)
    .maybeSingle();
  return (data as OAuthClient) ?? null;
}

// ── Authorization codes (single-use, PKCE-bound) ─────────────────────────────

export interface CreateAuthCodeInput {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod?: string;
  scope: Scope;
}

/** Mint a single-use authorization code; returns the plaintext code. */
export async function createAuthCode(input: CreateAuthCodeInput): Promise<string> {
  const code = "omac_" + randomBytes(24).toString("base64url");
  const sb = serviceClient();
  const { error } = await sb.from("oauth_auth_codes").insert({
    code_hash: sha256(code),
    client_id: input.clientId,
    user_id: input.userId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    code_challenge_method: input.codeChallengeMethod ?? "S256",
    scope: input.scope,
    expires_at: new Date(Date.now() + CODE_TTL_S * 1000).toISOString(),
  });
  if (error) throw new Error(error.message);
  return code;
}

export interface ConsumeAuthCodeInput {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}

/** Validate + burn an authorization code, verifying PKCE. Returns the bound
 *  user + consented scope, or null on any mismatch. */
export async function consumeAuthCode(
  input: ConsumeAuthCodeInput,
): Promise<{ userId: string; scope: Scope } | null> {
  const sb = serviceClient();
  const hash = sha256(input.code);
  const { data } = await sb
    .from("oauth_auth_codes")
    .select("client_id,user_id,redirect_uri,code_challenge,code_challenge_method,scope,expires_at,used")
    .eq("code_hash", hash)
    .maybeSingle();
  if (!data) return null;

  // Single-use: burn it immediately regardless of outcome.
  await sb.from("oauth_auth_codes").delete().eq("code_hash", hash);

  if (data.used) return null;
  if (new Date(data.expires_at as string).getTime() < Date.now()) return null;
  if (data.client_id !== input.clientId) return null;
  if (data.redirect_uri !== input.redirectUri) return null;

  // OAuth 2.1 for public clients: S256 only. Reject anything else (incl. `plain`)
  // so an intercepted code can't be exchanged without the SHA-256 pre-image.
  const method = (data.code_challenge_method as string) || "S256";
  if (method !== "S256") return null;
  const computed = s256(input.codeVerifier);
  if (!safeEqual(computed, data.code_challenge as string)) return null;

  return { userId: data.user_id as string, scope: data.scope as Scope };
}

// ── Tokens (access + rotating refresh) ───────────────────────────────────────

export interface IssuedTokens {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: Scope;
}

export async function issueTokens(
  clientId: string,
  userId: string,
  scope: Scope,
): Promise<IssuedTokens> {
  const access = ACCESS_PREFIX + randomBytes(24).toString("base64url");
  const refresh = REFRESH_PREFIX + randomBytes(24).toString("base64url");
  const sb = serviceClient();
  const now = Date.now();
  const { error } = await sb.from("oauth_tokens").insert([
    {
      token_hash: sha256(access),
      kind: "access",
      client_id: clientId,
      user_id: userId,
      scope,
      expires_at: new Date(now + ACCESS_TTL_S * 1000).toISOString(),
    },
    {
      token_hash: sha256(refresh),
      kind: "refresh",
      client_id: clientId,
      user_id: userId,
      scope,
      expires_at: new Date(now + REFRESH_TTL_S * 1000).toISOString(),
    },
  ]);
  if (error) throw new Error(error.message);
  return { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: ACCESS_TTL_S, scope };
}

/** Resolve an access token (oma_) to its owner + scope, or null. */
export async function lookupAccessToken(token: string): Promise<{ userId: string; scope: Scope } | null> {
  if (!token.startsWith(ACCESS_PREFIX)) return null;
  const sb = serviceClient();
  const { data } = await sb
    .from("oauth_tokens")
    .select("token_hash,user_id,scope,expires_at,revoked_at")
    .eq("token_hash", sha256(token))
    .eq("kind", "access")
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.expires_at as string).getTime() < Date.now()) return null;
  void sb.from("oauth_tokens").update({ last_used_at: new Date().toISOString() }).eq("token_hash", data.token_hash);
  return { userId: data.user_id as string, scope: data.scope as Scope };
}

/** Rotate a refresh token (omr_): revoke the old one, issue a fresh pair. */
export async function refreshTokens(token: string, clientId: string): Promise<IssuedTokens | null> {
  if (!token.startsWith(REFRESH_PREFIX)) return null;
  const sb = serviceClient();
  const hash = sha256(token);
  const { data } = await sb
    .from("oauth_tokens")
    .select("token_hash,client_id,user_id,scope,expires_at,revoked_at")
    .eq("token_hash", hash)
    .eq("kind", "refresh")
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return null;
  if (data.client_id !== clientId) return null;
  if (new Date(data.expires_at as string).getTime() < Date.now()) return null;

  await sb.from("oauth_tokens").update({ revoked_at: new Date().toISOString() }).eq("token_hash", hash);
  return issueTokens(clientId, data.user_id as string, data.scope as Scope);
}
