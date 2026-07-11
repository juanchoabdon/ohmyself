# Shipping ohmyself! as an official Claude + GPT connector

The technical layer (OAuth 2.1 + PKCE + DCR + discovery) is implemented. This doc is
the runbook to deploy it and submit to both directories. Submission itself is a manual
step in each vendor's portal.

## 0. Prerequisites (one-time)

- Single-domain prod under `https://www.ohmyself.ai` (web project rewrites `/mcp`,
  `/oauth/*`, `/.well-known/*` to the API project — already in `web/vercel.json`).
- Env vars on **both** Vercel projects:
  - API (`server/`): `OMS_ISSUER`, `PUBLIC_API_URL`, `PUBLIC_WEB_URL` all = `https://www.ohmyself.ai`
    (plus existing `SUPABASE_*`, `BRAIN_BUCKET`, `VAULT_BACKEND`). Optional: `OAUTH_ACCESS_TTL_S`,
    `OAUTH_REFRESH_TTL_S`, `OAUTH_CODE_TTL_S`.
  - Web (`web/`): `NEXT_PUBLIC_API_URL=https://www.ohmyself.ai` (same origin), `NEXT_PUBLIC_SUPABASE_*`.
- Deploy both: `cd server && vercel deploy --prod` then `cd ../web && vercel deploy --prod`.
- Create a dedicated **reviewer demo account** with sample (non-sensitive) data, scoped so
  reviewers see a useful but safe brain. Keep credentials handy (no 2FA, no signup step).

## 1. Smoke-test prod (before submitting)

```bash
BASE=https://www.ohmyself.ai
curl -s $BASE/.well-known/oauth-protected-resource | jq .
curl -s $BASE/.well-known/oauth-authorization-server | jq .
curl -si -X POST $BASE/mcp -H 'content-type: application/json' -d '{}' | grep -i www-authenticate
```

- Confirm the `/mcp` POST returns `401` with `WWW-Authenticate: Bearer resource_metadata=...`.
- IMPORTANT: confirm `/mcp` streams `text/event-stream` correctly through the Vercel rewrite.
  If it buffers/breaks, point the connector URL directly at the Railway backend
  (`https://ohmyself-api-production.up.railway.app/mcp`) instead; OAuth + discovery can stay
  on `www`. (The old `ohmyself-api.vercel.app` copy was decommissioned 2026-07-11.)
- Validate the whole flow with MCP Inspector and as a **custom connector** in Claude and in
  ChatGPT developer mode first. Only submit once the custom-connector path works.

## 2. Anthropic — Connectors Directory

Portal: Claude.ai → admin settings → Connectors submission portal (requires a Team or
Enterprise org; submit as Owner / Directory-management role).

Provide:
- MCP server URL: `https://www.ohmyself.ai/mcp`
- Auth: `oauth_dcr` (Dynamic Client Registration — already supported at `/oauth/register`).
  Redirect URI `https://claude.ai/api/mcp/auth_callback` is accepted automatically (clients
  send their redirect_uris at registration; we exact-match, with loopback support for Claude Code).
- Tool list + descriptions (all tools already have `title` + `readOnlyHint`/`destructiveHint`).
- Privacy policy: `https://www.ohmyself.ai/privacy`; support contact: `support@ohmyself.ai`.
- Reviewer demo account with sample data.

Checklist mapped to their requirements:
- [x] Streamable HTTP transport
- [x] OAuth 2.1 + PKCE (S256), interactive consent (no client_credentials)
- [x] 401 + `WWW-Authenticate` discovery contract
- [x] Protected Resource Metadata (RFC 9728) + path-suffixed variant
- [x] Authorization Server Metadata (RFC 8414)
- [x] Dynamic Client Registration (RFC 7591) at `/oauth/register`
- [x] Tool annotations (`title` + read/destructive hints); read/write split
- [ ] Privacy policy live + reviewer demo account (do at deploy time)

> Scale note: DCR registers a new client per fresh connection. If directory traffic grows,
> add CIMD (advertise `client_id_metadata_document_supported`) or request Anthropic-held
> credentials (`mcp-review@anthropic.com`). Tracked as a follow-up.

## 3. OpenAI — ChatGPT Apps SDK / app directory

Portal: OpenAI Platform Dashboard → Apps → create draft → submit (Owner or `api.apps.write`).

Provide:
- Universal MCP server URL: `https://www.ohmyself.ai/mcp`
- Auth: OAuth — OpenAI auto-detects config from our discovery metadata
  (`/.well-known/oauth-authorization-server` advertises authorize/token/registration,
  `S256`, and `token_endpoint_auth_methods_supported: ["none"]`).
- App name, logo, description, company + privacy/terms URLs (`/privacy`, `/terms`),
  screenshots, test prompts + expected responses, and a demo login (no signup/2FA).
- First-party note: ohmyself! is your own data store, not pass-through middleware to a
  third party (which their policy rejects).

Checklist:
- [x] Publicly hosted MCP server, real `/mcp` endpoint
- [x] OAuth 2.1 + PKCE with discovery metadata
- [x] Tool annotations
- [ ] Privacy + terms live, screenshots, test prompts, demo login (do at submission time)
- [ ] (If a custom UI component is added later) define a CSP for fetched domains

## 4. After approval
- Publish from each dashboard to get listed.
- Monitor `oauth_clients` / `oauth_tokens` growth; consider CIMD if DCR volume is high.
