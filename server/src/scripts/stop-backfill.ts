/** Stop a running Drive backfill (cost guard). */
import "../env.js";
import { stopBackfill } from "../backfill.js";

const spaceId = process.argv[2];
const connectionId = process.argv[3];
const reason = process.argv[4] ?? "Stopped (cost cap)";

if (!spaceId || !connectionId) {
  console.error("Usage: stop-backfill <spaceId> <connectionId> [reason]");
  process.exit(1);
}

stopBackfill(spaceId, connectionId, reason)
  .then((s) => {
    console.log("stopped:", JSON.stringify(s, null, 2));
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
