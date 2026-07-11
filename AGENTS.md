# Agent notes for the ohmyself repo

## Deploying (read this before shipping server/MCP changes)

**`www.ohmyself.ai` is the single public origin for all clients** (Cursor,
ChatGPT, Claude, OAuth). It is a proxy — the real backend is **Railway**.

- Deploy server changes to Railway: `cd server && railway up --service ohmyself-api`
  (Railway does not auto-deploy from GitHub today).
- There is a **second, legacy copy** of the server on Vercel
  (`ohmyself-api.vercel.app`). Do not assume deploying one updates the other. MCP
  clients use `www` → Railway, so **Railway is what matters** for tools showing up.
- When changing the MCP tool contract, bump `CONTRACT_VERSION` in
  `server/src/mcp/tools.ts`, then verify live via `get_structure` against
  `https://www.ohmyself.ai/mcp`.
- After deploy, clients cache the tool list — reconnect (ChatGPT/Claude) or reload
  (Cursor) to pick up new tools.

Full topology, runbook, and history: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
