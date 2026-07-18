import "../env.js";
import * as Y from "yjs";
import { applyUpdate } from "yjs";
import { buildCore, allowedVisibilities } from "../core/index.js";
import { dedupeRepeatedBody } from "../core/dedupeBody.js";
import { loadCollabState } from "../collab/state-store.js";
import { yDocToMarkdown } from "../collab/schema.js";

const spaceId = process.argv[2] ?? "1315727f-5d16-47e1-8c14-93080dd6882e";
const path = process.argv[3] ?? "strategy/yc-fall-2026-application.md";

async function main(): Promise<void> {
  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");
  const note = await brain.readNote(spaceId, path, allowed);
  const vaultDup = dedupeRepeatedBody(note.body);
  console.log("vault", { len: note.body.length, deduped: vaultDup.deduped, cleanLen: vaultDup.body.length });
  console.log("vault head:\n", note.body.slice(0, 300));

  const stored = await loadCollabState(spaceId, path);
  if (!stored) {
    console.log("no collab state");
    return;
  }
  const ydoc = new Y.Doc();
  applyUpdate(ydoc, stored);
  const ymd = yDocToMarkdown(ydoc);
  const yDup = dedupeRepeatedBody(ymd);
  console.log("collab", { len: ymd.length, deduped: yDup.deduped, cleanLen: yDup.body.length });
  console.log("collab head:\n", ymd.slice(0, 300));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
