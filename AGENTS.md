# Agent notes for the ohmyself repo

## Deploying (read this before shipping server/MCP changes)

**`www.ohmyself.ai` is the single public origin for all clients** (Cursor,
ChatGPT, Claude, OAuth). It is a proxy — the real backend is **Railway**.

- Deploy server changes to Railway: `cd server && railway up --service ohmyself-api --no-gitignore`
  (Railway does not auto-deploy from GitHub today).
- **`--no-gitignore` is required.** Root `.gitignore` has `/versions/` and
  `server/versions/` for runtime version *data*; Railway's default upload respects
  `.gitignore` and can exclude `server/src/core/versions/` (the TypeScript source).
  Without the flag, `tsc` fails with `Cannot find module './versions/types.js'`.
- **One backend only: Railway.** The old Vercel server copy
  (`ohmyself-api.vercel.app`) was decommissioned 2026-07-11 — don't recreate it and
  never `vercel deploy --prod` from `server/`. Everything goes `www` → Railway.
- When changing the MCP tool contract, bump `CONTRACT_VERSION` in
  `server/src/mcp/tools.ts`, then verify live via `get_structure` against
  `https://www.ohmyself.ai/mcp`.
- After deploy, clients cache the tool list — reconnect (ChatGPT/Claude) or reload
  (Cursor) to pick up new tools.

Full topology, runbook, and history: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
