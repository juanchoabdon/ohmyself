/** Read-only check: can we list Gemini notes for a stuck connection? */
import "../env.js";
import { syncDriveConnection } from "../sync.js";

const spaceId = process.argv[2] ?? "50e99419-6adb-45bf-9e49-9235c990444e";
const connectionId = process.argv[3] ?? "555dc137-8a5b-4c41-9c7a-2525e68a42c4";

async function main(): Promise<void> {
  const res = await syncDriveConnection(spaceId, connectionId, {
    mode: "full",
    dryRun: true,
    max: 50,
  });
  console.log("discovery OK — fresh candidates:", res.total ?? res.candidates?.length ?? 0);
  for (const c of (res.candidates ?? []).slice(0, 5)) console.log(" -", c.name);
}

main().catch((e) => {
  console.error("discovery FAILED:", (e as Error).message.slice(0, 300));
  process.exit(1);
});
