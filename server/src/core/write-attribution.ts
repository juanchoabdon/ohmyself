import type { AuthContext } from "./types.js";
import type { WriteAttribution } from "./versions/types.js";

/** Build version-history author metadata from the resolved request identity. */
export function attributionFromAuth(auth: AuthContext, summary?: string): WriteAttribution {
  const via = auth.via ?? "token";
  const author = via === "jwt" ? "human" : `agent:${via}`;
  return { author, summary };
}
