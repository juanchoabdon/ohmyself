import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createApp } from "./api/app.js";
import { resolveAuth } from "./auth.js";
import { BrainError } from "./core/errors.js";
import { buildMcpServer } from "./mcp/tools.js";

const app = createApp();

function headerStr(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** Buffer the raw request body. We read it ourselves (rather than relying on
 *  `@hono/node-server`'s stream adapter) because on some serverless runtimes
 *  (notably Vercel) the adapter's body stream never emits `end`, hanging every
 *  POST. Reading synchronously here mirrors the MCP path, which works. */
function readRaw(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Build a WHATWG `Request` from a Node `IncomingMessage` with an already-read
 *  body, so we can hand it to Hono via `app.fetch`. */
function toWebRequest(req: IncomingMessage, body: Buffer): Request {
  const proto = headerStr(req.headers["x-forwarded-proto"]) ?? "https";
  const host = headerStr(req.headers["host"]) ?? "localhost";
  const url = `${proto}://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) for (const vv of v) headers.append(k, vv);
    else if (v != null) headers.set(k, v);
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD" && body.length > 0;
  return new Request(url, { method, headers, body: hasBody ? body : undefined });
}

/** Run the Hono REST app for a Node request, buffering the body first. */
async function handleHono(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readRaw(req);
  const response = await app.fetch(toWebRequest(req, body));
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "content-length") return;
    headers[key] = value;
  });
  res.writeHead(response.status, headers);

  const isStream =
    response.body != null &&
    (response.headers.get("content-type")?.includes("text/event-stream") ?? false);

  if (isStream && response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } finally {
      res.end();
    }
    return;
  }

  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
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

/** Public base URL of this server (the OAuth resource + issuer). */
function publicBase(): string {
  return (
    process.env.OMS_ISSUER ||
    process.env.PUBLIC_API_URL ||
    `http://localhost:${process.env.PORT ?? 8787}`
  ).replace(/\/+$/, "");
}

/** RFC 9728 challenge so MCP clients can discover how to authenticate. */
function send401Challenge(res: ServerResponse, message: string): void {
  const metadata = `${publicBase()}/.well-known/oauth-protected-resource`;
  res.writeHead(401, {
    "content-type": "application/json",
    "WWW-Authenticate": `Bearer resource_metadata="${metadata}"`,
  });
  res.end(JSON.stringify({ error: message }));
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
      "x-brain-space": headerStr(req.headers["x-brain-space"]),
    });
  } catch (err) {
    const status = err instanceof BrainError ? err.status : 401;
    const message = err instanceof Error ? err.message : "unauthorized";
    // MCP auth spec: an unauthenticated request must get a 401 carrying a
    // WWW-Authenticate header that points at the protected-resource metadata.
    if (status === 401) send401Challenge(res, message);
    else sendJson(res, status, { error: message });
    return;
  }

  let body: unknown;
  try {
    body = await readJson(req);
  } catch {
    sendJson(res, 400, { error: "invalid JSON body" });
    return;
  }

  const server = await buildMcpServer(auth);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

/**
 * Single request dispatcher shared by the standalone Node server and the
 * Vercel serverless function. Routes `POST /mcp` to the MCP transport and
 * everything else to the Hono REST app.
 */
export function dispatch(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? "/";
  if (url === "/mcp" || url.startsWith("/mcp?") || url.startsWith("/mcp/")) {
    handleMcp(req, res).catch((err) => {
      console.error("[mcp] error:", err);
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
    });
    return;
  }
  handleHono(req, res).catch((err) => {
    console.error("[api] error:", err);
    if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
  });
}
