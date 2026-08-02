/**
 * Check what the public MCP endpoint is actually serving after a deploy:
 * the contract version and whether the media tools are present.
 *
 *   npx tsx src/scripts/verify-live-mcp.ts [url]
 *
 * Uses PUBLIC_AGENT_TOKEN (read-only scope), which is enough to list tools and
 * read get_structure.
 */
import "../env.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const EXPECTED = ["add_media", "get_media", "list_media"];

async function main() {
  const url = process.argv[2] ?? "https://www.ohmyself.ai/mcp";
  const token = process.env.PUBLIC_AGENT_TOKEN;
  if (!token) throw new Error("PUBLIC_AGENT_TOKEN is not set");

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "verify-live", version: "1.0.0" });
  await client.connect(transport);
  console.log(`connected: ${url}`);

  const { tools } = await client.listTools();
  const names = new Set(tools.map((t) => t.name));
  console.log(`tools: ${tools.length}`);
  for (const name of EXPECTED) {
    console.log(`${names.has(name) ? "ok  " : "FAIL"}  ${name}`);
  }

  const res = await client.callTool({ name: "get_structure", arguments: {} });
  const first = (res.content as Array<{ type: string; text?: string }>)[0];
  const parsed = JSON.parse(first?.text ?? "{}") as {
    contract_version?: string;
    media?: unknown;
  };
  console.log(`contract_version: ${parsed.contract_version}`);
  console.log(`media guidance present: ${parsed.media ? "yes" : "no"}`);

  const ok = EXPECTED.every((n) => names.has(n)) && parsed.contract_version === "2.13";
  console.log(ok ? "\nlive and current" : "\nNOT current — the old build is still serving");
  await client.close();
  process.exit(ok ? 0 : 1);
}

void main();
