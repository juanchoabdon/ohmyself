import { clampScope, isScope } from "./core/scope.js";
import { serviceClient } from "./core/supabase.js";
import { lookupToken } from "./core/tokens.js";
import { lookupAccessToken } from "./core/oauth.js";
import { UnauthorizedError } from "./core/errors.js";
import type { AuthContext, Scope } from "./core/types.js";

function bearer(header?: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? (m[1] as string) : header.trim();
}

/**
 * Resolve identity + capability from request headers.
 *  - The PUBLIC_AGENT_TOKEN maps to a read-only `public` scope for a fixed user
 *    (the brain the public website agent answers about).
 *  - A personal API token (prefix `oms_`) maps to its owner + the token's scope.
 *    These are long-lived and meant for MCP clients / external tools.
 *  - Otherwise the token is treated as a Supabase user JWT (the web session).
 *    Authenticated users get full (`secret`) scope over their own brain.
 *
 *  In all cases the effective scope can be downscoped (never up) via the
 *  `x-brain-scope` header (e.g. connect a personal agent at `private`).
 */
export async function resolveAuth(headers: {
  authorization?: string | null;
  "x-brain-scope"?: string | null;
}): Promise<AuthContext> {
  const token = bearer(headers.authorization);
  if (!token) throw new UnauthorizedError("missing bearer token");

  const requested = headers["x-brain-scope"];
  const withScope = (userId: string, max: Scope, via: AuthContext["via"]): AuthContext => {
    const scope = isScope(requested) ? clampScope(requested, max) : max;
    return { userId, scope, readonly: scope === "public", via };
  };

  const publicToken = process.env.PUBLIC_AGENT_TOKEN;
  const publicUser = process.env.PUBLIC_AGENT_USER_ID;
  if (publicToken && token === publicToken) {
    if (!publicUser) throw new UnauthorizedError("PUBLIC_AGENT_USER_ID not configured");
    return { userId: publicUser, scope: "public", readonly: true, via: "public" };
  }

  // Personal API token (returns null fast for non-`oms_` tokens, e.g. JWTs).
  const tok = await lookupToken(token);
  if (tok) return withScope(tok.userId, tok.scope, "token");

  // OAuth 2.1 access token (`oma_`) issued to a Claude / ChatGPT connector.
  const oauth = await lookupAccessToken(token);
  if (oauth) return withScope(oauth.userId, oauth.scope, "oauth");

  const sb = serviceClient();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) throw new UnauthorizedError("invalid token");
  return withScope(data.user.id, "secret", "jwt");
}
