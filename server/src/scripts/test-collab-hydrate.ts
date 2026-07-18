/** Smoke test: onLoadDocument hydrates empty Y room from vault. */
import "../env.js";
import { collabFieldName } from "../collab/schema.js";
import { collabEnabled, roomName, startCollabServer } from "../collab/index.js";

async function main(): Promise<void> {
  process.env.COLLAB_ENABLED = "true";
  const server = startCollabServer();
  if (!server || !collabEnabled()) {
    console.error("collab not enabled");
    process.exit(1);
  }

  const spaceId = process.argv[2] ?? "1315727f-5d16-47e1-8c14-93080dd6882e";
  const path = process.argv[3] ?? "thesis/company-vision.md";
  const docName = roomName(spaceId, path);

  const conn = await server.openDirectConnection(docName, { test: true });
  const doc = conn.document;
  if (!doc) {
    console.error("no document on direct connection");
    process.exit(1);
  }
  const field = collabFieldName();
  const empty = doc.isEmpty(field);
  const len = doc.getXmlFragment(field).length;
  console.log({ docName, empty, fragmentLength: len });
  await conn.disconnect();
  process.exit(empty || len === 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
