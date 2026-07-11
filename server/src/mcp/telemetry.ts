/**
 * MCP tool-usage telemetry.
 *
 * The contract-v2 consolidation plan gates any tool removal on real usage data:
 * we only deprecate/remove a redundant tool once telemetry confirms nothing
 * active still calls it. This records ONE row per tool call — name, tenant,
 * outcome, latency, and whether the tool is marked deprecated — and NEVER the
 * arguments or note content (privacy). Best-effort: a telemetry failure must
 * never affect the tool call.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { serviceClient } from "../core/supabase.js";
import type { AuthContext } from "../core/types.js";

export interface ToolUsageRecord {
  tool: string;
  spaceId?: string;
  userId?: string;
  ok: boolean;
  errorCode?: string;
  latencyMs: number;
  deprecated: boolean;
  via?: string;
  client?: string;
}

export function telemetryEnabled(): boolean {
  return process.env.TOOL_TELEMETRY !== "off";
}

/** Fire-and-forget insert; swallows every error. */
export function recordToolUsage(rec: ToolUsageRecord): void {
  if (!telemetryEnabled()) return;
  try {
    const sb = serviceClient();
    void sb
      .from("tool_usage")
      .insert({
        space_id: rec.spaceId ?? null,
        user_id: rec.userId ?? null,
        tool: rec.tool,
        ok: rec.ok,
        error_code: rec.errorCode ?? null,
        latency_ms: Math.round(rec.latencyMs),
        deprecated: rec.deprecated,
        via: rec.via ?? null,
        client: rec.client ?? null,
      })
      .then(
        () => {},
        () => {},
      );
  } catch {
    /* never let telemetry break a tool call */
  }
}

/** Monkey-patch `server.registerTool` so every tool registered AFTER this call
 *  is wrapped with timing + usage recording. Call once, right after the server
 *  is constructed and before any tools are registered. `deprecated` is the set
 *  of tool names currently marked deprecated (recorded on each call). */
export function instrumentToolUsage(
  server: McpServer,
  auth: AuthContext,
  deprecated: ReadonlySet<string>,
): void {
  if (!telemetryEnabled()) return;
  const original = server.registerTool.bind(server) as McpServer["registerTool"];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).registerTool = (name: string, def: any, handler: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = async (...args: any[]) => {
      const start = Date.now();
      try {
        const res = await handler(...args);
        recordToolUsage({
          tool: name,
          spaceId: auth.spaceId,
          userId: auth.userId,
          ok: true,
          latencyMs: Date.now() - start,
          deprecated: deprecated.has(name),
          via: auth.via,
        });
        return res;
      } catch (err) {
        recordToolUsage({
          tool: name,
          spaceId: auth.spaceId,
          userId: auth.userId,
          ok: false,
          errorCode: (err as Error)?.name || "Error",
          latencyMs: Date.now() - start,
          deprecated: deprecated.has(name),
          via: auth.via,
        });
        throw err;
      }
    };
    return original(name, def, wrapped);
  };
}
