#!/usr/bin/env node
import "../env.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isScope } from "../core/scope.js";
import type { AuthContext, Scope } from "../core/types.js";
import { buildMcpServer } from "./tools.js";

/** Local MCP server over stdio — for your personal Claude / CLI.
 *  Identity comes from env (no JWT):
 *    OHMYSELF_USER_ID  — the brain to operate on (use "local" for the FS vault)
 *    OHMYSELF_SCOPE    — public | private | secret (default: secret)
 */
async function main(): Promise<void> {
  const requested = process.env.OHMYSELF_SCOPE;
  const scope: Scope = isScope(requested) ? requested : "secret";
  const auth: AuthContext = {
    userId: process.env.OHMYSELF_USER_ID ?? "local",
    scope,
    readonly: scope === "public",
  };
  const server = buildMcpServer(auth);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio transport keeps the process alive.
}

main().catch((err) => {
  console.error("[ohmyself mcp] fatal:", err);
  process.exit(1);
});
