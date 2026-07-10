/**
 * Google OAuth 2.0 helper for the Drive/Gemini meetings connector.
 *
 * Separate from Supabase Auth (which handles sign-in): this obtains a
 * long-lived refresh token for READ-ONLY Drive access so the server can
 * discover and export Gemini meeting notes on the user's behalf. The refresh
 * token is stored encrypted via core/connections.ts.
 */

import crypto from "node:crypto";

/** Provider id used for Google Drive/Gemini meeting-note connections. */
export const GOOGLE_DRIVE_MEETINGS_PROVIDER = "google-drive-meetings";

export const GOOGLE_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const STATE_TTL_MS = 10 * 60 * 1000;

function clientId(): string {
  const v = process.env.GOOGLE_CLIENT_ID;
  if (!v) throw new Error("GOOGLE_CLIENT_ID is not set");
  return v;
}
function clientSecret(): string {
  const v = process.env.GOOGLE_CLIENT_SECRET;
  if (!v) throw new Error("GOOGLE_CLIENT_SECRET is not set");
  return v;
}
function redirectUri(): string {
  return process.env.GOOGLE_REDIRECT_URI || "http://localhost:8787/connectors/google/callback";
}

export function googleAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// ── Signed state (ties the anonymous callback back to the logged-in user) ────

function stateSecret(): Buffer {
  const secret = process.env.CONNECTION_ENC_KEY || process.env.CRON_SECRET || "";
  if (!secret) throw new Error("CONNECTION_ENC_KEY must be set to sign OAuth state");
  return crypto.createHash("sha256").update(`google-oauth:${secret}`).digest();
}

export function signState(userId: string, spaceId?: string): string {
  // spaceId is the brain the resulting connection ingests into. Defaults to the
  // user's self space (spaceId == userId) when omitted, preserving old links.
  const payload = Buffer.from(
    JSON.stringify({ userId, spaceId: spaceId ?? userId, ts: Date.now() }),
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyState(state: string): { userId: string; spaceId: string } | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { userId, spaceId, ts } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof userId !== "string" || typeof ts !== "number") return null;
    if (Date.now() - ts > STATE_TTL_MS) return null;
    // Older links without spaceId fall back to the self space (== userId).
    return { userId, spaceId: typeof spaceId === "string" ? spaceId : userId };
  } catch {
    return null;
  }
}

// ── OAuth flow ───────────────────────────────────────────────────────────────

export function buildAuthorizeUrl(userId: string, spaceId?: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_DRIVE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: signState(userId, spaceId),
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope?: string;
}

export async function exchangeCode(code: string): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number; scope?: string };
  return {
    accessToken: data.access_token,
    refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  };
}

export interface GoogleUserInfo {
  email: string;
  name?: string;
}

export async function fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google userinfo failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { email?: string; name?: string };
  return { email: data.email ?? "", name: data.name };
}
