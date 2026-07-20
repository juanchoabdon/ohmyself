/** Revoke the temporary diag-folder-timing API token. */
import "../env.js";
import { listTokens, revokeToken } from "../core/index.js";

const SELF = "50e99419-6adb-45bf-9e49-9235c990444e";

async function main(): Promise<void> {
  const rows = await listTokens(SELF);
  for (const r of rows) {
    if (r.name === "diag-folder-timing") {
      await revokeToken(SELF, r.id);
      console.log("revoked", r.id);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
