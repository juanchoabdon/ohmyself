import { clampScope, isScope } from "./core/scope.js";
import { serviceClient } from "./core/supabase.js";
import { lookupToken } from "./core/tokens.js";
import { lookupAccessToken } from "./core/oauth.js";
import { UnauthorizedError } from "./core/errors.js";
import { resolveRole } from "./core/spaces.js";
import type { AuthContext, Scope, SpaceRole } from "./core/types.js";

function bearer(header?: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? (m[1] as string) : header.trim();
}

/** A caller's identity + capability, before the active space is resolved. */
interface BaseAuth {
  userId: string;
  scope: Scope;
  readonly: boolean;
  via: AuthContext["via"];
}

/**
 * Resolve the active space for a request and attach it to the base auth.
 *  - No `x-brain-space` (or it names the caller's own self space) → the personal
 *    space, where `spaceId === userId` and the caller is `owner`.
 *  - A company space id → verified against `space_members`; non-members are
 *    rejected so a company header can never leak another brain.
 */
async function attachSpace(base: BaseAuth, requestedSpace?: string | null): Promise<AuthContext> {
  const wanted = requestedSpace?.trim();
  if (!wanted || wanted === base.userId) {
    return { ...base, spaceId: base.userId, role: "owner" };
  }
  const role: SpaceRole | null = await resolveRole(base.userId, wanted);
  if (!role) throw new UnauthorizedError("not a member of this space");
  return { ...base, spaceId: wanted, role };
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
 *  The effective scope can be downscoped (never up) via `x-brain-scope`, and the
 *  active brain is selected via `x-brain-space` (defaults to the personal space).
 */
export async function resolveAuth(headers: {
  authorization?: string | null;
  "x-brain-scope"?: string | null;
  "x-brain-space"?: string | null;
}): Promise<AuthContext> {
  const token = bearer(headers.authorization);
  if (!token) throw new UnauthorizedError("missing bearer token");

  const requested = headers["x-brain-scope"];
  const requestedSpace = headers["x-brain-space"];
  const base = (userId: string, max: Scope, via: AuthContext["via"]): BaseAuth => {
    const scope = isScope(requested) ? clampScope(requested, max) : max;
    return { userId, scope, readonly: scope === "public", via };
  };

  const publicToken = process.env.PUBLIC_AGENT_TOKEN;
  const publicUser = process.env.PUBLIC_AGENT_USER_ID;
  if (publicToken && token === publicToken) {
    if (!publicUser) throw new UnauthorizedError("PUBLIC_AGENT_USER_ID not configured");
    return attachSpace(
      { userId: publicUser, scope: "public", readonly: true, via: "public" },
      requestedSpace,
    );
  }

  // Personal API token (returns null fast for non-`oms_` tokens, e.g. JWTs).
  const tok = await lookupToken(token);
  if (tok) return attachSpace(base(tok.userId, tok.scope, "token"), requestedSpace);

  // OAuth 2.1 access token (`oma_`) issued to a Claude / ChatGPT connector.
  const oauth = await lookupAccessToken(token);
  if (oauth) return attachSpace(base(oauth.userId, oauth.scope, "oauth"), requestedSpace);

  const sb = serviceClient();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) throw new UnauthorizedError("invalid token");
  return attachSpace(base(data.user.id, "secret", "jwt"), requestedSpace);
}
