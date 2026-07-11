# Deployment topology & runbook

> Read this before deploying anything, especially server/MCP changes. There is
> more than one running copy of the server — forgetting that causes version skew
> where some clients see new tools and others don't.

## The one rule

**`www.ohmyself.ai` is the single public origin for every client.** All MCP
clients (Cursor, ChatGPT, Claude) and the OAuth flow point at
`https://www.ohmyself.ai/mcp`. That origin is a thin proxy — the real backend is
**Railway**. So: **deploy server changes to Railway.**

## Topology

```
Cursor / ChatGPT / Claude  ──►  https://www.ohmyself.ai/mcp
                                        │  (Vercel `web` project: Next.js)
                                        │  rewrites /mcp, /v1, /oauth,
                                        │  /connectors, /.well-known
                                        ▼
                    https://ohmyself-api-production.up.railway.app
                                 Railway = the real backend
                          (REST + MCP + OAuth + crons/scheduler)
```

- **`www.ohmyself.ai`** → Vercel **`web`** project (Next.js frontend). Its
  `/mcp`, `/v1/*`, `/oauth/*`, `/connectors/*`, `/.well-known/*` are **rewrites**
  to Railway (see `web/vercel.json`). Nothing MCP is executed here; it is a
  passthrough.
- **`ohmyself-api-production.up.railway.app`** → **Railway**, running the
  `server/` code. This is the production backend and also runs the periodic jobs
  (embedding reconcile, meeting sync). **This is the one that serves the tools.**
- **`ohmyself-api.vercel.app`** → **decommissioned (2026-07-11).** This used to be
  a second, serverless copy of `server/` on Vercel, and it was the cause of the
  version-skew scares (some clients hit it, some hit Railway). The Vercel project
  was deleted; every client and the `juandisanchez/` site now go through `www` →
  Railway. **Do not recreate it.** There is exactly one backend now: Railway.

## How to deploy

### Server (REST + MCP + OAuth) → Railway  ← the important one

```bash
git push origin main
cd server && railway up --service ohmyself-api
```

Railway does **not** auto-deploy from GitHub today, so `railway up` is required
(or enable GitHub auto-deploy in the Railway dashboard so a push to `main` ships
automatically — recommended).

### Web frontend → Vercel

```bash
cd web && vercel deploy --prod
```

### ~~Legacy Vercel server copy~~ — removed

The Vercel `ohmyself-api` project was deleted on 2026-07-11. There is only one
backend (Railway). `juandisanchez.com` and every MCP client now use `www`. Do not
run `vercel deploy --prod` from `server/` — deploy the server to Railway only.

## When you change the MCP tool contract

1. Bump `CONTRACT_VERSION` in `server/src/mcp/tools.ts` (minor for additive tools,
   major for breaking changes).
2. Deploy to Railway (above).
3. Verify live against the real origin:

```bash
curl -s -X POST "https://www.ohmyself.ai/mcp" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_structure","arguments":{}}}' \
  | sed -n 's/^data: //p'
```

Confirm `contract_version` is the new value and that a `tools/list` includes the
new tools.

## Client-side caching gotcha

Even after the server is updated, clients cache the tool list:

- **ChatGPT / Claude (OAuth):** cache a tool snapshot at connect time. Disconnect
  and reconnect the ohmyself connector to pull the new list.
- **Cursor:** now uses the native `url` + `headers` form in `~/.cursor/mcp.json`
  (no `mcp-remote` proxy), so just reload the window / toggle the connector. (The
  old `mcp-remote` wrapper cached aggressively — that was the source of a past
  "new tools not showing" scare.)

## History / why this doc exists

We shipped contract 2.1 (company-space retrieval tools) and deployed only to the
Vercel server copy. Cursor (which then used `ohmyself-api.vercel.app`) saw the new
tools, but ChatGPT/Claude (via `www` → Railway) did not, because Railway was still
on 2.0. Fix: deploy to Railway too, and point every client at `www`.
