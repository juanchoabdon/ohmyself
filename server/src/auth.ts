import { clampScope, isScope } from "./core/scope.js";
import { serviceClient } from "./core/supabase.js";
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
 *  - Otherwise the token is treated as a Supabase user JWT. Authenticated users
 *    get full (`secret`) scope over their own brain, optionally downscoped via
 *    the `x-brain-scope` header (e.g. connect a personal agent at `private`).
 */
export async function resolveAuth(headers: {
  authorization?: string | null;
  "x-brain-scope"?: string | null;
}): Promise<AuthContext> {
  const token = bearer(headers.authorization);
  if (!token) throw new UnauthorizedError("missing bearer token");

  const publicToken = process.env.PUBLIC_AGENT_TOKEN;
  const publicUser = process.env.PUBLIC_AGENT_USER_ID;
  if (publicToken && token === publicToken) {
    if (!publicUser) throw new UnauthorizedError("PUBLIC_AGENT_USER_ID not configured");
    return { userId: publicUser, scope: "public", readonly: true };
  }

  const sb = serviceClient();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) throw new UnauthorizedError("invalid token");

  const requested = headers["x-brain-scope"];
  const scope: Scope = isScope(requested) ? clampScope(requested, "secret") : "secret";
  return { userId: data.user.id, scope, readonly: false };
}
