import "./env.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createApp } from "./api/app.js";
import { resolveAuth } from "./auth.js";
import { BrainError } from "./core/errors.js";
import { buildMcpServer } from "./mcp/tools.js";

const app = createApp();
const honoListener = getRequestListener(app.fetch);

function headerStr(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve(undefined);
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

/** Stateless MCP over Streamable HTTP. A fresh server+transport per request,
 *  scoped to the caller's resolved auth. */
async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json", Allow: "POST" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method Not Allowed (use POST)" },
        id: null,
      }),
    );
    return;
  }

  let auth;
  try {
    auth = await resolveAuth({
      authorization: headerStr(req.headers["authorization"]),
      "x-brain-scope": headerStr(req.headers["x-brain-scope"]),
    });
  } catch (err) {
    const status = err instanceof BrainError ? err.status : 401;
    sendJson(res, status, { error: err instanceof Error ? err.message : "unauthorized" });
    return;
  }

  let body: unknown;
  try {
    body = await readJson(req);
  } catch {
    sendJson(res, 400, { error: "invalid JSON body" });
    return;
  }

  const server = buildMcpServer(auth);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

const port = Number(process.env.PORT ?? 8787);

const httpServer = createServer((req, res) => {
  const url = req.url ?? "/";
  if (url === "/mcp" || url.startsWith("/mcp?") || url.startsWith("/mcp/")) {
    handleMcp(req, res).catch((err) => {
      console.error("[mcp] error:", err);
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
    });
    return;
  }
  honoListener(req, res);
});

httpServer.listen(port, () => {
  console.log(`ohmyself! listening on :${port}  (REST: /v1/*, MCP: POST /mcp)`);
});
