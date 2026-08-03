import type { AuthContext } from "./types.js";
import type { WriteAttribution } from "./versions/types.js";

/** Compact one-line label safe to store as a version author. */
export function cleanAgentLabel(label?: string | null): string | null {
  const clean = label?.replace(/\s+/g, " ").trim().slice(0, 80);
  return clean || null;
}

/** Build version-history author metadata from the resolved request identity.
 *  Agents are attributed by WHO they are (token name / OAuth client / MCP
 *  client), falling back to HOW they authenticated ("agent:token"). */
export function attributionFromAuth(auth: AuthContext, summary?: string): WriteAttribution {
  const via = auth.via ?? "token";
  if (via === "jwt") return { author: "human", summary };
  const label = cleanAgentLabel(auth.clientLabel);
  return { author: `agent:${label ?? via}`, summary };
}
