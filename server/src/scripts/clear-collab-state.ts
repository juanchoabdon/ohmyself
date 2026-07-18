import "../env.js";
import { deleteCollabState } from "../collab/state-store.js";

const spaceId = process.argv[2];
const path = process.argv[3];

async function main(): Promise<void> {
  if (!spaceId || !path) throw new Error("usage: clear-collab-state <spaceId> <path>");
  await deleteCollabState(spaceId, path);
  console.log("cleared collab state for", spaceId, path);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
