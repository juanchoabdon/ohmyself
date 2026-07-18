import "../env.js";
import * as Y from "yjs";
import { buildCore, allowedVisibilities, parseNote } from "../core/index.js";
import { SupabaseVersionStore } from "../core/versions/supabase.js";
import { dedupeRepeatedBody } from "../core/dedupeBody.js";
import { deleteCollabState } from "../collab/state-store.js";

const spaceId = "1315727f-5d16-47e1-8c14-93080dd6882e";
const path = "strategy/yc-fall-2026-application.md";
const CLEAN_VERSION = process.argv.find((a) => a.startsWith("--version="))?.slice("--version=".length) ?? "20313";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");
  const versions = new SupabaseVersionStore();

  const raw = await versions.readAtVersion(spaceId, path, CLEAN_VERSION, allowed);
  if (!raw) throw new Error(`version ${CLEAN_VERSION} not found`);
  const cleanBody = parseNote(raw, path).body;
  const dup = dedupeRepeatedBody(cleanBody);

  const current = await brain.readNote(spaceId, path, allowed);
  console.log("current", current.body.length, "-> clean", cleanBody.length, "deduped?", dup.deduped);

  if (dryRun) return;

  await brain.updateNote(
    spaceId,
    path,
    { body: dup.deduped ? dup.body : cleanBody },
    allowed,
    { author: "ohmyself", summary: "restore pre-collab-dup YC application draft" },
  );
  await deleteCollabState(spaceId, path).catch(() => {});

  const after = await brain.readNote(spaceId, path, allowed);
  console.log("restored len", after.body.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
