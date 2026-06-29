import type { Context, Hono } from "hono";
import { resolveAuth } from "../auth.js";
import {
  consumeAuthCode,
  createAuthCode,
  getClient,
  issueTokens,
  refreshTokens,
  registerClient,
  isScope,
  type OAuthClient,
} from "../core/index.js";
import type { Scope } from "../core/index.js";

const SCOPES = ["public", "private", "secret", "offline_access"];

/** Public base URLs. In single-domain prod all three are www.ohmyself.ai; in
 *  dev the issuer/API is :8787 and the web app is :3000. */
function bases(): { issuer: string; web: string } {
  const issuer = (
    process.env.OMS_ISSUER ||
    process.env.PUBLIC_API_URL ||
    `http://localhost:${process.env.PORT ?? 8787}`
  ).replace(/\/+$/, "");
  const web = (process.env.PUBLIC_WEB_URL || issuer).replace(/\/+$/, "");
  return { issuer, web };
}

function isLoopback(u: URL): boolean {
  return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1";
}

/** Exact redirect_uri match, with port-agnostic loopback matching for native
 *  clients like Claude Code (per the MCP auth guidance). */
function redirectAllowed(client: OAuthClient, redirectUri: string): boolean {
  if (client.redirect_uris.includes(redirectUri)) return true;
  let u: URL;
  try {
    u = new URL(redirectUri);
  } catch {
    return false;
  }
  if (!isLoopback(u)) return false;
  return client.redirect_uris.some((r) => {
    try {
      const ru = new URL(r);
      return isLoopback(ru) && ru.pathname === u.pathname;
    } catch {
      return false;
    }
  });
}

async function readParams(c: Context): Promise<Record<string, string>> {
  const ct = c.req.header("content-type") ?? "";
  if (ct.includes("application/json")) {
    return ((await c.req.json().catch(() => ({}))) as Record<string, string>) ?? {};
  }
  const body = await c.req.parseBody().catch(() => ({}));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) out[k] = typeof v === "string" ? v : String(v);
  return out;
}

function tokenError(c: Context, error: string, status = 400) {
  return c.json({ error }, status as 400, { "Cache-Control": "no-store" });
}

/** Register the OAuth 2.1 endpoints + discovery documents on the app. These are
 *  public (no /v1 auth guard) and inherit the app-level CORS. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerOAuth(app: Hono<any>): void {
  // ── Discovery (RFC 8414 + RFC 9728) ──────────────────────────────────────
  app.get("/.well-known/oauth-authorization-server", (c) => {
    const { issuer, web } = bases();
    return c.json({
      issuer,
      authorization_endpoint: `${web}/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: SCOPES,
      service_documentation: web,
    });
  });

  const protectedResource = (c: Context) => {
    const { issuer, web } = bases();
    return c.json({
      resource: `${issuer}/mcp`,
      authorization_servers: [issuer],
      scopes_supported: SCOPES,
      bearer_methods_supported: ["header"],
      resource_documentation: web,
    });
  };
  app.get("/.well-known/oauth-protected-resource", protectedResource);
  // Path-suffixed variant some clients (Claude) probe.
  app.get("/.well-known/oauth-protected-resource/:rest{.+}", protectedResource);

  // ── Dynamic Client Registration (RFC 7591) ───────────────────────────────
  app.post("/oauth/register", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      client_name?: string;
      redirect_uris?: unknown;
      grant_types?: string[];
      token_endpoint_auth_method?: string;
    };
    const redirect_uris = Array.isArray(body.redirect_uris)
      ? body.redirect_uris.filter((u): u is string => typeof u === "string")
      : [];
    if (redirect_uris.length === 0) {
      return c.json({ error: "invalid_redirect_uri", error_description: "redirect_uris is required" }, 400);
    }
    const client = await registerClient({
      client_name: body.client_name,
      redirect_uris,
      grant_types: body.grant_types,
    });
    return c.json(
      {
        client_id: client.client_id,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        grant_types: client.grant_types,
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      201,
    );
  });

  // ── Redirect validation (called by the web /authorize page before it renders
  //    or performs a deny-redirect, to prevent an open redirect to an
  //    attacker-controlled redirect_uri). Public; reveals only a boolean. ──
  app.get("/oauth/authorize/validate", async (c) => {
    const clientId = c.req.query("client_id") ?? "";
    const redirectUri = c.req.query("redirect_uri") ?? "";
    if (!clientId || !redirectUri) return c.json({ ok: false });
    const client = await getClient(clientId);
    const ok = !!client && redirectAllowed(client, redirectUri);
    return c.json({ ok });
  });

  // ── Consent grant (called by the web /authorize page with a Supabase JWT) ──
  app.post("/oauth/authorize/grant", async (c) => {
    let auth;
    try {
      auth = await resolveAuth({ authorization: c.req.header("authorization") });
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }
    if (auth.via !== "jwt") return c.json({ error: "must be a signed-in session" }, 403);

    const body = (await c.req.json().catch(() => ({}))) as {
      client_id?: string;
      redirect_uri?: string;
      code_challenge?: string;
      code_challenge_method?: string;
      scope?: string;
      state?: string;
    };
    const { client_id, redirect_uri, code_challenge } = body;
    if (!client_id || !redirect_uri || !code_challenge) {
      return c.json({ error: "invalid_request" }, 400);
    }
    // Only S256 PKCE is supported (we advertise S256-only in discovery).
    const method = body.code_challenge_method ?? "S256";
    if (method !== "S256") {
      return c.json({ error: "invalid_request", error_description: "only S256 PKCE is supported" }, 400);
    }
    const client = await getClient(client_id);
    if (!client) return c.json({ error: "invalid_client" }, 400);
    if (!redirectAllowed(client, redirect_uri)) return c.json({ error: "invalid_redirect_uri" }, 400);

    // The consent UI sends the chosen brain scope (public/private/secret).
    const requested = (body.scope ?? "").split(/\s+/).filter(Boolean);
    const brainScope: Scope = (requested.find((s) => isScope(s)) as Scope) ?? "private";

    const code = await createAuthCode({
      clientId: client_id,
      userId: auth.userId,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      codeChallengeMethod: "S256",
      scope: brainScope,
    });

    const url = new URL(redirect_uri);
    url.searchParams.set("code", code);
    if (body.state) url.searchParams.set("state", body.state);
    return c.json({ redirect: url.toString() });
  });

  // ── Token endpoint ────────────────────────────────────────────────────────
  app.post("/oauth/token", async (c) => {
    const p = await readParams(c);
    const grant = p.grant_type;

    if (grant === "authorization_code") {
      if (!p.code || !p.redirect_uri || !p.client_id || !p.code_verifier) {
        return tokenError(c, "invalid_request");
      }
      const result = await consumeAuthCode({
        code: p.code,
        clientId: p.client_id,
        redirectUri: p.redirect_uri,
        codeVerifier: p.code_verifier,
      });
      if (!result) return tokenError(c, "invalid_grant");
      const tokens = await issueTokens(p.client_id, result.userId, result.scope);
      return c.json(tokens, 200, { "Cache-Control": "no-store" });
    }

    if (grant === "refresh_token") {
      if (!p.refresh_token || !p.client_id) return tokenError(c, "invalid_request");
      const tokens = await refreshTokens(p.refresh_token, p.client_id);
      if (!tokens) return tokenError(c, "invalid_grant");
      return c.json(tokens, 200, { "Cache-Control": "no-store" });
    }

    return tokenError(c, "unsupported_grant_type");
  });
}
